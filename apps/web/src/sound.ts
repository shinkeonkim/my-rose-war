// 짧은 알림음 (WebAudio로 합성 — 음원 파일 없음). 음소거 설정은 기기에만 저장.
let ctx: AudioContext | null = null;

function getMuted(): boolean {
  try {
    return localStorage.getItem('el:mute') === '1';
  } catch {
    return false;
  }
}
let muted = getMuted();
const listeners = new Set<(m: boolean) => void>();

export const sound = {
  get muted() {
    return muted;
  },
  setMuted(m: boolean) {
    muted = m;
    try {
      localStorage.setItem('el:mute', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    listeners.forEach((fn) => fn(m));
  },
  subscribe(fn: (m: boolean) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** 브라우저 자동재생 정책: 사용자 조작 중에 한 번 깨워 둔다 */
  unlock() {
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
    } catch {
      /* 지원 안 함 */
    }
  },
  play(kind: 'myTurn' | 'turn' | 'emote') {
    if (muted) return;
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') return; // 아직 사용자 조작 전
      const notes = kind === 'myTurn' ? [660, 880, 1175] : kind === 'turn' ? [520] : [990];
      const vol = kind === 'myTurn' ? 0.16 : 0.06;
      notes.forEach((f, i) => {
        const t = ctx!.currentTime + i * 0.11;
        const o = ctx!.createOscillator();
        const g = ctx!.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g).connect(ctx!.destination);
        o.start(t);
        o.stop(t + 0.3);
      });
    } catch {
      /* ignore */
    }
  },
};

if (typeof window !== 'undefined') {
  const wake = () => sound.unlock();
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
}
