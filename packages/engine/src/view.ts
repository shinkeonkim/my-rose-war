import { GameConfig } from './config';
import { Card, LogEntry, MatchState, Pos, RoundState, canDraw, legalPlays, matchTotals, mustPass, standings } from './game';

/** 플레이어(또는 관전자)에게 보내는 상태. 손패 비공개 설정이면 남의 손패는 null */
export interface GameView {
  config: GameConfig;
  players: number;
  round: number;
  status: MatchState['status'];
  turn: number;
  /** 관전자면 -1 */
  me: number;
  size: number;
  board: number[];
  crown: Pos;
  hands: (Card[] | null)[];
  handCounts: number[];
  deckCount: number;
  discardCount: number;
  discardTop: Card | null;
  supply: number;
  heroes: number[];
  /** 내 차례일 때 할 수 있는 것 */
  can: { draw: boolean; pass: boolean; plays: string[] };
  endReason: RoundState['endReason'];
  roundScores: number[][];
  totals: number[];
  standings: ReturnType<typeof standings>;
  log: LogEntry[];
}

export function viewFor(m: MatchState, me: number): GameView {
  const s = m.state;
  const c = m.config;
  const myTurn = me >= 0 && me === s.turn && m.status === 'playing';
  return {
    config: c,
    players: m.players,
    round: m.round,
    status: m.status,
    turn: s.turn,
    me,
    size: s.size,
    board: s.board,
    crown: s.crown,
    hands: s.hands.map((h, i) => (c.openHands || i === me ? h : null)),
    handCounts: s.hands.map((h) => h.length),
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    discardTop: s.discard[s.discard.length - 1] ?? null,
    supply: s.supply,
    heroes: s.heroes,
    can: {
      draw: myTurn && canDraw(m, me),
      pass: myTurn && mustPass(m, me),
      plays: myTurn ? legalPlays(m, me).map((p) => p.card.id) : [],
    },
    endReason: s.endReason,
    roundScores: m.roundScores,
    totals: matchTotals(m),
    standings: standings(m),
    log: s.log.slice(-30),
  };
}
