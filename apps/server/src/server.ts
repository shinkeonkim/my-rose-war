import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { Server, Socket } from 'socket.io';
import { Member, Room, RoomError, Rooms, normalizeCode } from './rooms';
import { DRAIN_MESSAGE } from '@rw/engine';
import { pullFromPeer, serveHandoff } from './handoff';

const PORT = Number(process.env.PORT ?? 3001);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? join(process.cwd(), 'apps/web/dist'));
const PUBLIC_URL = process.env.PUBLIC_URL || null;
// ---- 무중단 배포 (방 상태 넘겨주기, apps/server/src/handoff.ts) ----
const HANDOFF_PORT = Number(process.env.HANDOFF_PORT ?? 0) || 0;
const HANDOFF_PEER = process.env.HANDOFF_PEER || null;
const HANDOFF_SECRET = process.env.HANDOFF_SECRET || '';
/** 이전 파드에게서 방을 넘겨받음(또는 없음 확인) */
let ready = false;
/** 방을 새 파드로 넘겨줬음 — 상태 변경 요청 거절, 곧 종료 */
let draining = false;
let shuttingDown = false;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function lanUrls(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  // 집 공유기 대역을 먼저, Tailscale(100.64/10) 다음, 나머지는 뒤로
  const rank = (ip: string) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 0 : /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ? 1 : 2;
  return out.sort((a, b) => rank(a) - rank(b));
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (url.pathname === '/readyz') {
    const ok = ready && !draining;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain' }).end(ok ? 'ready' : draining ? 'draining' : 'starting');
    return;
  }
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ publicUrl: PUBLIC_URL, lanHosts: lanUrls() }));
    return;
  }
  let file = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(STATIC_DIR, 'index.html'); // SPA 경로(/r/CODE 등)
  }
  if (!existsSync(file)) {
    res.writeHead(404).end('web build not found — run `npm run build`');
    return;
  }
  const isAsset = file.includes(`${STATIC_DIR}/assets/`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

const http = createServer(serveStatic);
const io = new Server(http, { cors: { origin: process.env.CORS_ORIGIN ?? false } });

const rooms = new Rooms((room) => broadcast(room));

interface SocketData {
  code?: string;
  memberId?: string;
  failedJoins: number[];
}

function broadcast(room: Room) {
  for (const m of room.members) io.to(`m:${room.code}:${m.id}`).emit('room', rooms.view(room, m));
  // 방에서 빠진 사람(강퇴 등)에게 알림
  io.in(`r:${room.code}`).fetchSockets().then((sockets) => {
    for (const s of sockets) {
      if (!room.members.some((m) => m.id === s.data.memberId) || !rooms.rooms.has(room.code)) {
        s.emit('kicked', rooms.rooms.has(room.code) ? '방장이 방에서 내보냈어요' : '방이 닫혔어요');
        s.leave(`r:${room.code}`);
        s.data.code = undefined;
      }
    }
  });
}

type Ack = (r: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

/** readOnly가 아니면 상태를 바꾸는 요청 — 배포로 방을 넘기는 중에는 막는다 */
function handler<T>(socket: Socket, fn: (payload: T) => Record<string, unknown> | void, readOnly = false) {
  return (payload: T, ack?: Ack) => {
    try {
      if (draining && !readOnly) throw new RoomError(DRAIN_MESSAGE);
      const r = fn(payload ?? ({} as T));
      if (typeof ack === 'function') ack({ ok: true, ...(r ?? {}) });
    } catch (e) {
      const msg = e instanceof RoomError ? e.message : '서버 오류';
      if (!(e instanceof RoomError)) console.error(e);
      if (typeof ack === 'function') ack({ ok: false, error: msg });
      else socket.emit('error-message', msg);
    }
  };
}

function current(socket: Socket): { room: Room; member: Member } {
  const { code, memberId } = socket.data as SocketData;
  if (!code) throw new RoomError('방에 들어가 있지 않습니다');
  const room = rooms.get(code);
  const member = room.members.find((m) => m.id === memberId);
  if (!member) throw new RoomError('방에서 나가졌습니다');
  return { room, member };
}

function attach(socket: Socket, room: Room, member: Member) {
  detach(socket);
  socket.data.code = room.code;
  socket.data.memberId = member.id;
  socket.join(`r:${room.code}`);
  socket.join(`m:${room.code}:${member.id}`);
  rooms.connect(room, member);
}

function detach(socket: Socket) {
  const { code, memberId } = socket.data as SocketData;
  if (!code) return;
  socket.leave(`r:${code}`);
  socket.leave(`m:${code}:${memberId}`);
  socket.data.code = undefined;
  const room = rooms.rooms.get(code);
  const member = room?.members.find((m) => m.id === memberId);
  if (room && member) {
    rooms.disconnect(room, member);
    broadcast(room);
  }
}

io.on('connection', (socket) => {
  (socket.data as SocketData).failedJoins = [];

  socket.on(
    'create',
    handler<{ name: string; password?: string }>(socket, ({ name, password }) => {
      const { room, member } = rooms.create(name, typeof password === 'string' ? password : undefined);
      attach(socket, room, member);
      broadcast(room);
      return { code: room.code, token: member.token };
    }),
  );

  socket.on(
    'join',
    handler<{ code: string; name: string; password?: string; token?: string; spectator?: boolean }>(socket, (p) => {
      if (draining) {
        // 교체 중에는 기존 참가자의 재접속만 받는다 (상태가 바뀌지 않음)
        const known = typeof p.token === 'string' && rooms.rooms.get(normalizeCode(p.code))?.members.some((m) => m.token === p.token);
        if (!known) throw new RoomError(DRAIN_MESSAGE);
      }
      const data = socket.data as SocketData;
      const now = Date.now();
      data.failedJoins = data.failedJoins.filter((t) => now - t < 60_000);
      if (data.failedJoins.length >= 10) throw new RoomError('시도가 너무 많습니다. 잠시 후 다시 시도하세요');
      try {
        const { room, member } = rooms.join(normalizeCode(p.code), {
          name: p.name,
          password: typeof p.password === 'string' ? p.password : undefined,
          token: typeof p.token === 'string' ? p.token : undefined,
          spectator: !!p.spectator,
        });
        attach(socket, room, member);
        broadcast(room);
        return { code: room.code, token: member.token };
      } catch (e) {
        data.failedJoins.push(now);
        throw e;
      }
    }, true),
  );

  /** 입장 전에 방 존재/암호 여부 확인 */
  socket.on(
    'peek',
    handler<{ code: string }>(socket, ({ code }) => {
      const room = rooms.get(normalizeCode(code));
      return {
        code: room.code,
        hasPassword: !!room.password,
        inGame: !!room.match,
        players: room.members.filter((m) => m.role === 'player').length,
      };
    }, true),
  );

  const act = <T>(name: string, fn: (room: Room, member: Member, p: T) => void) =>
    socket.on(
      name,
      handler<T>(socket, (p) => {
        const { room, member } = current(socket);
        fn(room, member, p);
        if (rooms.rooms.has(room.code)) broadcast(room);
        else io.in(`r:${room.code}`).emit('kicked', '방장이 방을 닫았어요');
      }),
    );

  act<{ config: object }>('config', (r, m, p) => rooms.setConfig(r, m, p.config ?? {}));
  act<{ password: string | null }>('password', (r, m, p) => rooms.setPassword(r, m, typeof p.password === 'string' && p.password ? p.password : null));
  act<{ role: 'player' | 'spectator' }>('role', (r, m, p) => rooms.setRole(r, m, p.role === 'spectator' ? 'spectator' : 'player'));
  act<{ id: string; dir: -1 | 1 }>('reorder', (r, m, p) => rooms.moveMember(r, m, String(p.id), p.dir === -1 ? -1 : 1));
  act<{ id: string }>('kick', (r, m, p) => rooms.kick(r, m, String(p.id)));
  act<{ force?: boolean }>('start', (r, m, p) => rooms.start(r, m, p.force === true));
  act('back', (r, m) => rooms.back(r, m));
  act('close', (r, m) => rooms.close(r, m));
  act<{ move: any }>('move', (r, m, p) => rooms.move(r, m, p.move));
  act<{ round?: number; status?: string }>('next', (r, m, p) =>
    rooms.next(r, m, { round: typeof p.round === 'number' ? p.round : undefined, status: typeof p.status === 'string' ? p.status : undefined }),
  );
  act('nudge', (r, m) => rooms.nudge(r, m));

  socket.on(
    'emote',
    handler<{ id: string }>(socket, (p) => {
      const { room, member } = current(socket);
      io.to(`r:${room.code}`).emit('emote', rooms.emote(room, member, p.id));
    }, true),
  );

  socket.on(
    'leave',
    handler(socket, () => {
      const { room, member } = current(socket);
      rooms.leave(room, member);
      socket.leave(`r:${room.code}`);
      socket.leave(`m:${room.code}:${member.id}`);
      socket.data.code = undefined;
      if (rooms.rooms.has(room.code)) broadcast(room);
    }),
  );

  socket.on('disconnect', () => detach(socket));
});

setInterval(() => rooms.sweep(), 60_000).unref();

// 내부 전용 포트: 새 파드가 방 상태를 받아 간다 → 이 파드는 draining (곧 SIGTERM)
if (HANDOFF_PORT) {
  serveHandoff(HANDOFF_PORT, HANDOFF_SECRET, () => {
    draining = true;
    rooms.freezeTimers();
    const snap = rooms.exportAll();
    console.log(`handoff: 방 ${snap.length}개를 새 파드로 넘김 — 종료 대기`);
    // 보통은 곧 SIGTERM이 온다. 새 파드가 뜨지 못해 안 오면 다시 진행을 받는다
    setTimeout(() => {
      if (shuttingDown) return;
      draining = false;
      rooms.resumeTimers();
      console.log('handoff: 종료되지 않아 다시 진행을 받음');
    }, 60_000).unref();
    return { rooms: snap };
  });
}

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  draining = true;
  console.log(`${signal}: 연결을 끊고 종료 (클라이언트는 새 파드로 자동 재접속)`);
  // 서버가 socket.disconnect()하면 클라이언트가 재접속하지 않으므로 전송 계층을 닫는다
  io.engine.close();
  http.close();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

http.listen(PORT, async () => {
  console.log(`server listening on :${PORT} (static: ${STATIC_DIR})`);
  // 이전 파드에게서 방을 받아온 뒤에야 Ready
  if (HANDOFF_PEER) {
    const body = await pullFromPeer<{ rooms: unknown }>(HANDOFF_PEER, HANDOFF_SECRET);
    if (body) console.log(`handoff: 이전 파드에서 방 ${rooms.importAll(body.rooms).imported}개를 넘겨받음`);
  }
  ready = true;
});
