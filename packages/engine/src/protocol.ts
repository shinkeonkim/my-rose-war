import type { GameConfig } from './config';
import type { GameView } from './view';

/** 서버 ↔ 클라이언트 공용 타입 */
export interface MemberPublic {
  id: string;
  name: string;
  role: 'player' | 'spectator';
  seat: number | null;
  connected: boolean;
  /** 끝난 매치의 결과 화면을 아직 보고 있음 */
  inResults: boolean;
  /** 연결이 끊긴 지 몇 ms 지났는지 (접속 중이면 null) */
  awayMs: number | null;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  hasPassword: boolean;
  you: string;
  hostId: string;
  members: MemberPublic[];
  config: GameConfig;
  lobby: {
    playerCount: number;
    deckSize: number;
    /** 돌을 놓을 수 있는 칸 수 */
    openCells: number;
    expectedTurns: number;
    errors: string[];
    /** 아직 결과 화면에 있는 플레이어 이름 (방장이 기다리지 않고 시작 가능) */
    inResults: string[];
    /** 방장이 중지한 게임 — 이어서 하기 가능 */
    paused: PausedInfo | null;
  };
  game: GameView | null;
  /** seat → 이름 */
  seats: string[];
  /** 턴 제한시간이 있을 때 남은 ms (서버 시각 기준 계산 — 기기 시계 오차 영향 없음) */
  turnRemainingMs: number | null;
  /** 현재 차례인 사람이 끊겨서 다른 사람이 대신 진행할 수 있기까지 남은 ms (해당 없으면 null) */
  nudgeInMs: number | null;
}

export interface PausedInfo {
  /** 중지 당시 판 (1부터) / 전체 판 수 */
  round: number;
  rounds: number;
  /** 그 판이 이미 끝난 상태였는지 */
  roundOver: boolean;
  /** 자리 순서대로 이름과 끝난 판까지의 누적 점수 */
  players: { name: string; total: number }[];
  /** 설정이 중지 당시와 같은지 — 같으면 하던 판 그대로, 다르면 끝난 판 점수만 이어 새 판 */
  sameConfig: boolean;
  /** 이어갈 수 없는 이유 (없으면 null) */
  blocked: string | null;
}

/** 무중단 배포로 서버를 교체하는 동안의 안내 (클라이언트는 이 오류면 잠시 뒤 다시 시도) */
export const DRAIN_MESSAGE = '서버를 업데이트하는 중이에요 — 잠시 뒤 자동으로 이어져요';

/** 방 안에서 보낼 수 있는 감정 표현 (서버는 이 목록의 id만 허용) */
export const EMOTES = [
  { id: 'thumbs', text: '👍' },
  { id: 'clap', text: '👏' },
  { id: 'lol', text: '😂' },
  { id: 'wow', text: '😮' },
  { id: 'scream', text: '😱' },
  { id: 'think', text: '🤔' },
  { id: 'cry', text: '😭' },
  { id: 'fire', text: '🔥' },
  { id: 'cool', text: '😎' },
  { id: 'pray', text: '🙏' },
  { id: 'nice', text: '좋은 수!' },
  { id: 'knight', text: '기사 출격! ⚔️' },
  { id: 'close', text: '아깝다~' },
  { id: 'hurry', text: '빨리요~ ⏳' },
  { id: 'hmm', text: '고민되네…' },
  { id: 'please', text: '잘 부탁해요!' },
  { id: 'gg', text: '줴줴이야 👋' },
  // 약올리기
  { id: 'teabag', text: '🍵', anim: 'teabag' },
  { id: 'clown', text: '🤡' },
  { id: 'meh', text: '메롱 😜' },
  { id: 'yawn', text: '하품 나온다 🥱' },
  { id: 'plan', text: '계획대로 😏' },
  { id: 'shaking', text: '떨고 있니? 🫵' },
  { id: 'ez', text: '너무 쉽다~ 💅' },
  { id: 'crown', text: '왕관은 내 거 👑' },
  { id: 'steal', text: '그 땅 잘 먹을게~ 🍽️' },
] as const;

export type EmoteId = (typeof EMOTES)[number]['id'];
/** 말풍선 특수 움직임 (teabag: 위아래로 담갔다 빼기) */
export const emoteAnim = (id: string): string | null => {
  const e = EMOTES.find((x) => x.id === id) as { anim?: string } | undefined;
  return e?.anim ?? null;
};

export interface EmoteEvent {
  /** 보낸 멤버 id */
  from: string;
  name: string;
  /** 게임 좌석 (관전자/로비면 null) */
  seat: number | null;
  id: EmoteId;
  /** 클라이언트에서 같은 이모트를 구분하기 위한 일련번호 */
  n: number;
}
