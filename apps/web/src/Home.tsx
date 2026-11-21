import { useEffect, useState } from 'react';
import { call } from './socket';
import { store } from './storage';
import { CrownIcon, SeatStone } from './theme';
import { GuideButton } from './Guide';

/** 첫 화면 왼쪽: 왕관이 움직이며 돌을 놓는 짧은 시연 (반복) */
const DEMO_N = 5;
const DEMO: { x: number; y: number; seat: number; hero?: boolean }[] = [
  { x: 3, y: 1, seat: 0 },
  { x: 3, y: 3, seat: 1 },
  { x: 2, y: 2, seat: 0 },
  { x: 1, y: 3, seat: 1 },
  { x: 2, y: 1, seat: 0 },
  { x: 3, y: 2, seat: 1 },
  { x: 1, y: 2, seat: 0 },
  { x: 3, y: 2, seat: 0, hero: true },
  { x: 0, y: 3, seat: 1 },
  { x: 1, y: 1, seat: 0 },
];

function DemoBoard() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setStep(DEMO.length);
      return;
    }
    const t = setInterval(() => setStep((s) => (s >= DEMO.length + 2 ? 0 : s + 1)), 950);
    return () => clearInterval(t);
  }, []);
  const shown = Math.min(step, DEMO.length);
  const cells = new Map<number, { seat: number; fresh: boolean; hero: boolean }>();
  DEMO.slice(0, shown).forEach((m, i) => cells.set(m.y * DEMO_N + m.x, { seat: m.seat, fresh: i === shown - 1, hero: !!m.hero }));
  const crown = shown === 0 ? { x: 2, y: 2 } : DEMO[shown - 1];
  return (
    <div className="demo-board" aria-hidden>
      <div className="demo-grid">
        {Array.from({ length: DEMO_N * DEMO_N }, (_, i) => {
          const v = cells.get(i);
          return (
            <div key={i} className="demo-cell">
              {v && (
                <span className={`stone ${v.fresh ? (v.hero ? 'flipped' : 'fresh') : ''}`} key={`${i}-${v.seat}`}>
                  <SeatStone seat={v.seat} size="100%" />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <span className="demo-crown" style={{ left: `${((crown.x + 0.5) / DEMO_N) * 100}%`, top: `${((crown.y + 0.5) / DEMO_N) * 100}%` }}>
        <CrownIcon size="100%" />
      </span>
    </div>
  );
}

export function Brand({ small }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <svg width={small ? 34 : 48} height={small ? 34 : 48} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--ink)" />
        <path d="M14 44 L16 22 L25 32 L32 16 L39 32 L48 22 L50 44 Z" fill="var(--gold)" />
        <rect x="14" y="46" width="36" height="5" rx="2" fill="var(--gold)" />
      </svg>
      <div>
        <h1>Crown March</h1>
        <p className="muted">왕관 행진 · 2~4인 영토 보드게임</p>
      </div>
    </div>
  );
}

/** 첫 화면 공통 틀: 왼쪽 소개 + 오른쪽 카드 (좁으면 위아래) */
export function HomeShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="home">
      <section className="home-hero">
        <Brand />
        <p className="home-lead">
          모두가 함께 움직이는 <b>왕관</b>을 이동 카드로 옮겨, 멈춘 칸에 내 가문의 돌을 놓으세요.
          <br />
          이어진 영토가 클수록 점수는 <b>제곱</b>으로 커집니다.
        </p>
        <DemoBoard />
        <ul className="home-chips">
          <li>👥 2~4인 · 4인 팀전</li>
          <li>📱 각자 휴대폰으로 QR 입장</li>
          <li>🧩 보드 크기·돌·카드 커스텀</li>
          <li>⚔️ 기사로 상대 돌 뒤집기</li>
        </ul>
        <GuideButton className="btn guide-cta" label="게임 방법 자세히 보기" />
      </section>
      <section className="home-card panel">{children}</section>
    </main>
  );
}

export function Home({ onEnter, flash }: { onEnter: (code: string) => void; flash: string | null }) {
  const [name, setName] = useState(store.name());
  const [usePw, setUsePw] = useState(false);
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(flash);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return setError('닉네임을 입력하세요');
    setBusy(true);
    store.setName(name.trim());
    const pw = usePw ? password : '';
    const r = await call<{ code: string; token: string }>('create', { name, password: pw || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    store.setToken(r.code, r.token);
    store.setPassword(r.code, pw || null);
    onEnter(r.code);
  };

  const join = () => {
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) return setError('방 코드는 4자리입니다');
    if (name.trim()) store.setName(name.trim());
    onEnter(c);
  };

  return (
    <HomeShell>
      <h2 className="home-card-title">게임 시작하기</h2>
      <p className="muted small home-step">① 닉네임을 정하고 ② 방을 새로 만들거나, 초대받은 방에 들어가세요</p>
      {error && <div className="alert">{error}</div>}
      <label className="field">
        <span>닉네임</span>
        <div className="name-input">
          <SeatStone seat={0} size={28} />
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="예: 민지" />
        </div>
      </label>
      <div className="entry-options">
        <div className="entry create">
          <div className="entry-head">
            <span className="entry-icon" aria-hidden>
              👑
            </span>
            <div>
              <h3>새 방 만들기</h3>
              <p>내가 방장이 돼요. 만들면 QR·링크로 친구를 초대할 수 있어요.</p>
            </div>
          </div>
          <label className="check small">
            <input type="checkbox" checked={usePw} onChange={(e) => setUsePw(e.target.checked)} /> 방 암호 걸기 (선택)
          </label>
          {usePw && <input value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} placeholder="암호" onKeyDown={(e) => e.key === 'Enter' && create()} />}
          <button className="btn primary wide big-btn" disabled={busy} onClick={create}>
            방 만들기
          </button>
        </div>
        <div className="entry-or" aria-hidden>
          <span>또는</span>
        </div>
        <div className="entry join">
          <div className="entry-head">
            <span className="entry-icon" aria-hidden>
              🔑
            </span>
            <div>
              <h3>초대받은 방 들어가기</h3>
              <p>친구에게 받은 4자리 방 코드를 입력하세요. QR·링크로 받았다면 그냥 열면 돼요.</p>
            </div>
          </div>
          <div className="row">
            <input
              className="code-input big grow"
              value={joinCode}
              maxLength={4}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="ABCD"
              autoCapitalize="characters"
              aria-label="방 코드 4자리"
            />
            <button className="btn join-btn big-btn" onClick={join} disabled={joinCode.length !== 4}>
              입장
            </button>
          </div>
        </div>
      </div>
    </HomeShell>
  );
}
