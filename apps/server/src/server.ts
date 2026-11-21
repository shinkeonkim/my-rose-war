import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { Server, Socket } from 'socket.io';
import { Member, Room, RoomError, Rooms, normalizeCode } from './rooms';

const PORT = Number(process.env.PORT ?? 3001);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? join(process.cwd(), 'apps/web/dist'));
const PUBLIC_URL = process.env.PUBLIC_URL || null;

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

function handler<T>(socket: Socket, fn: (payload: T) => Record<string, unknown> | void) {
  return (payload: T, ack?: Ack) => {
    try {
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
    }),
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
    }),
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
    }),
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

http.listen(PORT, () => {
  console.log(`server listening on :${PORT} (static: ${STATIC_DIR})`);
});
