import { describe, expect, it } from 'vitest';
import { CLASSIC, PRESETS, deckSize, validateConfig } from './config';
import { Card, EMPTY, HOLE, MatchState, applyMove, autoMove, buildDeck, newMatch, playOutcome, scoreBoard, standings, startNextRound } from './game';
import { viewFor } from './view';

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function give(m: MatchState, seat: number, cards: Card[]) {
  m.state.hands[seat] = cards;
}
const card = (dir: number, dist: number, id = `t${dir}${dist}`): Card => ({ id, dir: dir as Card['dir'], dist });

describe('구성', () => {
  it('원작 덱은 8방향 × 거리 1~3 = 24장', () => {
    expect(buildDeck(CLASSIC)).toHaveLength(24);
    expect(deckSize(CLASSIC)).toBe(24);
    expect(new Set(buildDeck(CLASSIC).map((c) => c.id)).size).toBe(24);
  });
  it('왕관은 가운데, 손패 5장, 기사 4장, 돌 52개', () => {
    const m = newMatch(CLASSIC, 2, seeded());
    expect(m.state.crown).toEqual({ x: 4, y: 4 });
    expect(m.state.hands.map((h) => h.length)).toEqual([5, 5]);
    expect(m.state.heroes).toEqual([4, 4]);
    expect(m.state.supply).toBe(52);
    expect(m.state.deck).toHaveLength(14);
  });
  it('모든 프리셋은 권장 인원에서 유효', () => {
    for (const p of PRESETS) {
      const players = p.id === 'three' ? 3 : p.id === 'four' || p.id === 'teams' ? 4 : 2;
      expect(validateConfig(p.config, players), p.id).toEqual([]);
    }
  });
  it('카드가 손패보다 적으면 거부', () => {
    expect(validateConfig(CLASSIC, 4).join()).toMatch(/이동 카드가 부족/);
  });
  it('막힌 칸은 대칭으로 생기고 가운데는 비어 있다', () => {
    const m = newMatch({ ...CLASSIC, holes: 8, stones: 40 }, 2, seeded(7));
    const b = m.state.board;
    expect(b.filter((v) => v === HOLE)).toHaveLength(8);
    b.forEach((v, i) => expect(v === HOLE).toBe(b[b.length - 1 - i] === HOLE));
    expect(b[40]).toBe(EMPTY);
  });
});

describe('행동', () => {
  it('이동 카드: 왕관 이동 + 내 돌 놓기 + 카드 버림', () => {
    const m = newMatch(CLASSIC, 2, seeded());
    give(m, 0, [card(2, 3)]);
    applyMove(m, 0, { type: 'play', cardId: 't23' });
    expect(m.state.crown).toEqual({ x: 7, y: 4 });
    expect(m.state.board[4 * 9 + 7]).toBe(0);
    expect(m.state.supply).toBe(51);
    expect(m.state.discard.map((c) => c.id)).toEqual(['t23']);
    expect(m.state.turn).toBe(1);
  });
  it('보드 밖·내 돌 칸은 안 되고, 상대 돌은 기사로 뒤집는다', () => {
    const m = newMatch(CLASSIC, 2, seeded());
    m.state.crown = { x: 8, y: 0 };
    expect(playOutcome(m.state, false, 0, card(2, 1))).toMatchObject({ reason: expect.stringMatching(/보드 밖/) });
    m.state.board[1 * 9 + 8] = 0;
    expect(playOutcome(m.state, false, 0, card(4, 1))).toMatchObject({ reason: expect.stringMatching(/내 돌/) });
    m.state.board[1 * 9 + 8] = 1;
    give(m, 0, [card(4, 1)]);
    applyMove(m, 0, { type: 'play', cardId: 't41' });
    expect(m.state.board[1 * 9 + 8]).toBe(0);
    expect(m.state.heroes).toEqual([3, 4]);
    expect(m.state.supply).toBe(52); // 뒤집기는 돌을 쓰지 않는다
  });
  it('기사가 없으면 상대 돌 칸으로 못 간다', () => {
    const m = newMatch({ ...CLASSIC, heroes: 0 }, 2, seeded());
    m.state.board[3 * 9 + 4] = 1;
    expect(playOutcome(m.state, false, 0, card(0, 1))).toMatchObject({ reason: expect.stringMatching(/기사 카드가 없/) });
  });
  it('팀전: 같은 팀 돌은 뒤집지 못하고 영역은 합쳐서 계산', () => {
    const c = { ...CLASSIC, teams: true };
    const m = newMatch({ ...c, cardCopies: 2, handLimit: 4 }, 4, seeded());
    m.state.board[3 * 9 + 4] = 2;
    expect(playOutcome(m.state, true, 0, card(0, 1))).toMatchObject({ reason: expect.stringMatching(/같은 팀/) });
    const b = new Array(9).fill(EMPTY);
    b[0] = 0; b[1] = 2; b[2] = 1;
    expect(scoreBoard(b, 3, c, 4).scores).toEqual([4, 1, 4, 1]);
  });
  it('손패가 가득 차면 못 가져오고, 덱이 비면 버림 더미를 섞는다', () => {
    const m = newMatch(CLASSIC, 2, seeded());
    expect(() => applyMove(m, 0, { type: 'draw' })).toThrow(/더 가져올 수 없/);
    m.state.hands[0].pop();
    m.state.discard = m.state.deck.splice(0);
    m.state.discard.push(...m.state.deck);
    applyMove(m, 0, { type: 'draw' });
    expect(m.state.hands[0]).toHaveLength(5);
    expect(m.state.log.at(-1)).toMatchObject({ type: 'draw', reshuffled: true });
  });
  it('할 게 있으면 패스 불가, 모두 연속 패스하면 판 종료', () => {
    const m = newMatch(CLASSIC, 2, seeded());
    expect(() => applyMove(m, 0, { type: 'pass' })).toThrow(/패스할 수 없/);
    // 왕관을 구석에, 손패는 모두 밖으로 나가는 카드, 덱·버림 없음
    m.state.crown = { x: 0, y: 0 };
    m.state.deck = [];
    m.state.discard = [];
    give(m, 0, [card(6, 1, 'a'), card(0, 2, 'b'), card(7, 1, 'c'), card(5, 1, 'd'), card(1, 3, 'e')]);
    give(m, 1, [card(6, 2, 'f'), card(0, 1, 'g'), card(7, 3, 'h'), card(5, 2, 'i'), card(1, 1, 'j')]);
    applyMove(m, 0, { type: 'pass' });
    expect(m.status).toBe('playing');
    applyMove(m, 1, { type: 'pass' });
    expect(m.status).toBe('match-over');
    expect(m.state.endReason).toBe('stuck');
  });
  it('남의 차례에는 못 둔다', () => {
    const m = newMatch(CLASSIC, 2, seeded());
    expect(() => applyMove(m, 1, { type: 'draw' })).toThrow(/차례가 아닙니다/);
  });
});

describe('점수', () => {
  it('상하좌우로 이어진 영역마다 칸 수의 제곱', () => {
    // 0 0 1
    // 0 1 1
    // . 0 .
    const b = [0, 0, 1, 0, 1, 1, EMPTY, 0, EMPTY];
    expect(scoreBoard(b, 3, CLASSIC, 2).scores).toEqual([9 + 1, 9]);
    expect(scoreBoard(b, 3, { ...CLASSIC, squareScoring: false }, 2).scores).toEqual([4, 3]);
    expect(scoreBoard(b, 3, { ...CLASSIC, diagonalGroups: true }, 2).scores).toEqual([16, 9]);
  });
  it('동점이면 기사를 덜 쓴 쪽이 이긴다', () => {
    const s = standings({ players: 2, config: CLASSIC, roundScores: [[10, 10]], roundHeroesUsed: [[3, 1]] });
    expect(s.map((r) => r.rank)).toEqual([2, 1]);
  });
  it('돌을 다 쓰면 판이 끝나고, 다음 판은 선이 바뀐다', () => {
    const m = newMatch({ ...CLASSIC, rounds: 2 }, 2, seeded());
    m.state.supply = 1;
    give(m, 0, [card(2, 1)]);
    applyMove(m, 0, { type: 'play', cardId: 't21' });
    expect(m.status).toBe('round-over');
    expect(m.state.endReason).toBe('stones');
    expect(m.roundScores).toEqual([[1, 0]]);
    startNextRound(m);
    expect(m.state.turn).toBe(1);
    expect(m.state.supply).toBe(52);
  });
});

describe('뷰', () => {
  it('손패 비공개면 남의 손패는 숨긴다', () => {
    const m = newMatch({ ...CLASSIC, openHands: false }, 2, seeded());
    const v = viewFor(m, 0);
    expect(v.hands[0]).toHaveLength(5);
    expect(v.hands[1]).toBeNull();
    expect(viewFor(newMatch(CLASSIC, 2, seeded()), 0).hands[1]).toHaveLength(5);
  });
  it('자동 진행은 항상 합법', () => {
    const m = newMatch(CLASSIC, 2, seeded(3));
    for (let i = 0; i < 300 && m.status === 'playing'; i++) applyMove(m, m.state.turn, autoMove(m));
    expect(m.status).toBe('match-over');
  });
});
