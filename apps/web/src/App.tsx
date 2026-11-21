import { useCallback, useEffect, useState } from 'react';
import type { EmoteEvent, RoomView } from '@rw/engine';
import { call, socket } from './socket';
import { store } from './storage';
import { Lobby } from './Lobby';
import { Game } from './Game';

function useLocation() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to: string) => {
    history.pushState(null, '', to);
    setPath(to);
  }, []);
  return { path, navigate };
}

export function App() {
  const { path, navigate } = useLocation();
  const [flash, setFlash] = useState<string | null>(null);
  const m = path.match(/^\/r\/([A-Za-z0-9]{4})\/?$/);
  const code = m ? m[1].toUpperCase() : null;

  const goHome = useCallback(
    (msg?: string) => {
      setFlash(msg ?? null);
      navigate('/');
    },
    [navigate],
  );

  return (
    <>
      {code ? <RoomPage key={code} code={code} onExit={goHome} /> : <Home flash={flash} onEnter={(c) => navigate(`/r/${c}`)} />}
    </>
  );
}

function Brand() {
  return (
    <div className="brand">
      <svg width="40" height="40" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--ink)" />
        <path d="M14 44 L16 22 L25 32 L32 16 L39 32 L48 22 L50 44 Z" fill="var(--gold)" />
        <rect x="14" y="46" width="36" height="5" rx="2" fill="var(--gold)" />
      </svg>
      <div>
        <h1>Crown March</h1>
        <p className="muted">왕관을 움직여 영토를 넓히는 2~4인 땅따먹기</p>
      </div>
    </div>
  );
}

function Home({ onEnter, flash }: { onEnter: (code: string) => void; flash: string | null }) {
  const [name, setName] = useState(store.name());
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(flash);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return setError('닉네임을 입력하세요');
    setBusy(true);
    store.setName(name.trim());
    const r = await call<{ code: string; token: string }>('create', { name, password: password || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    store.setToken(r.code, r.token);
    store.setPassword(r.code, password || null);
    onEnter(r.code);
  };

  const join = () => {
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) return setError('방 코드는 4자리입니다');
    if (name.trim()) store.setName(name.trim());
    onEnter(c);
  };

  return (
    <main className="page narrow">
      <Brand />
      {error && <div className="alert">{error}</div>}
      <section className="panel">
        <label className="field">
          <span>닉네임</span>
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="예: 민지" />
        </label>
      </section>
      <section className="panel">
        <h2>방 만들기</h2>
        <label className="field">
          <span>방 암호 (선택)</span>
          <input value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} placeholder="비워두면 누구나 입장" />
        </label>
        <button className="btn primary wide" disabled={busy} onClick={create}>
          방 만들기
        </button>
      </section>
      <section className="panel">
        <h2>코드로 들어가기</h2>
        <div className="row">
          <input
            className="code-input"
            value={joinCode}
            maxLength={4}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            placeholder="ABCD"
            autoCapitalize="characters"
          />
          <button className="btn" onClick={join}>
            입장
          </button>
        </div>
        <p className="muted small">QR 코드나 링크로 받았다면 그냥 열면 됩니다.</p>
      </section>
      <RulesCard />
    </main>
  );
}

function RulesCard() {
  return (
    <details className="panel rules">
      <summary>규칙 요약</summary>
      <ul>
        <li>보드 가운데의 <b>왕관</b>은 모두가 함께 움직입니다. 각자 이동 카드(방향 + 거리)를 공개로 들고 있습니다.</li>
        <li>내 차례엔 셋 중 하나: <b>① 이동 카드를 내서</b> 왕관을 옮기고 도착한 빈 칸에 내 돌을 놓기 · <b>② 카드 1장 가져오기</b>(손패 상한 미만일 때) · <b>③ 기사 + 이동 카드</b>로 상대 돌 칸에 도착해 그 돌을 내 색으로 뒤집기.</li>
        <li>보드 밖, 막힌 칸, 내 돌이 있는 칸으로는 갈 수 없습니다. 할 수 있는 게 없으면 패스.</li>
        <li>공용 돌을 다 쓰거나 모두 연속으로 패스하면 판이 끝납니다.</li>
        <li>점수: 상하좌우로 이어진 내 돌 영역마다 <b>칸 수²</b>. 동점이면 기사를 덜 쓴 사람이 이깁니다.</li>
      </ul>
    </details>
  );
}

type Phase = { kind: 'connecting' } | { kind: 'form'; hasPassword: boolean; inGame: boolean; error?: string } | { kind: 'in' };

function RoomPage({ code, onExit }: { code: string; onExit: (msg?: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'connecting' });
  const [view, setView] = useState<RoomView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [emotes, setEmotes] = useState<EmoteEvent[]>([]);

  useEffect(() => {
    const up = () => setConnected(true);
    const down = () => setConnected(false);
    socket.on('connect', up);
    socket.on('disconnect', down);
    return () => {
      socket.off('connect', up);
      socket.off('disconnect', down);
    };
  }, []);

  const hashPw = new URLSearchParams(location.hash.slice(1)).get('pw') ?? '';

  const enter = useCallback(
    async (opts: { name: string; password?: string; spectator?: boolean }) => {
      const r = await call<{ code: string; token: string }>('join', { code, token: store.token(code) ?? undefined, ...opts });
      if (!r.ok) return r.error;
      store.setToken(code, r.token);
      if (opts.password) store.setPassword(code, opts.password);
      if (location.hash) history.replaceState(null, '', location.pathname); // 암호를 주소창에서 지움
      setPhase({ kind: 'in' });
      return null;
    },
    [code],
  );

  // 최초 진입: 토큰이 있으면 바로 재접속, 아니면 입장 폼
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (store.token(code)) {
        const err = await enter({ name: store.name() });
        if (!err || cancelled) return;
        store.setToken(code, null);
      }
      const p = await call<{ hasPassword: boolean; inGame: boolean }>('peek', { code });
      if (cancelled) return;
      if (!p.ok) return onExit(p.error);
      setPhase({ kind: 'form', hasPassword: p.hasPassword, inGame: p.inGame });
    })();
    return () => {
      cancelled = true;
    };
  }, [code, enter, onExit]);

  // 서버 이벤트
  useEffect(() => {
    const onRoom = (v: RoomView) => setView(v);
    const onKicked = (reason?: string) => {
      store.setToken(code, null);
      onExit(typeof reason === 'string' ? reason : '방에서 나갔습니다');
    };
    const onErr = (m: string) => setToast(m);
    // 연결이 끊겼다가 다시 붙으면(무중단 배포로 새 서버로 옮겨졌을 때 포함) 토큰으로 같은 방에 재입장
    let wasDown = false;
    const onDown = () => {
      wasDown = true;
    };
    const onReconnect = async () => {
      if (!wasDown || !store.token(code)) return;
      wasDown = false;
      let err: string | null = null;
      // 새 서버가 방을 막 넘겨받는 중일 수 있어 몇 번 다시 시도
      for (let i = 0; i < 4; i++) {
        err = await enter({ name: store.name() });
        if (!err || !/찾을 수 없|업데이트 중|응답이 없/.test(err)) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
      // 서버 재시작 등으로 방이 사라졌으면 멈춘 화면에 남지 말고 처음으로
      if (err) {
        store.setToken(code, null);
        onExit(`${err} — 서버가 재시작되어 방이 닫혔을 수 있어요`);
      }
    };
    const onEmote = (e: EmoteEvent) => {
      // 같은 사람의 이전 말풍선은 새 것으로 교체, 3초 뒤 사라짐
      setEmotes((list) => [...list.filter((x) => x.from !== e.from), e]);
      setTimeout(() => setEmotes((list) => list.filter((x) => x.n !== e.n)), 3000);
    };
    socket.on('emote', onEmote);
    socket.on('room', onRoom);
    socket.on('kicked', onKicked);
    socket.on('error-message', onErr);
    socket.on('disconnect', onDown);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('emote', onEmote);
      socket.off('room', onRoom);
      socket.off('kicked', onKicked);
      socket.off('error-message', onErr);
      socket.off('disconnect', onDown);
    socket.off('connect', onReconnect);
    };
  }, [code, enter, onExit]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(async (event: string, payload: object = {}) => {
    const r = await call(event, payload);
    if (!r.ok) setToast(r.error);
    return r.ok;
  }, []);

  const leave = async () => {
    const r = await call('leave');
    if (!r.ok) return setToast(r.error);
    store.setToken(code, null);
    onExit();
  };

  if (phase.kind === 'connecting') return <main className="page narrow center muted">접속 중…</main>;
  if (phase.kind === 'form') return <JoinForm code={code} phase={phase} defaultPw={hashPw} onSubmit={enter} onCancel={() => onExit()} />;
  if (!view) return <main className="page narrow center muted">불러오는 중…</main>;

  return (
    <>
      {view.game ? (
        <Game view={view} act={act} onLeave={leave} notify={setToast} emotes={emotes} onEmote={(id) => act('emote', { id })} />
      ) : (
        <Lobby view={view} act={act} onLeave={leave} emotes={emotes} onEmote={(id) => act('emote', { id })} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {!connected && <div className="offline">연결이 끊겼습니다 — 다시 연결하는 중…</div>}
    </>
  );
}

function JoinForm({
  code,
  phase,
  defaultPw,
  onSubmit,
  onCancel,
}: {
  code: string;
  phase: { hasPassword: boolean; inGame: boolean };
  defaultPw: string;
  onSubmit: (o: { name: string; password?: string; spectator?: boolean }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(store.name());
  const [password, setPassword] = useState(defaultPw);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (spectator = false) => {
    if (!name.trim()) return setError('닉네임을 입력하세요');
    store.setName(name.trim());
    setBusy(true);
    const err = await onSubmit({ name, password: password || undefined, spectator });
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <main className="page narrow">
      <Brand />
      <section className="panel">
        <h2>
          방 <span className="code">{code}</span> 입장
        </h2>
        {phase.inGame && <p className="muted small">이미 게임이 진행 중이라 관전자로 들어갑니다.</p>}
        {error && <div className="alert">{error}</div>}
        <label className="field">
          <span>닉네임</span>
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        {phase.hasPassword && (
          <label className="field">
            <span>방 암호</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
        )}
        <div className="row">
          <button className="btn primary grow" disabled={busy} onClick={() => submit()}>
            입장
          </button>
          {!phase.inGame && (
            <button className="btn" disabled={busy} onClick={() => submit(true)}>
              관전
            </button>
          )}
        </div>
        <button className="btn ghost wide" onClick={onCancel}>
          처음으로
        </button>
      </section>
    </main>
  );
}
