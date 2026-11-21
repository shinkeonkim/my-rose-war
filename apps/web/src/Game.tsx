import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, DIRS, EMPTY, EmoteEvent, GameView, HOLE, LogEntry, RoomView, playOutcome, sameSide, scoreBoard } from '@rw/engine';
import { CrownIcon, KnightIcon, MoveCard, SeatStone, cardText, seatName, seatVars } from './theme';
import { CloseRoomButton } from './Lobby';
import { EmoteBubble, EmoteButton, EmoteFeed } from './emotes';
import { sound } from './sound';

type Act = (event: string, payload?: object) => Promise<boolean>;
type Outcome = ReturnType<typeof playOutcome>;

const TITLE = 'Crown March';

function useCountdown(deadline: number | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
}

function describe(e: LogEntry, names: string[]): string {
  const who = names[e.seat] ?? `P${e.seat + 1}`;
  switch (e.type) {
    case 'place':
      return `${who} · ${cardText(e.card)} 이동, 돌을 놓았어요`;
    case 'hero':
      return `${who} · ⚔ 기사! ${cardText(e.card)} 이동, ${names[e.victim] ?? '상대'} 님의 돌을 뒤집었어요`;
    case 'draw':
      return `${who} · 카드 1장 가져옴${e.reshuffled ? ' (버린 카드를 섞어 새 더미)' : ''}`;
    case 'pass':
      return `${who} · 할 수 있는 게 없어 패스`;
  }
}

const isOutcomeOk = (o: Outcome): o is { kind: 'place' | 'hero'; to: { x: number; y: number } } => 'kind' in o;

export function Game({
  view,
  act,
  onLeave,
  notify,
  emotes,
  onEmote,
}: {
  view: RoomView;
  act: Act;
  onLeave: () => void;
  notify: (msg: string) => void;
  emotes: EmoteEvent[];
  onEmote: (id: string) => void;
}) {
  const g = view.game!;
  const c = g.config;
  const names = view.seats;
  const me = g.me;
  const myTurn = me >= 0 && g.turn === me && g.status === 'playing';
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showAreas, setShowAreas] = useState(false);
  const [peek, setPeek] = useState(false);
  useEffect(() => setPeek(false), [g.status, g.round]);
  const turnDeadline = useMemo(() => (view.turnRemainingMs !== null ? Date.now() + view.turnRemainingMs : null), [view]);
  const nudgeDeadline = useMemo(() => (view.nudgeInMs !== null ? Date.now() + view.nudgeInMs : null), [view]);
  const secs = useCountdown(turnDeadline);
  const nudgeLeft = useCountdown(nudgeDeadline);
  const [shake, setShake] = useState(0);
  const turnName = names[g.turn] ?? '';
  const warn = (msg: string) => {
    notify(msg);
    setShake((n) => n + 1);
  };
  const notMyTurnMsg = me < 0 ? '관전 중에는 플레이할 수 없어요' : `지금은 ${turnName} 님의 차례예요`;

  // 내 차례 알림: 진동 + 다른 탭이면 탭 제목
  useEffect(() => {
    if (!myTurn) return;
    try {
      navigator.vibrate?.(60);
    } catch {
      /* 지원 안 함 */
    }
    if (document.hidden) document.title = `● 내 차례 — ${TITLE}`;
    const restore = () => {
      if (!document.hidden) document.title = TITLE;
    };
    document.addEventListener('visibilitychange', restore);
    return () => {
      document.removeEventListener('visibilitychange', restore);
      document.title = TITLE;
    };
  }, [myTurn]);

  // 턴 전환 스플래시 + 알림음
  const [splash, setSplash] = useState<{ text: string; sub: string; mine: boolean; k: number } | null>(null);
  const turnKey = `${g.round}-${g.turn}-${g.status}-${g.log[g.log.length - 1]?.n ?? 0}`;
  const lastTurnSeat = useRef<string>(`${g.round}-${g.turn}`);
  useEffect(() => {
    const k = `${g.round}-${g.turn}`;
    if (k === lastTurnSeat.current || g.status !== 'playing') {
      lastTurnSeat.current = k;
      return;
    }
    lastTurnSeat.current = k;
    const mine = g.turn === me;
    setSplash({
      text: mine ? '내 차례!' : `${turnName} 님 차례`,
      sub: mine ? '카드로 왕관을 옮겨 돌을 놓으세요' : g.players > 2 && (g.turn + 1) % g.players === me ? '다음은 내 차례예요' : '',
      mine,
      k: Date.now(),
    });
    sound.play(mine ? 'myTurn' : 'turn');
    const t = setTimeout(() => setSplash(null), mine ? 1400 : 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);
  const [muted, setMuted] = useState(sound.muted);
  useEffect(() => {
    const off = sound.subscribe(setMuted);
    return () => {
      off();
    };
  }, []);
  const emoteBySeat = new Map<number, EmoteEvent>();
  for (const e of emotes) if (e.seat !== null) emoteBySeat.set(e.seat, e);
  const seatless = emotes.filter((e) => e.seat === null);

  const myHand = me >= 0 ? g.hands[me] ?? [] : [];
  const outcomes = useMemo(() => {
    const m = new Map<string, Outcome>();
    if (me < 0) return m;
    for (const card of myHand) m.set(card.id, playOutcome(g, c.teams, me, card));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, me]);
  /** 내 차례에 갈 수 있는 칸 → 카드들 (돌 놓기 우선) */
  const targets = useMemo(() => {
    const m = new Map<number, { card: Card; kind: 'place' | 'hero' }[]>();
    if (!myTurn) return m;
    for (const card of myHand) {
      const o = outcomes.get(card.id)!;
      if (!isOutcomeOk(o)) continue;
      const i = o.to.y * g.size + o.to.x;
      m.set(i, [...(m.get(i) ?? []), { card, kind: o.kind }]);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomes, myTurn]);

  const selCard = myHand.find((x) => x.id === selected) ?? null;
  useEffect(() => {
    if (selected && !myHand.some((x) => x.id === selected)) setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g]);
  useEffect(() => {
    if (!myTurn) setSelected(null);
  }, [myTurn]);
  const focusCard = selCard ?? myHand.find((x) => x.id === hover) ?? null;
  const focusOutcome = focusCard ? outcomes.get(focusCard.id) ?? null : null;

  const play = async (card: Card) => {
    const o = outcomes.get(card.id);
    if (!o || !isOutcomeOk(o)) return;
    if (await act('move', { move: { type: 'play', cardId: card.id } })) setSelected(null);
  };
  const draw = () => {
    if (g.can.draw) return act('move', { move: { type: 'draw' } });
    if (g.status !== 'playing') return;
    if (!myTurn) return warn(notMyTurnMsg);
    if (myHand.length >= c.handLimit) return warn(`손패가 ${c.handLimit}장이라 더 가져올 수 없어요 — 카드를 내세요`);
    return warn('가져올 카드가 없어요');
  };

  const onHandClick = (card: Card) => {
    if (g.status !== 'playing') return;
    if (!myTurn) {
      setSelected(null);
      return warn(notMyTurnMsg);
    }
    const o = outcomes.get(card.id)!;
    if (selected === card.id) {
      if (isOutcomeOk(o)) return play(card);
      setSelected(null);
      return;
    }
    setSelected(card.id);
    if (!isOutcomeOk(o)) warn(o.reason);
  };

  const onCellClick = (i: number) => {
    if (g.status !== 'playing') return;
    if (!myTurn) return me >= 0 && warn(notMyTurnMsg);
    if (selCard) {
      const o = outcomes.get(selCard.id)!;
      if (isOutcomeOk(o) && o.to.y * g.size + o.to.x === i) return play(selCard);
    }
    const opts = targets.get(i);
    if (opts) {
      const pick = opts.find((x) => x.kind === 'place') ?? opts[0];
      setSelected(pick.card.id);
      return;
    }
    if (selCard) return warn('선택한 카드로는 빛나는 칸으로만 갈 수 있어요');
    if (targets.size === 0) return warn(g.can.draw ? '낼 수 있는 카드가 없어요 — 카드를 가져오세요' : '할 수 있는 행동이 없어요 — 패스하세요');
    warn('카드로 갈 수 있는 칸(표시된 칸)을 누르세요');
  };

  // 영역 점수 (실시간)
  const scored = useMemo(() => scoreBoard(g.board, g.size, c, g.players), [g.board, g.size, c, g.players]);
  const groupSize = useMemo(() => {
    const m = new Map<number, number>();
    for (const gr of scored.groups) for (const k of gr.cells) m.set(k, gr.cells.length);
    return m;
  }, [scored]);

  const last = g.log[g.log.length - 1];
  const lastMove = last && (last.type === 'place' || last.type === 'hero') ? last : null;
  const turnMember = view.members.find((m) => m.seat === g.turn);
  const awaySeats = new Set(view.members.filter((m) => m.seat !== null && !m.connected).map((m) => m.seat!));
  const isTeam = c.teams && g.players === 4;

  // 플레이어 순서: 나부터
  const order: number[] = [];
  for (let i = 0; i < g.players; i++) order.push(me >= 0 ? (me + i) % g.players : i);

  const focusTo = focusOutcome?.to ?? null;
  const focusOk = !!focusOutcome && isOutcomeOk(focusOutcome);

  return (
    <main className={`page game ${myTurn ? 'my-turn' : ''}`} style={{ ['--n' as string]: g.size }}>
      <header className="topbar compact">
        <div className="small">
          <b>
            {g.round}/{c.rounds}판
          </b>
          <span className="muted"> · {view.code}</span>
        </div>
        <div className="small right">
          <button className="btn ghost tiny" aria-label={muted ? '소리 켜기' : '소리 끄기'} onClick={() => sound.setMuted(!muted)}>
            {muted ? '🔕' : '🔔'}
          </button>
          {view.hostId === view.you && <CloseRoomButton act={act} small />}
          <button className={`btn ghost tiny ${showAreas ? 'on' : ''}`} aria-pressed={showAreas} onClick={() => setShowAreas((v) => !v)}>
            영역
          </button>
          <button className="btn ghost tiny" onClick={() => setShowLog((v) => !v)}>
            기록
          </button>
        </div>
      </header>

      {g.status === 'playing' && (
        <TurnBanner
          g={g}
          myTurn={myTurn}
          turnName={turnName}
          away={!!turnMember && !turnMember.connected}
          secs={secs}
          nudgeLeft={view.nudgeInMs !== null ? nudgeLeft : null}
          onNudge={() => act('nudge')}
          selCard={selCard}
          selOutcome={selCard ? outcomes.get(selCard.id) ?? null : null}
          names={names}
          shake={shake}
          playableCount={targets.size}
        />
      )}

      {showLog && (
        <div className="log panel">
          {g.log.length === 0 ? <span className="muted small">아직 기록이 없습니다</span> : [...g.log].reverse().map((e) => <div key={e.n} className="small">{describe(e, names)}</div>)}
        </div>
      )}

      <div className="game-layout">
        <section className="board-area">
          <div className="board-fit">
          <div className="board-frame">
            <div className="grid" role="grid" aria-label={`${g.size}×${g.size} 보드`}>
              {g.board.map((v, i) => {
                const x = i % g.size;
                const y = (i - x) / g.size;
                const opts = targets.get(i);
                const isFocus = focusTo && focusTo.x === x && focusTo.y === y;
                const fresh = lastMove && lastMove.to.x === x && lastMove.to.y === y ? lastMove : null;
                const cls = [
                  'cell',
                  v === HOLE ? 'hole' : '',
                  opts ? `target ${opts.some((o) => o.kind === 'place') ? 't-place' : 't-hero'}` : '',
                  isFocus ? (focusOk ? 'focus' : 'focus bad') : '',
                  (x + y) % 2 ? 'alt' : '',
                ].join(' ');
                return (
                  <div key={i} className={cls} role="gridcell" onClick={() => onCellClick(i)} aria-label={cellLabel(v, x, y, names)}>
                    {v >= 0 && (
                      <span className={`stone ${fresh ? (fresh.type === 'hero' ? 'flipped' : 'fresh') : ''}`} key={fresh ? `f${fresh.n}` : 's'}>
                        <SeatStone seat={v} size="100%" />
                        {showAreas && <span className="area-num">{groupSize.get(i)}</span>}
                      </span>
                    )}
                    {opts && <span className="marker">{opts.some((o) => o.kind === 'place') ? '' : <KnightIcon size={14} />}</span>}
                  </div>
                );
              })}
            </div>
            <svg className="paths" viewBox={`0 0 ${g.size} ${g.size}`} aria-hidden>
              {lastMove && !focusTo && (
                <line
                  key={`trail-${lastMove.n}`}
                  className="trail"
                  x1={lastMove.from.x + 0.5}
                  y1={lastMove.from.y + 0.5}
                  x2={lastMove.to.x + 0.5}
                  y2={lastMove.to.y + 0.5}
                />
              )}
              {focusCard && (
                <PathLine from={g.crown} card={focusCard} ok={focusOk} size={g.size} />
              )}
            </svg>
            <div className="crown-layer">
              <div className="crown" style={{ left: `${((g.crown.x + 0.5) / g.size) * 100}%`, top: `${((g.crown.y + 0.5) / g.size) * 100}%` }} aria-label={`왕관 위치 ${g.crown.x + 1}열 ${g.crown.y + 1}행`}>
              <CrownIcon size="100%" />
            </div>
            </div>
          </div>
          </div>
          <div className="ticker small muted" aria-live="polite" key={last?.n ?? -1}>
            {last ? describe(last, names) : g.status === 'playing' ? '가운데 왕관에서 시작합니다' : ' '}
          </div>
        </section>

        <aside className="side">
          {g.status === 'playing' && g.supply > 0 && g.supply <= g.players * 3 && (
            <div className={`side-alert ${g.supply <= g.players ? 'critical' : ''}`} role="status" key={g.supply}>
              <span className="sa-icon" aria-hidden>
                ⏳
              </span>
              <span>
                <b>남은 돌 {g.supply}개</b> · 다 쓰면 판이 끝나요
                {g.supply <= g.players && <span className="sa-sub">이번 바퀴 안에 끝날 수 있어요 — 큰 영역을 지키세요</span>}
              </span>
            </div>
          )}
          <section className="players">
            {order.map((p) => (
              <PlayerRow
                key={p}
                g={g}
                seat={p}
                name={names[p]}
                mine={p === me}
                active={g.turn === p && g.status === 'playing'}
                score={scored.scores[p]}
                team={isTeam ? p % 2 : null}
                away={awaySeats.has(p)}
                emote={emoteBySeat.get(p)}
                freshCard={last && last.seat === p && (last.type === 'place' || last.type === 'hero') ? last.card : null}
              />
            ))}
          </section>

          <section className="supply-row">
            <div className="supply" title="공용 돌 — 다 쓰면 판이 끝나요">
              <span className="supply-stack" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span>
                남은 돌 <b className={g.supply <= g.players * 3 ? 'hot' : ''}>{g.supply}</b>
              </span>
            </div>
            <div className="deck-col">
              <button className={`deck ${g.can.draw ? 'drawable' : ''}`} onClick={draw} aria-label={`카드 가져오기 (더미 ${g.deckCount}장)`}>
                <span className="deck-back" aria-hidden />
                <span className="deck-count">{g.deckCount}</span>
                <span className="deck-label">가져오기</span>
              </button>
              <EmoteButton onSend={onEmote} small />
            </div>
            <div className="discard" title={`버린 카드 ${g.discardCount}장 — 더미가 비면 섞어서 다시 씀`}>
              {g.discardTop ? <MoveCard card={g.discardTop} size="sm" key={g.discardTop.id} fresh /> : <span className="discard-empty" />}
              <span className="muted small">버림 {g.discardCount}</span>
            </div>
          </section>

          {me >= 0 && (
            <section className="hand-area" style={seatVars(me)}>
              <div className="hand-head small">
                <span>
                  <SeatStone seat={me} size={16} /> 내 카드 <span className="muted">{myHand.length}/{c.handLimit}</span>
                </span>
                <span className="heroes-left" title="기사 카드: 이동 카드와 함께 내면 상대 돌을 내 색으로 뒤집어요">
                  {Array.from({ length: c.heroes }, (_, i) => (
                    <span key={i} className={i < g.heroes[me] ? 'on' : 'used'}>
                      <KnightIcon size={16} />
                    </span>
                  ))}
                </span>
              </div>
              <div className="hand">
                {myHand.map((card) => {
                  const o = outcomes.get(card.id)!;
                  const kind = isOutcomeOk(o) ? o.kind : 'blocked';
                  return (
                    <MoveCard
                      key={card.id}
                      card={card}
                      kind={myTurn ? kind : null}
                      selected={card.id === selected}
                      title={isOutcomeOk(o) ? (o.kind === 'hero' ? '기사로 상대 돌 뒤집기' : '빈 칸에 돌 놓기') : o.reason}
                      onClick={() => onHandClick(card)}
                      onPointerEnter={() => setHover(card.id)}
                      onPointerLeave={() => setHover((h) => (h === card.id ? null : h))}
                    />
                  );
                })}
                {myHand.length === 0 && <span className="muted small">카드가 없어요</span>}
              </div>
              <div className="actions">
                {myTurn && selCard && isOutcomeOk(outcomes.get(selCard.id)!) ? (
                  <button className={`btn primary ${(outcomes.get(selCard.id) as { kind: string }).kind === 'hero' ? 'hero-btn' : ''}`} onClick={() => play(selCard)}>
                    {(outcomes.get(selCard.id) as { kind: string }).kind === 'hero' ? '⚔ 기사로 뒤집기' : '여기에 돌 놓기'}
                  </button>
                ) : null}
                {myTurn && g.can.draw && (
                  <button className={`btn ${targets.size === 0 ? 'primary' : ''}`} onClick={draw}>
                    카드 가져오기
                  </button>
                )}
                {myTurn && g.can.pass && (
                  <button className="btn primary" onClick={() => act('move', { move: { type: 'pass' } })}>
                    패스
                  </button>
                )}
                {!myTurn && <span className="muted small">{g.status === 'playing' ? `${turnName} 님이 두는 중` : ' '}</span>}
              </div>
            </section>
          )}
          {me < 0 && <p className="muted small center-text">관전 중입니다</p>}
        </aside>
      </div>

      <EmoteFeed items={seatless} />
      {splash && (
        <div className={`turn-splash ${splash.mine ? 'mine' : ''}`} key={splash.k} aria-hidden>
          <div className="ts-text">{splash.text}</div>
          {splash.sub && <div className="ts-sub">{splash.sub}</div>}
        </div>
      )}

      {g.status !== 'playing' &&
        (peek ? (
          <button className="btn primary peek-btn" onClick={() => setPeek(false)}>
            점수 보기
          </button>
        ) : (
          <RoundOver view={view} act={act} onLeave={onLeave} onPeek={() => setPeek(true)} />
        ))}
    </main>
  );
}

function cellLabel(v: number, x: number, y: number, names: string[]) {
  const pos = `${x + 1}열 ${y + 1}행`;
  if (v === HOLE) return `${pos} 막힌 칸`;
  if (v === EMPTY) return `${pos} 빈 칸`;
  return `${pos} ${names[v] ?? ''} 돌`;
}

/** 왕관 → 카드 목적지 점선 (보드 밖이면 가장자리까지) */
function PathLine({ from, card, ok, size }: { from: { x: number; y: number }; card: Card; ok: boolean; size: number }) {
  const d = DIRS[card.dir];
  const tx = from.x + d.dx * card.dist;
  const ty = from.y + d.dy * card.dist;
  const clamp = (v: number) => Math.max(-0.3, Math.min(size - 0.7, v));
  return (
    <g className={`path ${ok ? 'ok' : 'bad'}`}>
      <line x1={from.x + 0.5} y1={from.y + 0.5} x2={clamp(tx) + 0.5} y2={clamp(ty) + 0.5} />
      {Array.from({ length: card.dist }, (_, i) => {
        const sx = from.x + d.dx * (i + 1);
        const sy = from.y + d.dy * (i + 1);
        if (sx < 0 || sy < 0 || sx >= size || sy >= size) return null;
        return <circle key={i} cx={sx + 0.5} cy={sy + 0.5} r={i === card.dist - 1 ? 0.14 : 0.07} />;
      })}
    </g>
  );
}

function PlayerRow({
  g,
  seat,
  name,
  mine,
  active,
  score,
  team,
  away,
  emote,
  freshCard,
}: {
  g: GameView;
  seat: number;
  name: string;
  mine: boolean;
  active: boolean;
  score: number;
  team: number | null;
  away: boolean;
  emote?: EmoteEvent;
  freshCard: Card | null;
}) {
  const hand = g.hands[seat];
  const stonesOnBoard = g.board.filter((v) => v === seat).length;
  return (
    <div className={`player-row ${active ? 'active' : ''} ${mine ? 'mine' : ''}`} style={seatVars(seat)}>
      <div className="board-head small">
        <span className="name">
          <EmoteBubble e={emote} />
          <SeatStone seat={seat} size={18} />
          {active && <span className="pulse" aria-hidden />}
          <b>{name}</b>
          {mine && <span className="tag mine">나</span>}
          {team !== null && <span className="tag">{team === 0 ? 'A팀' : 'B팀'}</span>}
          {away && <span className="tag away-tag">연결 끊김</span>}
        </span>
        <span className="head-right">
          <span className="muted" title="보드 위 내 돌">
            ●{stonesOnBoard}
          </span>
          <span className="pr-heroes" title={`남은 기사 ${g.heroes[seat]}장`} aria-label={`남은 기사 ${g.heroes[seat]}장`}>
            <KnightIcon size={13} />×{g.heroes[seat]}
          </span>
          <span className="pr-score">
            <b>{score}</b>점
          </span>
        </span>
      </div>
      {!mine && (
        <div className="mini-hand-cards">
          {hand
            ? hand.map((card) => <MoveCard key={card.id} card={card} size="xs" />)
            : Array.from({ length: g.handCounts[seat] }, (_, i) => <span key={i} className="card-back-xs" />)}
          {freshCard && <span className="muted small last-played">방금 {cardText(freshCard)}</span>}
        </div>
      )}
    </div>
  );
}

/** 화면 위쪽 차례 안내 */
function TurnBanner({
  g,
  myTurn,
  turnName,
  away,
  secs,
  nudgeLeft,
  onNudge,
  selCard,
  selOutcome,
  names,
  shake,
  playableCount,
}: {
  g: GameView;
  myTurn: boolean;
  turnName: string;
  away: boolean;
  secs: number | null;
  nudgeLeft: number | null;
  onNudge: () => void;
  selCard: Card | null;
  selOutcome: Outcome | null;
  names: string[];
  shake: number;
  playableCount: number;
}) {
  let title: string;
  let hint: string;
  if (myTurn) {
    if (g.can.pass) {
      title = '할 수 있는 행동이 없어요';
      hint = '모든 카드가 막혔고 더 가져올 수도 없어요 — 패스하세요';
    } else if (selCard && selOutcome) {
      if (isOutcomeOk(selOutcome)) {
        title = selOutcome.kind === 'hero' ? '⚔ 기사 출격 준비' : '여기에 돌을 놓을까요?';
        const victim = g.board[selOutcome.to.y * g.size + selOutcome.to.x];
        hint =
          selOutcome.kind === 'hero'
            ? `${cardText(selCard)}: 기사 1장을 써서 ${names[victim] ?? '상대'} 님의 돌을 내 색으로 뒤집어요 · 카드를 한 번 더 누르면 실행`
            : `${cardText(selCard)}: 왕관을 옮기고 빈 칸에 내 돌을 놓아요 · 카드나 칸을 한 번 더 누르면 실행`;
      } else {
        title = '이 카드는 지금 낼 수 없어요';
        hint = `${cardText(selCard)}: ${selOutcome.reason}`;
      }
    } else if (playableCount > 0) {
      title = '내 차례예요 · 왕관을 움직이세요';
      hint = `카드를 고르거나 보드에 표시된 칸을 누르세요${g.can.draw ? ' · 카드를 가져와도 돼요' : ''}`;
    } else {
      title = '낼 수 있는 카드가 없어요';
      hint = '카드를 1장 가져오세요';
    }
  } else {
    title = `${turnName} 님의 차례예요`;
    hint = away ? '연결이 끊겼어요 · 다시 들어오길 기다리는 중' : '왕관을 움직이는 중…';
    if (g.me >= 0 && g.players > 2 && (g.turn + 1) % g.players === g.me) hint += ' · 다음은 내 차례예요';
    if (g.me < 0) hint += ' · 관전 중';
  }
  const teamNote = g.config.teams && g.me >= 0 ? ` · 같은 팀: ${names.filter((_, i) => i !== g.me && sameSide(true, i, g.me)).join(', ')}` : '';
  return (
    <section className={`turn-banner ${myTurn ? 'mine' : 'theirs'} ${away ? 'away' : ''}`} aria-live="polite" style={seatVars(g.turn)}>
      <div className={`tb-body ${shake ? 'shake' : ''}`} key={`${shake}-${g.turn}`}>
        <div className="tb-text">
          <div className="tb-title">
            <SeatStone seat={g.turn} size={18} /> {title}
          </div>
          <div className="tb-hint">
            {hint}
            {teamNote}
          </div>
        </div>
        <div className="tb-side">
          {secs !== null && <span className={`tb-timer ${secs <= 10 ? 'hot' : ''}`}>{secs}초</span>}
          {away && nudgeLeft !== null && g.me >= 0 && (
            <button className="btn tiny" disabled={nudgeLeft > 0} onClick={onNudge} title="자동으로 돌을 놓거나 카드를 가져옵니다">
              대신 진행{nudgeLeft > 0 ? ` (${nudgeLeft}초)` : ''}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function RoundOver({ view, act, onLeave, onPeek }: { view: RoomView; act: Act; onLeave: () => void; onPeek: () => void }) {
  const g = view.game!;
  const c = g.config;
  const names = view.seats;
  const isTeam = c.teams && g.players === 4;
  const matchOver = g.status === 'match-over';
  const final = scoreBoard(g.board, g.size, c, g.players);
  const rows = [...g.standings].sort((a, b) => a.rank - b.rank || a.seat - b.seat);
  const thisRound = g.roundScores[g.roundScores.length - 1] ?? [];

  let headline = `${g.round}판 결과`;
  if (matchOver) {
    const top = rows.filter((r) => r.rank === 1);
    if (isTeam) headline = top.length === 4 ? '무승부!' : `${top[0].seat % 2 === 0 ? 'A팀' : 'B팀'} 승리!`;
    else headline = top.length === rows.length && rows.length > 1 ? '무승부!' : `${top.map((r) => names[r.seat]).join(', ')} 승리!`;
  }
  const tieBroken = matchOver && rows.length > 1 && rows[0].total === rows[1].total && rows[0].rank !== rows[1].rank;
  const breakdown = (seat: number) => {
    const side = isTeam ? seat % 2 : seat;
    const sizes = final.groups.filter((gr) => gr.side === side).map((gr) => gr.cells.length).sort((a, b) => b - a);
    if (!sizes.length) return '영역 없음';
    const shown = sizes.slice(0, 6).map((n) => (c.squareScoring && n > 1 ? `${n}²` : `${n}`));
    return shown.join(' + ') + (sizes.length > 6 ? ` + …(${sizes.length - 6}개)` : '');
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="점수">
      <div className="panel sheet">
        <h2>{headline}</h2>
        <p className="muted small">{g.endReason === 'stones' ? '공용 돌을 모두 썼어요' : '아무도 왕관을 움직일 수 없어 끝났어요'}</p>
        <div className="table-wrap">
          <table className="scores">
            <thead>
              <tr>
                <th />
                <th className="left">영역 (이번 판)</th>
                {c.rounds > 1 && <th>이번 판</th>}
                <th>합계</th>
                <th title="동점이면 기사를 덜 쓴 쪽이 이깁니다">기사 사용</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.seat} style={{ ['--r' as string]: idx }}>
                  <th className="left nowrap">
                    <span className="rank">{r.rank}</span> <SeatStone seat={r.seat} size={16} /> {names[r.seat]}
                    {isTeam && <span className="tag">{r.seat % 2 === 0 ? 'A' : 'B'}</span>}
                  </th>
                  <td className="left small muted">{breakdown(r.seat)}</td>
                  {c.rounds > 1 && <td>{thisRound[r.seat]}</td>}
                  <td>
                    <b>{r.total}</b>
                  </td>
                  <td>{r.heroesUsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tieBroken && <p className="small">점수가 같아 기사를 덜 쓴 쪽이 앞섭니다.</p>}
        <div className="row">
          <button className="btn primary grow" onClick={() => (matchOver ? act('back') : act('next', { round: g.round, status: g.status }))}>
            {matchOver ? '로비로 돌아가기' : '다음 판 시작'}
          </button>
          <button className="btn" onClick={onPeek}>
            보드 보기
          </button>
          {matchOver && (
            <button className="btn ghost" onClick={onLeave}>
              나가기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

