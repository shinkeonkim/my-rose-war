import { GameConfig, validateConfig } from './config';

/** 0=북 1=북동 2=동 3=남동 4=남 5=남서 6=서 7=북서 (보드 위쪽이 북) */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const DIRS: { dx: number; dy: number; name: string; arrow: string }[] = [
  { dx: 0, dy: -1, name: '북', arrow: '↑' },
  { dx: 1, dy: -1, name: '북동', arrow: '↗' },
  { dx: 1, dy: 0, name: '동', arrow: '→' },
  { dx: 1, dy: 1, name: '남동', arrow: '↘' },
  { dx: 0, dy: 1, name: '남', arrow: '↓' },
  { dx: -1, dy: 1, name: '남서', arrow: '↙' },
  { dx: -1, dy: 0, name: '서', arrow: '←' },
  { dx: -1, dy: -1, name: '북서', arrow: '↖' },
];

export interface Card {
  id: string;
  dir: Dir;
  dist: number;
}

/** 칸 값: EMPTY, HOLE, 또는 돌 주인 좌석 번호(0~) */
export const EMPTY = -1;
export const HOLE = -2;

export interface Pos {
  x: number;
  y: number;
}

export type LogEntry =
  | { n: number; seat: number; type: 'place'; card: Card; from: Pos; to: Pos }
  | { n: number; seat: number; type: 'hero'; card: Card; from: Pos; to: Pos; victim: number }
  | { n: number; seat: number; type: 'draw'; reshuffled: boolean }
  | { n: number; seat: number; type: 'pass' };

export interface RoundState {
  size: number;
  board: number[];
  crown: Pos;
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  supply: number;
  heroes: number[];
  turn: number;
  /** 연속 패스 수 — 인원 수에 닿으면 아무도 움직일 수 없으므로 판 종료 */
  passes: number;
  log: LogEntry[];
  endReason: 'stones' | 'stuck' | null;
}

export interface MatchState {
  config: GameConfig;
  players: number;
  round: number;
  status: 'playing' | 'round-over' | 'match-over';
  state: RoundState;
  /** [판][좌석] */
  roundScores: number[][];
  /** [판][좌석] 사용한 기사 수 — 동점 판정용 */
  roundHeroesUsed: number[][];
  rng: number;
}

export type Move = { type: 'play'; cardId: string } | { type: 'draw' } | { type: 'pass' };

export class MoveError extends Error {}

// ---------- 난수 (매치 안에 상태를 저장해 재현 가능) ----------

function nextRandom(m: { rng: number }): number {
  // mulberry32
  let t = (m.rng = (m.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle<T>(arr: T[], m: { rng: number }): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(m) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- 생성 ----------

export function buildDeck(c: GameConfig): Card[] {
  const cards: Card[] = [];
  const dirs = (c.diagonals ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 2, 4, 6]) as Dir[];
  for (let copy = 0; copy < c.cardCopies; copy++) {
    for (const dir of dirs) {
      for (let dist = 1; dist <= c.maxDistance; dist++) cards.push({ id: `${dir}-${dist}-${copy}`, dir, dist });
    }
  }
  return cards;
}

export function center(size: number): Pos {
  const h = Math.floor(size / 2);
  return { x: h, y: h };
}

function makeBoard(c: GameConfig, m: { rng: number }): number[] {
  const size = c.boardSize;
  const board = new Array(size * size).fill(EMPTY);
  const mid = center(size);
  const midIdx = mid.y * size + mid.x;
  let left = c.holes;
  let guard = 0;
  // 180도 회전 대칭으로 짝지어 막는다 (공정성)
  while (left > 0 && guard++ < 1000) {
    const i = Math.floor(nextRandom(m) * size * size);
    const j = size * size - 1 - i;
    if (i === midIdx || board[i] === HOLE || board[j] === HOLE) continue;
    if (left >= 2 && i !== j) {
      board[i] = HOLE;
      board[j] = HOLE;
      left -= 2;
    } else {
      board[i] = HOLE;
      left -= 1;
    }
  }
  return board;
}

function newRound(c: GameConfig, players: number, round: number, m: { rng: number }): RoundState {
  const deck = shuffle(buildDeck(c), m);
  const hands: Card[][] = [];
  for (let p = 0; p < players; p++) hands.push(deck.splice(0, c.handLimit));
  return {
    size: c.boardSize,
    board: makeBoard(c, m),
    crown: center(c.boardSize),
    hands,
    deck,
    discard: [],
    supply: c.stones,
    heroes: new Array(players).fill(c.heroes),
    turn: (round - 1) % players,
    passes: 0,
    log: [],
    endReason: null,
  };
}

export function newMatch(c: GameConfig, players: number, rng: () => number = Math.random): MatchState {
  const errors = validateConfig(c, players);
  if (errors.length) throw new MoveError(errors[0]);
  const m = { rng: Math.floor(rng() * 4294967296) >>> 0 };
  const state = newRound(c, players, 1, m);
  return { config: c, players, round: 1, status: 'playing', state, roundScores: [], roundHeroesUsed: [], rng: m.rng };
}

export function startNextRound(match: MatchState) {
  if (match.status !== 'round-over') throw new MoveError('판이 아직 끝나지 않았습니다');
  match.round++;
  match.state = newRound(match.config, match.players, match.round, match);
  match.status = 'playing';
}

/**
 * 방장이 중지했던 매치를 바뀐 설정으로 이어간다 (my-lost-city와 같은 방식).
 * 끝난 판 점수·기사 사용은 그대로 두고, 진행 중이던 판은 버린 뒤 새 설정으로 다음 판을 시작한다.
 */
export function continueMatch(prev: MatchState, config: GameConfig, rng: () => number = Math.random): MatchState {
  const done = prev.roundScores.length;
  if (done >= config.rounds) throw new MoveError(`이미 ${done}판을 마쳤어요. 판 수를 ${done + 1} 이상으로 늘려야 이어갈 수 있어요`);
  const errors = validateConfig(config, prev.players);
  if (errors.length) throw new MoveError(errors[0]);
  const m = { rng: Math.floor(rng() * 4294967296) >>> 0 };
  const round = done + 1;
  const state = newRound(config, prev.players, round, m);
  return {
    config,
    players: prev.players,
    round,
    status: 'playing',
    state,
    roundScores: prev.roundScores.map((r) => [...r]),
    roundHeroesUsed: prev.roundHeroesUsed.map((r) => [...r]),
    rng: m.rng,
  };
}

// ---------- 규칙 ----------

/** 같은 편인지 (팀전이면 좌석 0·2 / 1·3) */
export function sameSide(teams: boolean, a: number, b: number): boolean {
  return a === b || (teams && a % 2 === b % 2);
}

export interface BoardLike {
  size: number;
  board: number[];
  crown: Pos;
  heroes: number[];
  supply: number;
}

export function targetOf(b: { size: number; crown: Pos }, card: Card): Pos | null {
  const d = DIRS[card.dir];
  const x = b.crown.x + d.dx * card.dist;
  const y = b.crown.y + d.dy * card.dist;
  if (x < 0 || y < 0 || x >= b.size || y >= b.size) return null;
  return { x, y };
}

export type PlayKind = 'place' | 'hero';

/** 카드를 낼 때 일어날 일 — 낼 수 없으면 이유 문구 */
export function playOutcome(b: BoardLike, teams: boolean, seat: number, card: Card): { kind: PlayKind; to: Pos } | { reason: string; to: Pos | null } {
  const to = targetOf(b, card);
  if (!to) return { reason: '왕관이 보드 밖으로 나가요', to: null };
  const v = b.board[to.y * b.size + to.x];
  if (v === HOLE) return { reason: '막힌 칸으로는 갈 수 없어요', to };
  if (v === EMPTY) {
    if (b.supply <= 0) return { reason: '남은 돌이 없어요', to };
    return { kind: 'place', to };
  }
  if (sameSide(teams, v, seat)) return { reason: v === seat ? '이미 내 돌이 있는 칸이에요' : '같은 팀 돌이 있는 칸이에요', to };
  if ((b.heroes[seat] ?? 0) <= 0) return { reason: '기사 카드가 없어 상대 돌 칸으로 갈 수 없어요', to };
  return { kind: 'hero', to };
}

export function canDraw(m: MatchState, seat: number): boolean {
  const s = m.state;
  return s.hands[seat].length < m.config.handLimit && s.deck.length + s.discard.length > 0;
}

export function legalPlays(m: MatchState, seat: number): { card: Card; kind: PlayKind }[] {
  const out: { card: Card; kind: PlayKind }[] = [];
  for (const card of m.state.hands[seat]) {
    const r = playOutcome(m.state, m.config.teams, seat, card);
    if ('kind' in r) out.push({ card, kind: r.kind });
  }
  return out;
}

export function mustPass(m: MatchState, seat: number): boolean {
  return legalPlays(m, seat).length === 0 && !canDraw(m, seat);
}

export function applyMove(m: MatchState, seat: number, move: Move) {
  if (m.status !== 'playing') throw new MoveError('진행 중인 판이 아닙니다');
  const s = m.state;
  if (seat !== s.turn) throw new MoveError('지금은 당신의 차례가 아닙니다');
  const n = (s.log[s.log.length - 1]?.n ?? 0) + 1;

  if (move.type === 'play') {
    const idx = s.hands[seat].findIndex((c) => c.id === move.cardId);
    if (idx < 0) throw new MoveError('손에 없는 카드입니다');
    const card = s.hands[seat][idx];
    const r = playOutcome(s, m.config.teams, seat, card);
    if (!('kind' in r)) throw new MoveError(r.reason);
    const from = { ...s.crown };
    const i = r.to.y * s.size + r.to.x;
    s.hands[seat].splice(idx, 1);
    s.discard.push(card);
    s.crown = r.to;
    if (r.kind === 'place') {
      s.board[i] = seat;
      s.supply--;
      s.log.push({ n, seat, type: 'place', card, from, to: r.to });
    } else {
      const victim = s.board[i];
      s.board[i] = seat;
      s.heroes[seat]--;
      s.log.push({ n, seat, type: 'hero', card, from, to: r.to, victim });
    }
    s.passes = 0;
    if (s.supply <= 0) return endRound(m, 'stones');
  } else if (move.type === 'draw') {
    if (s.hands[seat].length >= m.config.handLimit) throw new MoveError(`손패가 ${m.config.handLimit}장이면 더 가져올 수 없어요`);
    let reshuffled = false;
    if (s.deck.length === 0) {
      if (s.discard.length === 0) throw new MoveError('가져올 카드가 없어요');
      s.deck = shuffle(s.discard, m);
      s.discard = [];
      reshuffled = true;
    }
    s.hands[seat].push(s.deck.pop()!);
    s.passes = 0;
    s.log.push({ n, seat, type: 'draw', reshuffled });
  } else if (move.type === 'pass') {
    if (!mustPass(m, seat)) throw new MoveError('할 수 있는 행동이 있으면 패스할 수 없어요');
    s.passes++;
    s.log.push({ n, seat, type: 'pass' });
    if (s.passes >= m.players) return endRound(m, 'stuck');
  } else {
    throw new MoveError('잘못된 요청입니다');
  }
  s.turn = (s.turn + 1) % m.players;
}

function endRound(m: MatchState, reason: 'stones' | 'stuck') {
  const s = m.state;
  s.endReason = reason;
  m.roundScores.push(scoreBoard(s.board, s.size, m.config, m.players).scores);
  m.roundHeroesUsed.push(s.heroes.map((h) => m.config.heroes - h));
  m.status = m.round >= m.config.rounds ? 'match-over' : 'round-over';
}

// ---------- 점수 ----------

export interface Group {
  /** 점수 주인: 좌석 (팀전이면 팀 0/1) */
  side: number;
  cells: number[];
  score: number;
}

/** 같은 편 돌이 이어진 영역마다 칸 수(또는 제곱) 점수. scores는 좌석별 (팀전이면 팀 점수를 두 좌석에 똑같이) */
export function scoreBoard(board: number[], size: number, c: Pick<GameConfig, 'teams' | 'squareScoring' | 'diagonalGroups'>, players: number) {
  const sideOf = (v: number) => (c.teams ? v % 2 : v);
  const seen = new Uint8Array(board.length);
  const groups: Group[] = [];
  const steps = c.diagonalGroups ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < board.length; i++) {
    if (board[i] < 0 || seen[i]) continue;
    const side = sideOf(board[i]);
    const cells: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      cells.push(k);
      const x = k % size;
      const y = (k - x) / size;
      for (const [dx, dy] of steps) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (!seen[j] && board[j] >= 0 && sideOf(board[j]) === side) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    groups.push({ side, cells, score: c.squareScoring ? cells.length * cells.length : cells.length });
  }
  const sideScores = new Array(c.teams ? 2 : players).fill(0);
  for (const g of groups) sideScores[g.side] += g.score;
  const scores = Array.from({ length: players }, (_, p) => sideScores[c.teams ? p % 2 : p]);
  return { groups, scores };
}

export function matchTotals(m: Pick<MatchState, 'roundScores' | 'players'>): number[] {
  const t = new Array(m.players).fill(0);
  for (const r of m.roundScores) r.forEach((v, i) => (t[i] += v));
  return t;
}

/** 순위: 점수 높은 순, 같으면 기사를 덜 쓴 쪽 (팀전은 팀 합산 기사) */
export function standings(m: Pick<MatchState, 'roundScores' | 'roundHeroesUsed' | 'players' | 'config'>): { seat: number; total: number; heroesUsed: number; rank: number }[] {
  const totals = matchTotals(m);
  const used = new Array(m.players).fill(0);
  for (const r of m.roundHeroesUsed) r.forEach((v, i) => (used[i] += v));
  const sideUsed = (p: number) => (m.config.teams ? used.filter((_, i) => i % 2 === p % 2).reduce((a, b) => a + b, 0) : used[p]);
  const rows = totals.map((total, seat) => ({ seat, total, heroesUsed: sideUsed(seat), rank: 0 }));
  const sorted = [...rows].sort((a, b) => b.total - a.total || a.heroesUsed - b.heroesUsed);
  for (const r of rows) r.rank = 1 + sorted.filter((o) => o.total > r.total || (o.total === r.total && o.heroesUsed < r.heroesUsed)).length;
  return rows;
}

// ---------- 시간 초과 / 대신 진행 ----------

/** 자동 진행: 돌 놓기 > 카드 가져오기 > 기사 사용 > 패스 */
export function autoMove(m: MatchState): Move {
  const seat = m.state.turn;
  const plays = legalPlays(m, seat);
  const place = plays.filter((p) => p.kind === 'place');
  if (place.length) return { type: 'play', cardId: place[Math.floor(nextRandom(m) * place.length)].card.id };
  if (canDraw(m, seat)) return { type: 'draw' };
  if (plays.length) return { type: 'play', cardId: plays[0].card.id };
  return { type: 'pass' };
}
