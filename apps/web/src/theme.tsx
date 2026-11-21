import { forwardRef } from 'react';
import { Card, DIRS, GameConfig, deckSize } from '@rw/engine';

export const SEATS = [
  { name: '진홍 가문', short: '진홍' },
  { name: '백은 가문', short: '백은' },
  { name: '청람 가문', short: '청람' },
  { name: '비취 가문', short: '비취' },
];

export const seatName = (seat: number) => SEATS[seat]?.name ?? `${seat + 1}번`;

export function seatVars(seat: number): React.CSSProperties {
  const k = `s${seat % 4}`;
  return { ['--seat' as string]: `var(--${k})`, ['--seat-ink' as string]: `var(--${k}-ink)`, ['--seat-rim' as string]: `var(--${k}-rim)` };
}

/** 가문 문장 (24×24) */
export function emblemPaths(seat: number) {
  switch (seat % 4) {
    case 0: // 다섯 꽃잎
      return (
        <g>
          {[0, 72, 144, 216, 288].map((r) => (
            <ellipse key={r} cx="12" cy="7" rx="3.4" ry="4.6" transform={`rotate(${r} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="2.6" opacity=".55" />
        </g>
      );
    case 1: // 초승달
      return <path d="M15.5 3.5a9 9 0 1 0 5 15.6A7.2 7.2 0 0 1 15.5 3.5z" />;
    case 2: // 별
      return <path d="m12 2.5 2.7 6.2 6.8.6-5.2 4.4 1.6 6.6L12 16.8l-5.9 3.5 1.6-6.6-5.2-4.4 6.8-.6z" />;
    default: // 잎사귀
      return <path d="M19.5 4C10 4 4.5 9 4.5 16.5c0 1.3.2 2.3.5 3C7 12.5 11 9.8 15 8.5c-4.5 2.8-7.2 6.3-8.4 11.5 8 .8 13.2-5.5 12.9-16z" />;
  }
}

/** 돌 하나 — 테두리 + 문장 */
export function SeatStone({ seat, size = 24, className = '', style }: { seat: number; size?: number | string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={`stone-svg ${className}`} width={size} height={size} viewBox="0 0 32 32" style={{ ...seatVars(seat), ...style }} aria-hidden>
      <circle cx="16" cy="16" r="14.5" fill="var(--seat)" stroke="var(--seat-rim)" strokeWidth="2" />
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--seat-ink)" strokeOpacity=".25" strokeWidth="1" />
      <g transform="translate(6.4 6.4) scale(.8)" fill="var(--seat-ink)" fillOpacity=".85">
        {emblemPaths(seat)}
      </g>
    </svg>
  );
}

export function CrownIcon({ size = 28 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="crown-svg">
      <path d="M5 23 L4 9.5 L10.5 15 L16 6 L21.5 15 L28 9.5 L27 23 Z" fill="var(--gold)" stroke="#6b4a10" strokeWidth="1.4" strokeLinejoin="round" />
      <rect x="5" y="23.5" width="22" height="4" rx="1.5" fill="var(--gold)" stroke="#6b4a10" strokeWidth="1.4" />
      <circle cx="16" cy="6" r="1.8" fill="#fff6d8" />
      <circle cx="4" cy="9.5" r="1.5" fill="#fff6d8" />
      <circle cx="28" cy="9.5" r="1.5" fill="#fff6d8" />
      <circle cx="16" cy="18" r="2.2" fill="#c43c3c" />
    </svg>
  );
}

/** 기사 카드 아이콘 (방패 + 검) */
export function KnightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="knight-svg">
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="currentColor" />
      <path d="M12 6v11M9 9.5h6" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** 이동 카드: 방향 화살표(검) + 거리 눈금 */
export const MoveCard = forwardRef<
  HTMLElement,
  {
    card: Card;
    size?: 'md' | 'sm' | 'xs';
    kind?: 'place' | 'hero' | 'blocked' | null;
    selected?: boolean;
    fresh?: boolean;
    title?: string;
    onClick?: () => void;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
    className?: string;
    style?: React.CSSProperties;
  }
>(function MoveCard({ card, size = 'md', kind = null, selected, fresh, title, onClick, onPointerEnter, onPointerLeave, onPointerDown, className = '', style }, ref) {
  const d = DIRS[card.dir];
  const len = Math.hypot(d.dx, d.dy);
  const ux = d.dx / len;
  const uy = d.dy / len;
  const L = 12.5;
  const tip = { x: 20 + ux * L, y: 21 + uy * L };
  const tail = { x: 20 - ux * L * 0.75, y: 21 - uy * L * 0.75 };
  const ang = Math.atan2(uy, ux);
  const head = (a: number) => ({ x: tip.x - Math.cos(ang + a) * 6.5, y: tip.y - Math.sin(ang + a) * 6.5 });
  const h1 = head(0.48);
  const h2 = head(-0.48);
  // 손잡이(가드): 축에 수직
  const gx = -uy * 4;
  const gy = ux * 4;
  const g0 = { x: tail.x + ux * 3, y: tail.y + uy * 3 };
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      ref={ref}
      type={onClick ? 'button' : undefined}
      className={`move-card ${size} ${kind ?? ''} ${selected ? 'selected' : ''} ${fresh ? 'fresh' : ''} ${className}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      title={title}
      aria-label={`${d.name}쪽 ${card.dist}칸${title ? ` — ${title}` : ''}`}
      aria-pressed={onClick ? !!selected : undefined}
      style={style}
    >
      <svg viewBox="0 0 40 52" aria-hidden>
        <circle cx="20" cy="21" r="16.5" className="mc-ring" />
        <line x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} className="mc-shaft" />
        <line x1={g0.x - gx} y1={g0.y - gy} x2={g0.x + gx} y2={g0.y + gy} className="mc-guard" />
        <path d={`M${tip.x} ${tip.y} L${h1.x} ${h1.y} L${h2.x} ${h2.y} Z`} className="mc-head" />
        <circle cx={tail.x} cy={tail.y} r="2.2" className="mc-hilt" />
        <g className="mc-pips">
          {Array.from({ length: card.dist }, (_, i) => (
            <circle key={i} cx={20 + (i - (card.dist - 1) / 2) * 6.5} cy="45.5" r="2.4" />
          ))}
        </g>
      </svg>
      {kind === 'hero' && (
        <span className="mc-badge" aria-hidden>
          <KnightIcon size={12} />
        </span>
      )}
    </Tag>
  );
});

export const cardText = (c: Card) => `${DIRS[c.dir].arrow}${c.dist}`;

/** 로비용 미리보기: 보드 크기·인원별 돌 색 */
export function BoardPreview({ config: c, players }: { config: GameConfig; players: number }) {
  const n = c.boardSize;
  const mid = Math.floor(n / 2);
  return (
    <div className="board-preview">
      <div className="bp-grid" style={{ ['--n' as string]: n }} aria-label={`${n}×${n} 보드`}>
        {Array.from({ length: n * n }, (_, i) => (
          <span key={i} />
        ))}
        <span className="bp-crown" style={{ gridColumn: mid + 1, gridRow: mid + 1 }}>
          <CrownIcon size="100%" />
        </span>
      </div>
      <div className="bp-legend small">
        <div className="bp-seats">
          {Array.from({ length: players }, (_, i) => (
            <SeatStone key={i} seat={i} size={20} />
          ))}
        </div>
        <div>
          보드 <b>
            {n}×{n}
          </b>
          {c.holes > 0 && <> · 막힌 칸 {c.holes}</>} · 돌 {c.stones}
        </div>
        <div>
          이동 카드 <b>{deckSize(c)}</b>장 ({c.diagonals ? 8 : 4}방향 × 1~{c.maxDistance}칸{c.cardCopies > 1 ? ` × ${c.cardCopies}벌` : ''})
        </div>
        <div>
          기사 1인 <b>{c.heroes}</b>장 · 손패 {c.handLimit}장{c.openHands ? ' 공개' : ' 비공개'}
        </div>
      </div>
    </div>
  );
}
