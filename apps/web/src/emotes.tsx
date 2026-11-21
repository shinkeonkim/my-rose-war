import { useEffect, useRef, useState } from 'react';
import { EMOTES, EmoteEvent, emoteAnim } from '@rw/engine';

export const emoteText = (id: string) => EMOTES.find((e) => e.id === id)?.text ?? '';

/** 감정 표현 고르기 버튼 + 팔레트 */
export function EmoteButton({ onSend, small }: { onSend: (id: string) => void; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const emojis = EMOTES.filter((e) => [...e.text].length <= 2);
  const phrases = EMOTES.filter((e) => [...e.text].length > 2);
  return (
    <div className="emote-wrap" ref={wrap}>
      <button className={`btn ghost ${small ? 'tiny' : ''} emote-toggle`} aria-expanded={open} aria-label="감정 표현 보내기" onClick={() => setOpen((v) => !v)}>
        😊
      </button>
      {open && (
        <div className="emote-palette" role="menu">
          <div className="emote-grid">
            {emojis.map((e) => (
              <button
                key={e.id}
                className="emote-emoji"
                role="menuitem"
                onClick={() => {
                  onSend(e.id);
                  setOpen(false);
                }}
              >
                {e.text}
              </button>
            ))}
          </div>
          <div className="emote-phrases">
            {phrases.map((e) => (
              <button
                key={e.id}
                className="chip"
                role="menuitem"
                onClick={() => {
                  onSend(e.id);
                  setOpen(false);
                }}
              >
                {e.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 이름 옆/보드 위에 잠깐 떠오르는 말풍선 */
export function EmoteBubble({ e }: { e?: EmoteEvent }) {
  if (!e) return null;
  const text = emoteText(e.id);
  const big = [...text].length <= 2;
  return (
    <span className={`emote-bubble ${big ? 'big' : ''} ${emoteAnim(e.id) ? `anim-${emoteAnim(e.id)}` : ''}`} key={e.n} role="status" aria-label={`${e.name}: ${text}`}>
      <span className="emote-inner">{text}</span>
    </span>
  );
}

/** 좌석이 없는 사람(관전자 등)의 감정 표현을 화면 위쪽에 띄움 */
export function EmoteFeed({ items }: { items: EmoteEvent[] }) {
  if (!items.length) return null;
  return (
    <div className="emote-feed" aria-live="polite">
      {items.map((e) => (
        <div key={e.n} className="emote-feed-item">
          <b>{e.name}</b> {emoteText(e.id)}
        </div>
      ))}
    </div>
  );
}
