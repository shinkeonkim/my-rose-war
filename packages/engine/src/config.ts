export interface GameConfig {
  /** 보드 한 변 칸 수 (원작 9) */
  boardSize: number;
  /** 공용 돌 개수 — 다 쓰면 판 종료 (원작 52) */
  stones: number;
  /** 플레이어당 기사(영웅) 카드 수 (원작 4) */
  heroes: number;
  /** 손패 상한 (원작 5) */
  handLimit: number;
  /** 이동 카드의 최대 거리 (원작 3 → 1·2·3) */
  maxDistance: number;
  /** 대각선 방향 카드 포함 (원작: 8방향) */
  diagonals: boolean;
  /** 같은 이동 카드를 몇 벌 섞을지 (원작 1 → 24장) */
  cardCopies: number;
  /** 무작위로 막힌 칸 수 (원작 0) */
  holes: number;
  /** 영역 점수 = 칸 수의 제곱 (끄면 칸 수 그대로) */
  squareScoring: boolean;
  /** 대각선으로 붙은 돌도 같은 영역 (원작: 상하좌우만) */
  diagonalGroups: boolean;
  /** 모든 손패 공개 (원작 규칙) */
  openHands: boolean;
  rounds: number;
  /** 0 = 제한 없음 */
  turnTimerSec: number;
  /** 4인 팀전 (좌석 0·2 vs 1·3, 같은 팀 돌은 한 영역으로 계산) */
  teams: boolean;
}

export const LIMITS = {
  boardSize: [5, 13],
  stones: [8, 168],
  heroes: [0, 8],
  handLimit: [3, 8],
  maxDistance: [1, 4],
  cardCopies: [1, 3],
  holes: [0, 16],
  rounds: [1, 5],
  turnTimerSec: [0, 300],
  players: [2, 4],
} as const;

export const CLASSIC: GameConfig = {
  boardSize: 9,
  stones: 52,
  heroes: 4,
  handLimit: 5,
  maxDistance: 3,
  diagonals: true,
  cardCopies: 1,
  holes: 0,
  squareScoring: true,
  diagonalGroups: false,
  openHands: true,
  rounds: 1,
  turnTimerSec: 0,
  teams: false,
};

export interface Preset {
  id: string;
  label: string;
  description: string;
  config: GameConfig;
}

export const PRESETS: Preset[] = [
  { id: 'classic', label: '원작 (2인)', description: '9×9 · 돌 52 · 기사 4 · 카드 24장', config: CLASSIC },
  {
    id: 'three',
    label: '3인 권장',
    description: '11×11 · 돌 84 · 기사 3 · 카드 2벌',
    config: { ...CLASSIC, boardSize: 11, stones: 84, heroes: 3, cardCopies: 2 },
  },
  {
    id: 'four',
    label: '4인 권장',
    description: '11×11 · 돌 92 · 기사 3 · 손패 4',
    config: { ...CLASSIC, boardSize: 11, stones: 92, heroes: 3, handLimit: 4, cardCopies: 2 },
  },
  {
    id: 'teams',
    label: '4인 팀전',
    description: '좌석 1·3 vs 2·4, 팀 돌이 한 영역',
    config: { ...CLASSIC, boardSize: 11, stones: 92, heroes: 3, handLimit: 4, cardCopies: 2, teams: true },
  },
  {
    id: 'quick',
    label: '빠른 게임',
    description: '7×7 · 돌 30 · 거리 1~2',
    config: { ...CLASSIC, boardSize: 7, stones: 30, heroes: 2, handLimit: 4, maxDistance: 2, cardCopies: 2 },
  },
  {
    id: 'ruins',
    label: '폐허 지도',
    description: '9×9에 막힌 칸 8개',
    config: { ...CLASSIC, holes: 8, stones: 48 },
  },
];

export function directionCount(c: GameConfig): number {
  return c.diagonals ? 8 : 4;
}

export function deckSize(c: GameConfig): number {
  return directionCount(c) * c.maxDistance * c.cardCopies;
}

/** 돌을 놓을 수 있는 칸 수 (왕관 시작 칸 제외) */
export function openCells(c: GameConfig): number {
  return c.boardSize * c.boardSize - c.holes - 1;
}

/** 플레이어 한 명당 대략적인 턴 수 (돌 수 기준) */
export function expectedTurns(c: GameConfig, players: number): number {
  return Math.min(c.stones, openCells(c)) / players;
}

export function validateConfig(c: GameConfig, players: number): string[] {
  const errors: string[] = [];
  const check = (key: keyof typeof LIMITS, v: number, label: string) => {
    const [lo, hi] = LIMITS[key];
    if (!Number.isInteger(v) || v < lo || v > hi) errors.push(`${label}은(는) ${lo}~${hi} 사이여야 합니다`);
  };
  check('boardSize', c.boardSize, '보드 크기');
  check('stones', c.stones, '돌 개수');
  check('heroes', c.heroes, '기사 카드');
  check('handLimit', c.handLimit, '손패 상한');
  check('maxDistance', c.maxDistance, '최대 거리');
  check('cardCopies', c.cardCopies, '카드 벌 수');
  check('holes', c.holes, '막힌 칸');
  check('rounds', c.rounds, '판 수');
  check('turnTimerSec', c.turnTimerSec, '턴 제한시간');
  check('players', players, '인원');
  if (c.teams && players !== 4) errors.push('팀전은 4인일 때만 가능합니다');
  if (errors.length) return errors;
  if (c.maxDistance >= c.boardSize) errors.push(`최대 거리(${c.maxDistance})는 보드 크기(${c.boardSize})보다 작아야 합니다`);
  if (c.holes > Math.floor((c.boardSize * c.boardSize) / 5)) errors.push(`막힌 칸이 너무 많습니다 (이 보드는 최대 ${Math.floor((c.boardSize * c.boardSize) / 5)}개)`);
  if (c.stones > openCells(c)) errors.push(`돌(${c.stones}개)이 놓을 수 있는 칸(${openCells(c)}칸)보다 많습니다`);
  if (deckSize(c) < players * (c.handLimit + 2)) {
    errors.push(`이동 카드가 부족합니다 (카드 ${deckSize(c)}장, 필요 ${players * (c.handLimit + 2)}장 이상 = 인원×(손패+2)). 카드 벌 수·최대 거리를 늘리거나 손패를 줄이세요`);
  }
  return errors;
}

export function sanitizeConfig(input: Partial<GameConfig>): GameConfig {
  const c: GameConfig = { ...CLASSIC };
  for (const key of Object.keys(CLASSIC) as (keyof GameConfig)[]) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof CLASSIC[key] === 'boolean' && typeof v === 'boolean') (c as any)[key] = v;
    if (typeof CLASSIC[key] === 'number' && typeof v === 'number' && Number.isFinite(v)) (c as any)[key] = Math.round(v);
  }
  return c;
}
