import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  CLASSIC,
  EMOTES,
  EmoteEvent,
  GameConfig,
  RoomView,
  MatchState,
  Move,
  MoveError,
  applyMove,
  autoMove,
  continueMatch,
  matchTotals,
  PausedInfo,
  deckSize,
  expectedTurns,
  newMatch,
  openCells,
  sanitizeConfig,
  startNextRound,
  validateConfig,
  viewFor,
} from '@rw/engine';

export const MAX_PLAYERS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 모두 나간(접속자 0) 상태로 이만큼 아무 일도 없으면 방을 해제한다. 기본 60분 (ROOM_IDLE_MINUTES) */
export const IDLE_ROOM_MS = Math.max(1, Number(process.env.ROOM_IDLE_MINUTES ?? 60) || 60) * 60 * 1000;
/** 차례인 사람이 이만큼 끊겨 있으면 다른 플레이어가 대신 진행할 수 있다 */
export const NUDGE_AFTER_MS = 20_000;
const PW_FAIL_WINDOW_MS = 5 * 60 * 1000;
const PW_FAIL_LIMIT = 10;
export const MAX_ROOMS = Math.max(1, Number(process.env.MAX_ROOMS ?? 5) || 5);

const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

export interface Member {
  id: string;
  token: string;
  name: string;
  role: 'player' | 'spectator';
  /** 게임 중 좌석 번호 */
  seat: number | null;
  connections: number;
  disconnectedAt: number | null;
  /** 게임이 끝난 뒤 결과 화면에서 로비로 돌아왔는지 */
  backInLobby: boolean;
  /** 최근 감정 표현 보낸 시각들 (도배 방지) */
  emoteTimes: number[];
}

export interface Room {
  code: string;
  password: { salt: Buffer; hash: Buffer } | null;
  hostId: string;
  config: GameConfig;
  members: Member[];
  match: MatchState | null;
  turnDeadline: number | null;
  timer: NodeJS.Timeout | null;
  lastActive: number;
  failedPasswords: number[];
  /** 방장이 중지한 매치와 그때의 좌석(멤버 id) — 로비에서 설정을 바꾼 뒤 이어서 할 수 있다 */
  paused: { match: MatchState; seatIds: string[] } | null;
}

export class RoomError extends Error {}

/** 무중단 배포 때 이전 파드 → 새 파드로 넘기는 방 하나 */
export interface RoomSnapshot {
  code: string;
  password: { salt: string; hash: string } | null;
  hostId: string;
  config: GameConfig;
  members: Member[];
  match: MatchState | null;
  paused?: Room['paused'];
  turnRemainingMs: number | null;
  idleMs: number;
}

/** 로비 조작(설정·인원·시작)이 가능한 상태: 게임이 없거나 매치가 끝난 뒤 */
function lobbyOpen(room: Room): boolean {
  return !room.match || room.match.status === 'match-over';
}

/** 매치가 끝났는데 아직 결과 화면에 남아 있는 사람 */
function inResults(room: Room, m: Member): boolean {
  return room.match?.status === 'match-over' && !m.backInLobby;
}

type Listener = (room: Room) => void;

export class Rooms {
  rooms = new Map<string, Room>();
  constructor(
    private onChange: Listener = () => {},
    private maxRooms = MAX_ROOMS,
  ) {}

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      let code = '';
      for (let j = 0; j < 4; j++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError('방을 더 만들 수 없습니다');
  }

  get(code: string): Room {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) throw new RoomError('방을 찾을 수 없습니다');
    return room;
  }

  create(name: string, password?: string): { room: Room; member: Member } {
    if (this.rooms.size >= this.maxRooms) this.sweep();
    if (this.rooms.size >= this.maxRooms) {
      throw new RoomError(`지금은 방이 가득 찼습니다 (최대 ${this.maxRooms}개). 비어 있는 방은 1시간 뒤 자동으로 정리돼요 — 기존 방에 참가하거나 나중에 다시 시도하세요`);
    }
    const code = this.newCode();
    const member = makeMember(name, 'player');
    const room: Room = {
      code,
      password: password ? hashPassword(password) : null,
      hostId: member.id,
      config: { ...CLASSIC },
      members: [member],
      match: null,
      turnDeadline: null,
      timer: null,
      lastActive: Date.now(),
      failedPasswords: [],
      paused: null,
    };
    this.rooms.set(code, room);
    return { room, member };
  }

  /** 토큰이 있으면 재접속, 없으면 새 참가 */
  join(code: string, opts: { name: string; password?: string; token?: string; spectator?: boolean }): { room: Room; member: Member } {
    const room = this.get(code);
    if (opts.token) {
      const existing = room.members.find((m) => m.token === opts.token);
      if (existing) return { room, member: existing };
    }
    if (room.password) {
      const now = Date.now();
      room.failedPasswords = room.failedPasswords.filter((t) => now - t < PW_FAIL_WINDOW_MS);
      if (room.failedPasswords.length >= PW_FAIL_LIMIT) throw new RoomError('암호 시도가 너무 많습니다. 몇 분 뒤 다시 시도하세요');
      if (!checkPassword(room.password, opts.password ?? '')) {
        room.failedPasswords.push(now);
        throw new RoomError('암호가 틀렸습니다');
      }
    }
    const playerCount = room.members.filter((m) => m.role === 'player').length;
    const asPlayer = !opts.spectator && lobbyOpen(room) && playerCount < MAX_PLAYERS;
    const member = makeMember(uniqueName(room, opts.name), asPlayer ? 'player' : 'spectator');
    member.backInLobby = true; // 끝난 매치 결과를 볼 필요 없이 바로 대기 로비로
    room.members.push(member);
    this.touch(room);
    return { room, member };
  }

  connect(room: Room, member: Member) {
    member.connections++;
    member.disconnectedAt = null;
    this.touch(room);
  }

  disconnect(room: Room, member: Member) {
    member.connections = Math.max(0, member.connections - 1);
    if (member.connections === 0) member.disconnectedAt = Date.now();
    if (member.connections === 0 && !room.match && member.role === 'spectator') {
      // 로비 관전자는 끊기면 정리
      room.members = room.members.filter((m) => m !== member);
    }
    this.touch(room);
  }

  leave(room: Room, member: Member) {
    if (room.match && member.seat !== null && room.match.status !== 'match-over') {
      throw new RoomError('게임 중에는 나갈 수 없습니다 (연결을 끊으면 다시 들어올 수 있어요)');
    }
    room.members = room.members.filter((m) => m !== member);
    if (room.members.length === 0) return this.remove(room);
    this.ensureHost(room);
    this.touch(room);
  }

  kick(room: Room, by: Member, targetId: string) {
    this.requireHost(room, by);
    if (!lobbyOpen(room)) throw new RoomError('게임 중에는 내보낼 수 없습니다');
    if (targetId === by.id) throw new RoomError('자기 자신은 내보낼 수 없습니다');
    room.members = room.members.filter((m) => m.id !== targetId);
    this.touch(room);
  }

  setRole(room: Room, member: Member, role: Member['role']) {
    if (!lobbyOpen(room)) throw new RoomError('게임 중에는 바꿀 수 없습니다');
    if (role === 'player' && member.role !== 'player') {
      if (room.members.filter((m) => m.role === 'player').length >= MAX_PLAYERS) throw new RoomError(`플레이어는 최대 ${MAX_PLAYERS}명입니다`);
    }
    member.role = role;
    this.touch(room);
  }

  /** 로비에서 플레이어 순서 이동 */
  moveMember(room: Room, by: Member, targetId: string, dir: -1 | 1) {
    this.requireHost(room, by);
    if (!lobbyOpen(room)) throw new RoomError('게임 중에는 바꿀 수 없습니다');
    const i = room.members.findIndex((m) => m.id === targetId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= room.members.length) return;
    [room.members[i], room.members[j]] = [room.members[j], room.members[i]];
    this.touch(room);
  }

  setConfig(room: Room, by: Member, input: Partial<GameConfig>) {
    this.requireHost(room, by);
    if (!lobbyOpen(room)) throw new RoomError('게임 중에는 설정을 바꿀 수 없습니다');
    room.config = sanitizeConfig({ ...room.config, ...input });
    this.touch(room);
  }

  setPassword(room: Room, by: Member, password: string | null) {
    this.requireHost(room, by);
    room.password = password ? hashPassword(password) : null;
    this.touch(room);
  }

  /** force: 아직 결과 화면에 있는 사람을 기다리지 않고 시작 */
  start(room: Room, by: Member, force = false) {
    this.requireHost(room, by);
    if (!lobbyOpen(room)) throw new RoomError('이미 게임 중입니다');
    const players = room.members.filter((m) => m.role === 'player');
    const waiting = players.filter((m) => m.connections > 0 && inResults(room, m) && m !== by);
    if (waiting.length && !force) throw new RoomError(`${waiting.map((m) => m.name).join(', ')} 님이 아직 결과를 보고 있어요`);
    room.members.forEach((m) => (m.backInLobby = false));
    const errors = validateConfig(room.config, players.length);
    if (errors.length) throw new RoomError(errors[0]);
    room.members.forEach((m) => (m.seat = null));
    players.forEach((m, i) => (m.seat = i));
    room.match = newMatch(room.config, players.length, rng);
    room.paused = null; // 새 게임을 시작하면 중지했던 게임은 버린다
    this.resetTimer(room);
    this.touch(room);
  }

  move(room: Room, member: Member, move: Move) {
    const match = room.match;
    if (!match) throw new RoomError('게임이 시작되지 않았습니다');
    if (member.seat === null) throw new RoomError('관전자는 플레이할 수 없습니다');
    if (!isMove(move)) throw new RoomError('잘못된 요청입니다');
    const before = match.state.turn;
    const beforeRound = match.round;
    try {
      applyMove(match, member.seat, move);
    } catch (e) {
      if (e instanceof MoveError) throw new RoomError(e.message);
      throw e;
    }
    if (match.state.turn !== before || match.round !== beforeRound || match.status !== 'playing') this.resetTimer(room);
    this.touch(room);
  }

  /** 다음 판 시작 또는 (매치 종료 후) 로비로 */
  /** expect: 클라이언트가 본 판 번호/상태 — 이미 다른 사람이 진행했으면 조용히 무시 */
  next(room: Room, by: Member, expect?: { round?: number; status?: string }) {
    const match = room.match;
    if (!match) {
      if (expect?.status === 'match-over') return;
      throw new RoomError('게임이 없습니다');
    }
    if (expect && (expect.round !== undefined && expect.round !== match.round || (expect.status && expect.status !== match.status))) return;
    if (by.seat === null && by.id !== room.hostId) throw new RoomError('플레이어만 진행할 수 있습니다');
    if (match.status === 'round-over') {
      startNextRound(match);
      this.resetTimer(room);
    } else if (match.status === 'match-over') {
      this.back(room, by);
      return;
    } else {
      throw new RoomError('판이 아직 끝나지 않았습니다');
    }
    this.touch(room);
  }

  /** 매치가 끝난 뒤 각자 결과 화면에서 대기 로비로 돌아간다. 모두 돌아오면 끝난 매치를 정리 */
  back(room: Room, member: Member) {
    if (room.match?.status !== 'match-over') return;
    member.backInLobby = true;
    const stillViewing = room.members.some((m) => m.connections > 0 && inResults(room, m));
    if (!stillViewing) {
      room.match = null;
      room.members.forEach((m) => {
        m.seat = null;
        m.backInLobby = false;
      });
      this.clearTimer(room);
    }
    this.touch(room);
  }

  /** 감정 표현: 목록에 있는 것만, 1초에 1번 · 10초에 5번까지 */
  emote(room: Room, member: Member, id: unknown): EmoteEvent {
    const e = EMOTES.find((x) => x.id === id);
    if (!e) throw new RoomError('알 수 없는 감정 표현입니다');
    const now = Date.now();
    member.emoteTimes = member.emoteTimes.filter((t) => now - t < 10_000);
    const last = member.emoteTimes[member.emoteTimes.length - 1];
    if ((last !== undefined && now - last < 1000) || member.emoteTimes.length >= 5) throw new RoomError('조금 천천히 보내 주세요');
    member.emoteTimes.push(now);
    this.emoteSeq = (this.emoteSeq + 1) % 1_000_000;
    return { from: member.id, name: member.name, seat: room.match ? member.seat : null, id: e.id, n: this.emoteSeq };
  }
  private emoteSeq = 0;

  /** 방장이 진행 중인 게임을 중지 → 모두 로비로. 로비에서 설정을 바꾼 뒤 resume으로 이어간다 */
  stop(room: Room, by: Member) {
    this.requireHost(room, by);
    const match = room.match;
    if (!match || match.status === 'match-over') throw new RoomError('진행 중인 게임이 없습니다');
    const seatIds: string[] = [];
    for (const m of room.members) if (m.seat !== null) seatIds[m.seat] = m.id;
    room.paused = { match, seatIds };
    room.match = null;
    room.members.forEach((m) => {
      m.seat = null;
      m.backInLobby = false;
    });
    this.clearTimer(room);
    this.touch(room);
  }

  /** 중지했던 게임 이어서 하기: 설정이 같으면 하던 판 그대로, 바뀌었으면 끝난 판 점수를 이어 새 판 */
  resume(room: Room, by: Member) {
    this.requireHost(room, by);
    if (room.match) throw new RoomError('이미 게임 중입니다');
    const blocked = this.resumeBlocked(room);
    if (blocked) throw new RoomError(blocked);
    const { match, seatIds } = room.paused!;
    if (sameConfig(match.config, room.config)) {
      room.match = match;
    } else {
      try {
        room.match = continueMatch(match, room.config, rng);
      } catch (e) {
        if (e instanceof MoveError) throw new RoomError(e.message);
        throw e;
      }
    }
    room.members.forEach((m) => {
      const i = seatIds.indexOf(m.id);
      m.seat = i >= 0 ? i : null;
      m.backInLobby = false;
    });
    room.paused = null;
    this.resetTimer(room);
    this.touch(room);
  }

  private resumeBlocked(room: Room): string | null {
    const p = room.paused;
    if (!p) return '중지한 게임이 없습니다';
    const players = room.members.filter((m) => m.role === 'player');
    const missing = p.seatIds.filter((id) => !players.some((m) => m.id === id));
    const extra = players.filter((m) => !p.seatIds.includes(m.id));
    if (missing.length || extra.length) {
      const names = p.seatIds.map((id) => room.members.find((m) => m.id === id)?.name ?? '나간 사람');
      return `중지할 때의 플레이어(${names.join(', ')})가 그대로 있어야 이어갈 수 있어요`;
    }
    if (sameConfig(p.match.config, room.config)) return null;
    const errors = validateConfig(room.config, p.seatIds.length);
    if (errors.length) return errors[0];
    const done = p.match.roundScores.length;
    if (done >= room.config.rounds) return `이미 ${done}판을 마쳤어요. 판 수를 ${done + 1} 이상으로 늘려야 이어갈 수 있어요`;
    return null;
  }

  private pausedInfo(room: Room): PausedInfo | null {
    const p = room.paused;
    if (!p) return null;
    const totals = matchTotals(p.match);
    return {
      round: p.match.round,
      rounds: p.match.config.rounds,
      roundOver: p.match.status === 'round-over',
      players: p.seatIds.map((id, i) => ({ name: room.members.find((m) => m.id === id)?.name ?? '나간 사람', total: totals[i] })),
      sameConfig: sameConfig(p.match.config, room.config),
      blocked: this.resumeBlocked(room),
    };
  }

  /** 방장이 방을 닫는다 — 모두 내보내고 방 해제 */
  close(room: Room, by: Member) {
    this.requireHost(room, by);
    this.remove(room);
  }

  /** 끊긴 플레이어의 차례를 다른 플레이어가 대신 진행 (돌 놓기 > 카드 가져오기 > 기사 > 패스 순으로 자동) */
  nudge(room: Room, by: Member) {
    const match = room.match;
    if (!match || match.status !== 'playing') throw new RoomError('진행 중인 판이 아닙니다');
    if (by.seat === null) throw new RoomError('플레이어만 할 수 있습니다');
    const wait = this.nudgeInMs(room);
    if (wait === null) throw new RoomError('차례인 플레이어가 접속해 있습니다');
    if (wait > 0) throw new RoomError(`${Math.ceil(wait / 1000)}초 뒤에 대신 진행할 수 있어요`);
    this.timeout(room);
  }

  nudgeInMs(room: Room, now = Date.now()): number | null {
    const match = room.match;
    if (!match || match.status !== 'playing') return null;
    const cur = room.members.find((m) => m.seat === match.state.turn);
    if (!cur || cur.connections > 0 || cur.disconnectedAt === null) return null;
    return Math.max(0, NUDGE_AFTER_MS - (now - cur.disconnectedAt));
  }

  /** 시간 초과: 현재 차례를 자동으로 진행 */
  timeout(room: Room) {
    const match = room.match;
    if (!match || match.status !== 'playing') return;
    applyMove(match, match.state.turn, autoMove(match));
    this.resetTimer(room);
    this.touch(room);
  }

  /** ms를 주면 그만큼 남은 타이머로 (무중단 배포 때 이어받기) */
  private resetTimer(room: Room, ms?: number) {
    this.clearTimer(room);
    const sec = room.match?.config.turnTimerSec ?? 0;
    if (!room.match || room.match.status !== 'playing' || sec <= 0) return;
    const wait = Math.max(0, ms ?? sec * 1000);
    room.turnDeadline = Date.now() + wait;
    room.timer = setTimeout(() => {
      room.timer = null;
      this.timeout(room);
      this.onChange(room);
    }, wait);
    room.timer.unref?.();
  }

  // ---------- 무중단 배포: 방 상태 넘겨주기/받기 ----------

  /** 방을 넘겨준 뒤 종료를 기다리는 동안 턴 타이머 정지 (남은 시간은 turnDeadline에 남겨 둠) */
  freezeTimers() {
    for (const room of this.rooms.values()) if (room.timer) clearTimeout(room.timer), (room.timer = null);
  }

  /** 넘기기가 무산됐을 때(새 파드가 못 뜸) 남은 시간으로 타이머 재개 */
  resumeTimers(now = Date.now()) {
    for (const room of this.rooms.values()) if (room.turnDeadline) this.resetTimer(room, room.turnDeadline - now);
  }

  /** 모든 방을 JSON으로 (타이머는 남은 시간으로, 암호 해시는 base64로) */
  exportAll(now = Date.now()): RoomSnapshot[] {
    return [...this.rooms.values()].map((r) => ({
      code: r.code,
      password: r.password ? { salt: r.password.salt.toString('base64'), hash: r.password.hash.toString('base64') } : null,
      hostId: r.hostId,
      config: r.config,
      members: r.members.map((m) => ({ ...m, connections: 0, emoteTimes: [] })),
      match: r.match,
      paused: r.paused,
      turnRemainingMs: r.turnDeadline ? Math.max(0, r.turnDeadline - now) : null,
      idleMs: now - r.lastActive,
    }));
  }

  /** 넘겨받은 방을 등록. 같은 코드가 이미 있으면 건너뜀. 접속은 모두 끊긴 것으로 시작 (곧 자동 재접속) */
  importAll(snapshots: unknown, now = Date.now()): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    if (!Array.isArray(snapshots)) throw new RoomError('잘못된 스냅샷');
    for (const s of snapshots as RoomSnapshot[]) {
      if (!s || typeof s.code !== 'string' || !Array.isArray(s.members) || this.rooms.has(s.code)) {
        skipped++;
        continue;
      }
      const room: Room = {
        code: s.code,
        password: s.password ? { salt: Buffer.from(s.password.salt, 'base64'), hash: Buffer.from(s.password.hash, 'base64') } : null,
        hostId: s.hostId,
        config: sanitizeConfig(s.config ?? {}),
        members: s.members.map((m) => ({ ...m, connections: 0, disconnectedAt: m.disconnectedAt ?? now, emoteTimes: [] })),
        match: s.match,
        turnDeadline: null,
        timer: null,
        lastActive: now - Math.max(0, Number(s.idleMs) || 0),
        failedPasswords: [],
        paused: s.paused ?? null,
      };
      this.rooms.set(room.code, room);
      if (s.turnRemainingMs !== null && s.turnRemainingMs !== undefined) this.resetTimer(room, s.turnRemainingMs);
      imported++;
    }
    return { imported, skipped };
  }

  private clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.turnDeadline = null;
  }

  private ensureHost(room: Room) {
    const host = room.members.find((m) => m.id === room.hostId);
    if (host && host.connections > 0) return;
    const next = room.members.find((m) => m.connections > 0 && m.role === 'player') ?? room.members.find((m) => m.connections > 0);
    if (next) room.hostId = next.id;
    else if (!host && room.members[0]) room.hostId = room.members[0].id;
  }

  private requireHost(room: Room, m: Member) {
    // 방장이 접속해 있지 않으면 요청한 플레이어가 방장을 이어받는다
    const host = room.members.find((x) => x.id === room.hostId);
    if ((!host || host.connections === 0) && m.connections > 0 && m.role === 'player') room.hostId = m.id;
    if (room.hostId !== m.id) throw new RoomError('방장만 할 수 있습니다');
  }

  private touch(room: Room) {
    room.lastActive = Date.now();
  }

  remove(room: Room) {
    this.clearTimer(room);
    this.rooms.delete(room.code);
  }

  /** 모두 나간 채(접속자 0) IDLE_ROOM_MS 동안 활동이 없는 방 해제 — 1분마다 + 방 생성 시 호출 */
  sweep(now = Date.now(), idleMs = IDLE_ROOM_MS) {
    for (const room of this.rooms.values()) {
      const anyone = room.members.some((m) => m.connections > 0);
      if (!anyone && now - room.lastActive > idleMs) this.remove(room);
    }
  }

  view(room: Room, member: Member): RoomView {
    const players = room.members.filter((m) => m.role === 'player');
    const seats: string[] = [];
    for (const m of room.members) if (m.seat !== null) seats[m.seat] = m.name;
    return {
      code: room.code,
      hasPassword: !!room.password,
      you: member.id,
      hostId: room.hostId,
      members: room.members.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        seat: m.seat,
        connected: m.connections > 0,
        inResults: inResults(room, m),
        awayMs: m.connections > 0 || m.disconnectedAt === null ? null : Date.now() - m.disconnectedAt,
        isHost: m.id === room.hostId,
      })),
      config: room.config,
      lobby: {
        playerCount: players.length,
        deckSize: deckSize(room.config),
        openCells: openCells(room.config),
        expectedTurns: Math.round(expectedTurns(room.config, Math.max(players.length, 2)) * 10) / 10,
        inResults: room.members.filter((m) => m.role === 'player' && m.connections > 0 && inResults(room, m)).map((m) => m.name),
        paused: this.pausedInfo(room),
        errors: validateConfig(room.config, Math.max(players.length, 2)).concat(players.length < 2 ? ['플레이어가 2명 이상 필요합니다'] : []),
      },
      // 매치가 끝난 뒤 로비로 돌아온 사람에게는 게임 대신 대기 로비를 보여준다
      game: room.match && !(room.match.status === 'match-over' && member.backInLobby) ? viewFor(room.match, member.seat ?? -1) : null,
      seats,
      turnRemainingMs: room.turnDeadline ? Math.max(0, room.turnDeadline - Date.now()) : null,
      nudgeInMs: this.nudgeInMs(room),
    };
  }
}

function makeMember(name: string, role: Member['role']): Member {
  return {
    id: randomBytes(6).toString('hex'),
    token: randomBytes(18).toString('base64url'),
    name: cleanName(name),
    role,
    seat: null,
    connections: 0,
    disconnectedAt: null,
    backInLobby: false,
    emoteTimes: [],
  };
}

export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) : '';
  return s || '기사';
}

function uniqueName(room: Room, name: string): string {
  const base = cleanName(name);
  let n = base;
  let i = 2;
  while (room.members.some((m) => m.name === n)) n = `${base}${i++}`;
  return n;
}

export function normalizeCode(code: unknown): string {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(pw.slice(0, 64), salt, 32) };
}

function checkPassword(p: { salt: Buffer; hash: Buffer }, pw: string): boolean {
  const h = scryptSync(String(pw).slice(0, 64), p.salt, 32);
  return timingSafeEqual(h, p.hash);
}

function isMove(m: any): m is Move {
  if (!m || typeof m !== 'object') return false;
  if (m.type === 'play') return typeof m.cardId === 'string';
  return m.type === 'draw' || m.type === 'pass';
}

function sameConfig(a: GameConfig, b: GameConfig): boolean {
  return (Object.keys(b) as (keyof GameConfig)[]).every((k) => a[k] === b[k]);
}
