import { useCallback, useEffect, useState } from 'react';
import { DRAIN_MESSAGE, type EmoteEvent, type RoomView } from '@rw/engine';
import { call, socket } from './socket';
import { store } from './storage';
import { Lobby } from './Lobby';
import { Game } from './Game';
import { Home, HomeShell } from './Home';

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
      for (let i = 0; i < 10; i++) {
        err = await enter({ name: store.name() });
        if (!err || !(err === DRAIN_MESSAGE || /찾을 수 없|응답이 없/.test(err))) break;
        await new Promise((r) => setTimeout(r, 1000));
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
    <HomeShell>
        <h2 className="home-card-title">
          방 <span className="code">{code}</span>에 초대받았어요
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
          <button className="btn primary grow big-btn" disabled={busy} onClick={() => submit()}>
            입장하기
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
    </HomeShell>
  );
}
