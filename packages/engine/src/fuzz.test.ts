import { describe, expect, it } from 'vitest';
import { CLASSIC, GameConfig, PRESETS } from './config';
import { EMPTY, HOLE, MatchState, Move, MoveError, applyMove, newMatch, startNextRound } from './game';

function rng(seed: number) {
  return () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
}

const configs: [GameConfig, number][] = [
  ...PRESETS.map((p): [GameConfig, number] => [p.config, p.id === 'three' ? 3 : p.id === 'four' || p.id === 'teams' ? 4 : 2]),
  [{ ...CLASSIC, diagonals: false, maxDistance: 4, cardCopies: 2 }, 3],
  [{ ...CLASSIC, boardSize: 5, stones: 20, maxDistance: 2, handLimit: 3, cardCopies: 2, heroes: 8 }, 2],
  [{ ...CLASSIC, boardSize: 13, stones: 160, rounds: 2, openHands: false, cardCopies: 3 }, 4],
];

function invariants(m: MatchState, c: GameConfig) {
  const s = m.state;
  const cards = [...s.deck, ...s.discard, ...s.hands.flat()];
  expect(cards.length).toBe(8 * 0 + (c.diagonals ? 8 : 4) * c.maxDistance * c.cardCopies);
  expect(new Set(cards.map((x) => x.id)).size).toBe(cards.length);
  s.hands.forEach((h) => expect(h.length).toBeLessThanOrEqual(c.handLimit));
  const stones = s.board.filter((v) => v >= 0).length;
  expect(stones + s.supply).toBe(c.stones);
  expect(s.board.filter((v) => v === HOLE).length).toBe(c.holes);
  const crownCell = s.board[s.crown.y * s.size + s.crown.x];
  expect(crownCell).not.toBe(HOLE);
  // 왕관은 처음(가운데)이 아니면 항상 돌 위에 있다
  if (s.log.some((l) => l.type === 'place' || l.type === 'hero')) expect(crownCell).toBeGreaterThanOrEqual(0);
  s.heroes.forEach((h) => expect(h).toBeGreaterThanOrEqual(0));
}

describe('퍼즈: 무작위(불법 수 포함) 진행', () => {
  configs.forEach(([c, players], ci) => {
    it(`설정 #${ci} (${players}인)`, () => {
      for (let seed = 1; seed <= 15; seed++) {
        const r = rng(seed * 7919 + ci);
        const m = newMatch(c, players, r);
        let steps = 0;
        while (m.status !== 'match-over' && steps++ < 5000) {
          if (m.status === 'round-over') {
            startNextRound(m);
            continue;
          }
          const s = m.state;
          const seat = r() < 0.1 ? Math.floor(r() * players) : s.turn;
          const hand = s.hands[seat];
          const roll = r();
          const move: Move = roll < 0.7 && hand.length ? { type: 'play', cardId: hand[Math.floor(r() * hand.length)].id } : roll < 0.9 ? { type: 'draw' } : { type: 'pass' };
          try {
            applyMove(m, seat, move);
          } catch (e) {
            if (!(e instanceof MoveError)) throw e;
          }
          invariants(m, c);
        }
        expect(m.status).toBe('match-over');
        expect(m.roundScores).toHaveLength(c.rounds);
        expect(m.state.board.some((v) => v !== EMPTY)).toBe(true);
      }
    });
  });
});
