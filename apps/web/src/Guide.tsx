import { useEffect, useRef, useState } from 'react';
import { CLASSIC, Card, EMPTY, HOLE, scoreBoard } from '@rw/engine';
import { CrownIcon, KnightIcon, MoveCard, SeatStone } from './theme';

/** 게임 방법 열기 버튼 + 모달 */
export function GuideButton({ className = 'btn ghost', label = '게임 방법' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} aria-label={label}>
        📖 <span className="guide-label">{label}</span>
      </button>
      {open && <GuideModal onClose={() => setOpen(false)} />}
    </>
  );
}

const SECTIONS = [
  { id: 'goal', title: '목표' },
  { id: 'parts', title: '구성' },
  { id: 'turn', title: '내 차례' },
  { id: 'knight', title: '기사 카드' },
  { id: 'rules', title: '갈 수 없는 칸' },
  { id: 'end', title: '끝과 점수' },
  { id: 'multi', title: '3~4인 · 팀전' },
  { id: 'custom', title: '규칙 설정' },
  { id: 'ui', title: '화면 사용법' },
];

/** 짧은 플레이 영상 (자동 재생·반복·무음). 파일이 없으면 숨김 */
function Clip({ src, caption }: { src: string; caption: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="g-clip">
      <video src={src} autoPlay muted loop playsInline preload="metadata" onError={() => setFailed(true)} aria-label={caption} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

const c = (dir: number, dist: number, id = `${dir}${dist}`): Card => ({ id, dir: dir as Card['dir'], dist });

/** 작은 보드 그림 */
function MiniBoard({
  size,
  cells,
  crown,
  marks = {},
  arrow,
  labels = {},
}: {
  size: number;
  cells: Record<number, number>;
  crown?: [number, number];
  marks?: Record<number, 'ok' | 'no' | 'hero'>;
  arrow?: [number, number, number, number];
  labels?: Record<number, string>;
}) {
  return (
    <div className="g-board" style={{ ['--n' as string]: size }}>
      {Array.from({ length: size * size }, (_, i) => {
        const v = cells[i] ?? EMPTY;
        return (
          <div key={i} className={`g-cell ${v === HOLE ? 'hole' : ''} ${marks[i] ? `m-${marks[i]}` : ''}`}>
            {v >= 0 && <SeatStone seat={v} size="78%" />}
            {marks[i] === 'no' && <span className="g-x">✕</span>}
            {marks[i] === 'hero' && (
              <span className="g-k">
                <KnightIcon size={12} />
              </span>
            )}
            {labels[i] && <span className="g-label">{labels[i]}</span>}
          </div>
        );
      })}
      {arrow && (
        <svg className="g-arrow" viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <line x1={arrow[0] + 0.5} y1={arrow[1] + 0.5} x2={arrow[2] + 0.5} y2={arrow[3] + 0.5} />
          <circle cx={arrow[2] + 0.5} cy={arrow[3] + 0.5} r="0.12" />
        </svg>
      )}
      {crown && (
        <span className="g-crown" style={{ left: `${((crown[0] + 0.5) / size) * 100}%`, top: `${((crown[1] + 0.5) / size) * 100}%` }}>
          <CrownIcon size="100%" />
        </span>
      )}
    </div>
  );
}

/** 5×5 점수 예시 */
const SCORE_SIZE = 5;
const SCORE_CELLS: Record<number, number> = { 0: 0, 1: 0, 5: 0, 6: 0, 2: 1, 3: 1, 8: 1, 13: 1, 10: 0, 12: 0, 18: 1, 19: 1, 20: 1, 22: 0, 24: 0 };
function scoreExample() {
  const board = Array.from({ length: SCORE_SIZE * SCORE_SIZE }, (_, i) => SCORE_CELLS[i] ?? EMPTY);
  const r = scoreBoard(board, SCORE_SIZE, CLASSIC, 2);
  const labels: Record<number, string> = {};
  for (const g of r.groups) labels[Math.min(...g.cells)] = String(g.cells.length);
  const parts = (side: number) =>
    r.groups
      .filter((g) => g.side === side)
      .map((g) => g.cells.length)
      .sort((a, b) => b - a);
  return { labels, scores: r.scores, parts };
}

export function GuideModal({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState('goal');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  // 스크롤 위치에 따라 목차 강조
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id.replace('g-', ''));
      },
      { root, rootMargin: '0px 0px -65% 0px' },
    );
    root.querySelectorAll('section[id^="g-"]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  const go = (id: string) => (setActive(id), body.current)?.querySelector(`#g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const ex = scoreExample();

  return (
    <div className="g-overlay" role="dialog" aria-modal="true" aria-label="게임 방법" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="g-sheet">
        <header className="g-head">
          <div className="g-title">
            <CrownIcon size={26} />
            <div>
              <h2>게임 방법</h2>
              <span className="muted small">Crown March · 2~4인 · 약 20~30분</span>
            </div>
          </div>
          <button className="icon-btn g-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>
        <nav className="g-nav" aria-label="목차">
          {SECTIONS.map((s, i) => (
            <button key={s.id} className={`chip ${active === s.id ? 'on' : ''}`} onClick={() => go(s.id)}>
              <span className="g-num">{i + 1}</span> {s.title}
            </button>
          ))}
        </nav>
        <div className="g-body" ref={body}>
          <section id="g-goal">
            <h3>1. 목표</h3>
            <p>
              보드 위의 <b>왕관 하나를 모두가 함께</b> 움직입니다. 왕관이 멈춘 칸에 내 가문의 돌을 놓아 <b>이어진 영토를 크게</b> 만드세요.
              영토 점수는 칸 수의 <b>제곱</b>이라, 작은 땅 여러 개보다 <b>큰 땅 하나</b>가 훨씬 유리합니다.
            </p>
            <div className="g-row center">
              <MiniBoard size={5} cells={{ 6: 0, 7: 0, 11: 0, 12: 0, 13: 0, 3: 1, 4: 1, 20: 1 }} crown={[2, 2]} />
              <div className="g-note">
                <SeatStone seat={0} size={18} /> 5칸이 이어짐 → <b>25점</b>
                <br />
                <SeatStone seat={1} size={18} /> 2칸 + 1칸 → 4 + 1 = <b>5점</b>
              </div>
            </div>
          </section>

          <section id="g-parts">
            <h3>2. 구성</h3>
            <div className="g-parts">
              <div className="g-part">
                <span className="g-part-art">
                  <CrownIcon size={40} />
                </span>
                <b>왕관</b>
                <span>모두가 함께 쓰는 말 1개. 보드 가운데에서 시작해요.</span>
              </div>
              <div className="g-part">
                <span className="g-part-art">
                  <SeatStone seat={0} size={30} />
                  <SeatStone seat={1} size={30} />
                  <SeatStone seat={2} size={30} />
                  <SeatStone seat={3} size={30} />
                </span>
                <b>가문 돌</b>
                <span>진홍 · 백은 · 청람 · 비취. 모두가 한 무더기(공용 돌)에서 꺼내 씁니다. 원작 52개.</span>
              </div>
              <div className="g-part">
                <span className="g-part-art">
                  <MoveCard card={c(1, 2)} size="sm" />
                  <MoveCard card={c(6, 3)} size="sm" />
                </span>
                <b>이동 카드</b>
                <span>
                  <b>검이 가리키는 방향</b>으로 <b>점 개수만큼</b> 왕관을 옮겨요. 8방향 × 1~3칸 = 24장. 손패는 최대 5장이고 <b>모두에게 공개</b>됩니다.
                </span>
              </div>
              <div className="g-part">
                <span className="g-part-art g-knight">
                  <KnightIcon size={34} />
                </span>
                <b>기사 카드</b>
                <span>한 사람당 4장. 상대 돌을 내 색으로 뒤집을 때 씁니다. 한 번 쓰면 끝.</span>
              </div>
            </div>
          </section>

          <section id="g-turn">
            <h3>3. 내 차례 — 셋 중 하나</h3>
            <ol className="g-steps">
              <li>
                <b>이동 카드 내기</b> — 왕관을 카드대로 옮기고, 도착한 <b>빈 칸</b>에 내 돌을 놓습니다. 사이에 있는 칸은 상관없이 뛰어넘어요.
              </li>
              <li>
                <b>카드 1장 가져오기</b> — 손패가 상한(5장)보다 적을 때만. 더미가 비면 버린 카드를 섞어 다시 씁니다.
              </li>
              <li>
                <b>기사 + 이동 카드</b> — 도착한 칸에 <b>상대 돌</b>이 있으면 기사 1장을 써서 그 돌을 내 색으로 뒤집습니다. (아래 4번)
              </li>
            </ol>
            <div className="g-row">
              <MiniBoard size={5} cells={{ 7: 1 }} crown={[2, 2]} arrow={[2, 2, 4, 0]} marks={{ 4: 'ok' }} />
              <div className="g-note">
                <MoveCard card={c(1, 2)} size="sm" />
                <span>
                  <b>↗ 2칸</b> 카드: 왕관이 오른쪽 위로 2칸 이동하고, 그 칸에 내 돌을 놓아요.
                </span>
              </div>
            </div>
            <Clip src="/guide/move.mp4" caption="카드를 누르면 갈 칸과 경로가 보이고, 한 번 더 누르면 돌을 놓아요" />
          </section>

          <section id="g-knight">
            <h3>4. 기사 카드</h3>
            <p>
              이동 카드의 도착 칸에 <b>상대의 돌</b>이 있으면 보통은 갈 수 없지만, <b>기사 1장</b>을 함께 쓰면 갈 수 있고 그 돌이 <b>내 색으로 뒤집힙니다</b>.
              상대의 큰 영토 한가운데를 끊어 점수를 크게 깎을 수 있어요. 기사를 쓸 수 있는 카드에는 <span className="g-inline-badge"><KnightIcon size={11} /></span> 표시가 붙습니다.
            </p>
            <div className="g-row">
              <MiniBoard size={5} cells={{ 11: 1, 12: 1, 13: 1, 7: 1, 17: 0 }} crown={[2, 3]} arrow={[2, 3, 2, 2]} marks={{ 12: 'hero' }} />
              <div className="g-note">
                <SeatStone seat={1} size={18} /> 5칸 영토(25점)의 가운데를 뒤집으면 → 1+1+1+1 = <b>4점</b>으로 쪼개져요.
              </div>
            </div>
            <Clip src="/guide/knight.mp4" caption="기사로 상대 돌을 뒤집는 장면" />
            <p className="muted small">팁: 기사는 동점일 때도 중요해요 — 점수가 같으면 기사를 덜 쓴 사람이 이깁니다.</p>
          </section>

          <section id="g-rules">
            <h3>5. 갈 수 없는 칸</h3>
            <div className="g-row">
              <MiniBoard
                size={5}
                cells={{ 2: 0, 14: HOLE, 22: 1 }}
                crown={[2, 2]}
                marks={{ 2: 'no', 14: 'no', 22: 'hero' }}
                labels={{ 2: '', 14: '' }}
              />
              <ul className="g-list">
                <li>
                  <b>보드 밖</b>으로 나가는 카드 ✕
                </li>
                <li>
                  <b>내 돌</b>(팀전이면 같은 팀 돌)이 있는 칸 ✕
                </li>
                <li>
                  <b>막힌 칸</b>(빨간 빗금, "폐허 지도" 설정) ✕
                </li>
                <li>
                  <b>상대 돌</b> 칸은 기사가 있을 때만 <KnightIcon size={12} />
                </li>
                <li>낼 카드가 없고 손패도 가득하면 → 가져오기 불가 → <b>패스</b></li>
              </ul>
            </div>
          </section>

          <section id="g-end">
            <h3>6. 끝과 점수</h3>
            <ul className="g-list">
              <li>
                <b>공용 돌을 모두 쓰면</b> 그 즉시 판이 끝나요. (패널 위쪽에 "남은 돌" 경고가 떠요)
              </li>
              <li>
                <b>모두가 연속으로 패스</b>해도(아무도 왕관을 못 움직임) 끝나요.
              </li>
              <li>
                점수: <b>상하좌우</b>로 이어진 같은 색 영역마다 <b>칸 수²</b>. 대각선은 이어진 것으로 보지 않아요.
              </li>
              <li>동점이면 기사를 덜 쓴 사람이 이겨요.</li>
            </ul>
            <div className="g-row">
              <MiniBoard size={SCORE_SIZE} cells={SCORE_CELLS} labels={ex.labels} />
              <div className="g-note g-score">
                <div>
                  <SeatStone seat={0} size={18} /> {ex.parts(0).map((n) => (n > 1 ? `${n}²` : '1')).join(' + ')} = <b>{ex.scores[0]}점</b>
                </div>
                <div>
                  <SeatStone seat={1} size={18} /> {ex.parts(1).map((n) => (n > 1 ? `${n}²` : '1')).join(' + ')} = <b>{ex.scores[1]}점</b>
                </div>
                <span className="muted small">숫자는 각 영역의 칸 수 · 게임 중 "영역" 버튼으로 볼 수 있어요</span>
              </div>
            </div>
            <Clip src="/guide/end.mp4" caption="돌이 얼마 안 남으면 경고 → 판이 끝나면 영역별 점수 정리" />
          </section>

          <section id="g-multi">
            <h3>7. 3~4인 · 팀전</h3>
            <ul className="g-list">
              <li>가문마다 색이 다른 돌을 쓰고, 기사는 <b>아무 상대</b>의 돌이나 뒤집을 수 있어요.</li>
              <li>인원이 많으면 카드가 모자라므로 이동 카드를 <b>2벌</b> 섞고 보드를 <b>11×11</b>로 키우는 걸 권장해요 (로비의 "3인 권장"·"4인 권장").</li>
              <li>
                <b>4인 팀전</b>: 좌석 1·3 vs 2·4. 같은 팀 돌은 <b>한 영역으로 이어져</b> 점수가 합쳐지고, 서로 뒤집을 수 없어요.
              </li>
            </ul>
            <div className="g-row center">
              <MiniBoard size={4} cells={{ 5: 0, 6: 2, 9: 0, 10: 2, 7: 1, 11: 3, 15: 3 }} />
              <div className="g-note">
                <SeatStone seat={0} size={18} />
                <SeatStone seat={2} size={18} /> A팀 4칸 이어짐 → <b>16점</b>
                <br />
                <SeatStone seat={1} size={18} />
                <SeatStone seat={3} size={18} /> B팀 3칸 → <b>9점</b>
              </div>
            </div>
          </section>

          <section id="g-custom">
            <h3>8. 규칙 설정 (방장)</h3>
            <div className="g-table">
              <div>
                <b>보드 크기</b>
                <span>5×5 ~ 13×13</span>
              </div>
              <div>
                <b>공용 돌</b>
                <span>판 길이. 보드에 맞춘 추천값 버튼</span>
              </div>
              <div>
                <b>막힌 칸</b>
                <span>대칭으로 생기는 폐허 칸</span>
              </div>
              <div>
                <b>이동 거리 · 대각선</b>
                <span>1~4칸, 4방향만도 가능</span>
              </div>
              <div>
                <b>카드 벌 수 · 손패</b>
                <span>인원이 많을 때 늘리기</span>
              </div>
              <div>
                <b>기사 카드</b>
                <span>0~8장</span>
              </div>
              <div>
                <b>손패 공개</b>
                <span>끄면 남의 카드가 뒷면</span>
              </div>
              <div>
                <b>점수 방식</b>
                <span>칸 수² 또는 칸 수, 대각선 연결</span>
              </div>
              <div>
                <b>판 수 · 턴 시간</b>
                <span>여러 판 합산, 시간 초과 시 자동 진행</span>
              </div>
            </div>
            <Clip src="/guide/lobby.mp4" caption="로비: QR로 초대하고 프리셋으로 규칙 고르기" />
          </section>

          <section id="g-ui">
            <h3>9. 화면 사용법</h3>
            <ul className="g-list">
              <li>
                카드를 <b>누르면</b> 갈 칸이 금색으로 표시되고 경로가 보여요. <b>한 번 더 누르거나</b> 그 칸을 누르면 실행.
              </li>
              <li>
                보드의 <b>점선 원</b>은 지금 갈 수 있는 칸이에요 — 칸을 바로 눌러도 됩니다. 빨간 원은 기사로 갈 수 있는 칸.
              </li>
              <li>카드를 보드로 끌어다 놓아도 내려놓을 수 있어요.</li>
              <li>"영역" 버튼: 돌마다 속한 영역의 칸 수 표시 · "기록": 지금까지의 수</li>
              <li>😊 버튼으로 감정 표현 · 연결이 끊겨도 같은 기기로 다시 열면 그대로 돌아와요.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
