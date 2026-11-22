// Crown March README용 데모 영상/GIF와 게임 방법 모달 영상을 실제 앱을 돌려서 녹화한다. (my-lost-city와 같은 도구)
//
//   npm run build && npm run media            # 모든 클립 → docs/media/
//   npm run media -- play mobile              # 일부 클립만
//
// 로컬에 서버를 띄우고, 봇(Socket.IO 클라이언트)과 헤드리스 크로미움 한 명이 실제로 게임한다.
// 화면은 2배 픽셀 스크린샷으로 받아 ffmpeg으로 MP4(30fps)와 GIF로 만든다.
// 필요한 것: ffmpeg, Playwright용 크로미움(`npx playwright install chromium`, 또는 PW_CHROMIUM=실행 파일 경로)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const { io } = require('socket.io-client');

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = join(ROOT, 'docs/media');
const PORT = 3298;
const BASE = `http://localhost:${PORT}`;
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 공통 도구 ----------

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function findChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const def = chromium.executablePath();
  if (existsSync(def)) return undefined;
  // 설치된 Playwright 버전과 캐시된 브라우저 리비전이 다르면 캐시에서 가장 최신 것을 쓴다
  const cache = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  const revs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const r of revs) {
    for (const p of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-linux/chrome',
    ]) {
      const full = join(cache, r, p);
      if (existsSync(full)) return full;
    }
  }
  return undefined;
}

async function startServer() {
  const srv = spawn('node', ['apps/server/dist/server.cjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), MAX_ROOMS: '50', PUBLIC_URL: 'https://my-rose-war.shinkeonkim.com' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return srv;
    } catch {}
    await sleep(100);
  }
  throw new Error('server did not start — run `npm run build` first');
}


const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/** 봇 한 명 (또는 브라우저 플레이어와 같은 자리를 쓰는 그림자 소켓) */
class Bot {
  constructor(name) {
    this.name = name;
    this.s = io(BASE, { transports: ['websocket'] });
    this.view = null;
    this.s.on('room', (v) => {
      this.view = v;
      this.tick();
    });
    this.auto = null;
    this.busy = false;
  }
  call(ev, p = {}) {
    return new Promise((r) => this.s.emit(ev, p, r));
  }
  async create(password) {
    const r = await this.call('create', { name: this.name, password });
    this.code = r.code;
    return r;
  }
  join(code, extra = {}) {
    this.code = code;
    return this.call('join', { code, name: this.name, ...extra });
  }
  get g() {
    return this.view?.game;
  }
  get myTurn() {
    const g = this.g;
    return !!g && g.status === 'playing' && g.turn === g.me;
  }
  /** 이 카드를 내면 일어날 일: 'place' | 'hero' */
  kind(card) {
    const g = this.g;
    const [dx, dy] = DIRS[card.dir];
    const x = g.crown.x + dx * card.dist;
    const y = g.crown.y + dy * card.dist;
    const v = g.board[y * g.size + x];
    return v === -1 ? 'place' : 'hero';
  }
  plays(kind) {
    const g = this.g;
    const hand = g.hands[g.me] ?? [];
    return hand.filter((c) => g.can.plays.includes(c.id) && (!kind || this.kind(c) === kind));
  }
  /** 자동 진행: { delay, heroRate, emoteRate, emotes } */
  play(opts) {
    this.auto = opts;
    this.tick();
  }
  stop() {
    this.auto = null;
  }
  tick() {
    if (!this.auto || !this.myTurn || this.busy) return;
    this.busy = true;
    const { delay = 900, heroRate = 0.15, emoteRate = 0, emotes = ['thumbs', 'nice', 'think', 'fire', 'plan', 'meh'] } = this.auto;
    setTimeout(async () => {
      const move = this.chooseMove(heroRate);
      if (Math.random() < emoteRate) this.s.emit('emote', { id: emotes[Math.floor(Math.random() * emotes.length)] }, () => {});
      const r = move ? await this.call('move', { move }) : { ok: true };
      this.busy = false;
      if (!r.ok) console.log(`[${this.name}] ${r.error}`);
      this.tick();
    }, delay);
  }
  chooseMove(heroRate = 0.15) {
    const g = this.g;
    if (!g || g.turn !== g.me || g.status !== 'playing') return null;
    const place = this.plays('place');
    const hero = this.plays('hero');
    if (hero.length && Math.random() < heroRate) return { type: 'play', cardId: hero[0].id };
    if (place.length) return { type: 'play', cardId: place[Math.floor(Math.random() * place.length)].id };
    if (g.can.draw) return { type: 'draw' };
    if (hero.length) return { type: 'play', cardId: hero[0].id };
    return { type: 'pass' };
  }
  close() {
    this.s.close();
  }
}

/**
 * 녹화기: 2배 픽셀 스크린샷을 쉬지 않고 찍고(약 15fps), 찍은 시각으로 길이를 복원한다.
 * (CDP screencast는 기기 배율을 무시하고 CSS 픽셀 크기로만 보내 글자가 흐려져서 쓰지 않는다)
 */
async function recorder(page, name, { width, height }) {
  const dir = join(tmpdir(), `rw-media-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const vp = page.viewportSize();
  const scale = width / vp.width;
  const frames = [];
  let running = true;
  const loop = (async () => {
    while (running && !page.isClosed()) {
      const t = Date.now() / 1000;
      try {
        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 92,
          optimizeForSpeed: true,
          clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale },
        });
        const file = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
        writeFileSync(file, Buffer.from(data, 'base64'));
        frames.push({ file, t });
      } catch {
        await sleep(30); // 페이지 이동 중
      }
    }
  })();
  const started = Date.now() / 1000;
  return {
    async stop() {
      const end = Date.now() / 1000;
      running = false;
      await loop;
      await cdp.detach();
      if (!frames.length) throw new Error(`no frames for ${name}`);
      // ffconcat: 각 프레임을 다음 프레임 시각까지 유지
      const lines = ['ffconcat version 1.0'];
      frames.forEach((f, i) => {
        const next = frames[i + 1]?.t ?? end;
        const from = i === 0 ? Math.min(f.t, started) : f.t;
        lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - from).toFixed(4)}`);
      });
      lines.push(`file '${frames[frames.length - 1].file}'`);
      const list = join(dir, 'list.txt');
      writeFileSync(list, lines.join('\n'));
      const mp4 = join(OUT, 'clips', `${name}.mp4`);
      await run('ffmpeg', [
        '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        mp4,
      ]);
      rmSync(dir, { recursive: true, force: true });
      console.log(`  ${name}: ${(end - started).toFixed(1)}s, ${frames.length} frames → ${mp4}`);
      return mp4;
    },
  };
}

/** 전체 클립을 이어 붙인 소개 영상 + 표지 이미지 */
async function reel() {
  const order = ['intro', 'lobby', 'play', 'knight', 'ending', 'mobile'];
  const W = 1920, H = 1200, BG = '0x15140f', fade = 0.25;
  const parts = [];
  for (const [i, n] of order.entries()) {
    const d = Number(
      await new Promise((resolve) => {
        const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(OUT, 'clips', `${n}.mp4`)]);
        let out = '';
        p.stdout.on('data', (b) => (out += b));
        p.on('exit', () => resolve(out.trim()));
      }),
    );
    const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG}`;
    const fin = i === 0 ? '' : `,fade=t=in:st=0:d=${fade}:color=${BG}`;
    const fout = i === order.length - 1 ? '' : `,fade=t=out:st=${(d - fade).toFixed(3)}:d=${fade}:color=${BG}`;
    parts.push(`[${i}:v]${fit},setsar=1,fps=${FPS}${fin}${fout}[v${i}]`);
  }
  const inputs = order.flatMap((n) => ['-i', join(OUT, 'clips', `${n}.mp4`)]);
  const concat = `${order.map((_, i) => `[v${i}]`).join('')}concat=n=${order.length}:v=1:a=0[out]`;
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${parts.join(';')};${concat}`, '-map', '[out]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(OUT, 'crown-march-demo.mp4'),
  ]);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '2.5', '-i', join(OUT, 'clips', 'knight.mp4'), '-frames:v', '1', '-vf', 'scale=1280:-1', join(OUT, 'cover.png')]);
}

async function gif(name, width, fps = 15, skip = 0) {
  // 글자가 뭉개지지 않게: 256색 팔레트 + sierra 디더 (예전: 128색·bayer·12fps·720px)
  const filters = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(skip), '-i', join(OUT, 'clips', `${name}.mp4`), '-lavfi', filters, '-loop', '0', join(OUT, 'gif', `${name}.gif`)]);
}

/** 헤드리스에는 마우스 커서가 안 보이므로 가짜 커서와 탭 표시를 그린다 */
const CURSOR_SCRIPT = `
  addEventListener('DOMContentLoaded', () => {
    const touch = matchMedia('(pointer: coarse)').matches;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:opacity .2s;' + (touch ? 'display:none' : '');
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const style = document.createElement('style');
    style.textContent = '@keyframes __tap{from{transform:translate(-50%,-50%) scale(.3);opacity:.7}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}' +
      '.__tap{position:fixed;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid rgba(30,30,30,.35);pointer-events:none;z-index:2147483646;animation:__tap .45s ease-out forwards}';
    document.head.appendChild(style);
    addEventListener('pointermove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('pointerdown', (e) => {
      const t = document.createElement('div');
      t.className = '__tap'; t.style.left = e.clientX + 'px'; t.style.top = e.clientY + 'px';
      document.body.appendChild(t); setTimeout(() => t.remove(), 500);
    }, true);
  });
  try { localStorage.setItem('el:mute', '1'); } catch {}
`;

async function center(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`not visible: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function glide(page, selector, steps = 18) {
  const p = await center(page, selector);
  await page.mouse.move(p.x, p.y, { steps });
  return p;
}
async function clickAt(page, selector, pause = 250) {
  await glide(page, selector);
  await sleep(pause);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
}
async function typeSlow(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(110);
  }
}
async function waitFor(fn, timeout = 30_000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${label}`);
}
// ---------- 클립 ----------

/** 브라우저 쪽 손패에서 카드의 DOM 순서 */
function handSel(me, card) {
  const i = me.g.hands[me.g.me].findIndex((c) => c.id === card.id);
  return `.hand > .move-card:nth-child(${i + 1})`;
}
async function myTurn(me) {
  await waitFor(() => me.myTurn, 60_000, 'my turn');
}
/** 브라우저 플레이어: 카드를 눌러 경로를 보여 준 뒤 한 번 더 눌러 실행 */
async function clickPlay(page, me, card, pause = 1100) {
  await clickAt(page, handSel(me, card));
  await sleep(pause);
  await clickAt(page, handSel(me, card), 150);
}
/** 브라우저 플레이어: 카드를 보드로 끌어다 놓기 */
async function dragPlay(page, me, card) {
  const from = await center(page, handSel(me, card));
  await page.mouse.move(from.x, from.y, { steps: 14 });
  await sleep(220);
  await page.mouse.down();
  const to = await center(page, '.board-frame');
  await page.mouse.move(from.x + (to.x - from.x) * 0.15, from.y - 30, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 26 });
  await sleep(350);
  await page.mouse.up();
}
/** 화면 밖에서 빠르게 진행(브라우저 플레이어 몫은 그림자 소켓이 둔다) */
async function fastForward(me, bots, until, heroRate = 0.05) {
  for (const b of bots) b.play({ delay: 40, heroRate });
  while (!(await until())) {
    if (me.g.status !== 'playing') throw new Error('round ended while fast-forwarding');
    if (me.myTurn) {
      const move = me.chooseMove(0);
      if (move) await me.call('move', { move });
    }
    await sleep(60);
  }
  for (const b of bots) b.stop();
  await waitFor(() => bots.every((b) => !b.busy), 5000, 'bots idle');
}

async function desktopFlow(browser, only) {
  const want = (n) => !only.length || only.includes(n);
  if (!['intro', 'lobby', 'play', 'knight', 'ending'].some(want)) return;
  const size = { width: 1280, height: 800 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, locale: 'ko-KR', colorScheme: 'dark' });
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = await ctx.newPage();
  const shot = { width: size.width * 2, height: size.height * 2 };
  const bots = [new Bot('도윤'), new Bot('서연')];

  // 0) 첫 화면: 왕관 시연 → 게임 방법 모달 훑기
  await page.goto(BASE);
  await page.mouse.move(640, 300);
  await sleep(400);
  if (want('intro')) {
    const intro = await recorder(page, 'intro', shot);
    await sleep(3500);
    await clickAt(page, 'button:has-text("게임 방법 자세히 보기")');
    await sleep(1400);
    for (const n of [2, 3, 4, 6]) {
      await clickAt(page, `.g-nav .chip:nth-child(${n})`, 150);
      await sleep(1900);
    }
    await page.keyboard.press('Escape');
    await sleep(900);
    await intro.stop();
  }

  // 1) 로비: 방 만들기 → QR → 친구 입장 → 규칙 프리셋
  let rec = want('lobby') ? await recorder(page, 'lobby', shot) : null;
  await sleep(500);
  await clickAt(page, 'input[placeholder="예: 민지"]');
  await typeSlow(page, '민지');
  await sleep(300);
  await clickAt(page, 'button.big-btn:has-text("방 만들기")');
  await page.waitForSelector('.code.big');
  const code = (await page.textContent('.code.big')).trim();
  await sleep(1200);
  await bots[0].join(code);
  await sleep(500);
  bots[0].s.emit('emote', { id: 'please' }, () => {});
  await sleep(900);
  await bots[1].join(code);
  await sleep(600);
  bots[1].s.emit('emote', { id: 'crown' }, () => {});
  await sleep(700);
  for (const p of ['폐허 지도', '4인 팀전', '3인 권장']) {
    await clickAt(page, `.presets .chip:has-text("${p}")`);
    await sleep(1300);
  }
  await glide(page, 'button:has-text("게임 시작")');
  await sleep(600);
  if (rec) await rec.stop();

  const token = await page.evaluate((c) => localStorage.getItem(`el:token:${c}`), code);
  const me = new Bot('민지');
  await me.join(code, { token });
  await waitFor(() => me.view, 5000, 'shadow view');

  // 2) 게임: 카드 선택(경로 미리보기) → 돌 놓기, 끌어다 놓기, 상대 차례·감정 표현
  rec = want('play') ? await recorder(page, 'play', shot) : null;
  await sleep(300);
  await clickAt(page, 'button:has-text("게임 시작")');
  await waitFor(() => me.g?.status === 'playing', 5000, 'game start');
  for (const b of bots) b.play({ delay: 1100, heroRate: 0, emoteRate: 0.4 });
  await sleep(1200);
  for (let turn = 0; turn < 3; turn++) {
    await myTurn(me);
    await sleep(turn === 0 ? 1600 : 1200);
    const place = me.plays('place');
    if (!place.length) break;
    const card = place[Math.floor(Math.random() * place.length)];
    if (turn === 1) await dragPlay(page, me, card);
    else await clickPlay(page, me, card);
    await waitFor(() => !me.myTurn, 5000, 'turn passed');
    if (turn === 0) {
      await sleep(500);
      await clickAt(page, '.deck-col .emote-toggle');
      await sleep(900);
      await clickAt(page, '.emote-phrases .chip:has-text("계획대로")');
    }
  }
  await sleep(2500);
  for (const b of bots) b.stop();
  if (rec) await rec.stop();

  // 3) 기사: 상대 돌을 뒤집을 수 있을 때까지 빠르게 진행 → 선택해 뒤집기
  if (want('knight') || want('ending')) {
    await fastForward(me, bots, () => me.myTurn && me.plays('hero').length > 0 && me.g.board.filter((v) => v >= 0).length >= 12);
    await page.mouse.move(640, 500, { steps: 5 });
    await sleep(1500);
    if (want('knight')) {
      rec = await recorder(page, 'knight', shot);
      await sleep(800);
      const hero = me.plays('hero')[0];
      await glide(page, handSel(me, hero), 22);
      await sleep(500);
      await clickAt(page, handSel(me, hero), 100);
      await sleep(1800);
      await clickAt(page, '.actions .btn.primary', 200);
      await sleep(2600);
      await rec.stop();
    }
  }

  // 4) 끝: 남은 돌 경고 → 마지막 수 → 결과표
  if (want('ending')) {
    await fastForward(me, bots, () => me.g.supply <= me.g.players * 2 + 1 && me.myTurn);
    rec = await recorder(page, 'ending', shot);
    for (const b of bots) b.play({ delay: 700, heroRate: 0.1 });
    while (me.g.status === 'playing') {
      if (me.myTurn) {
        await sleep(700);
        const place = me.plays('place');
        if (place.length) await clickPlay(page, me, place[0], 600);
        else await clickAt(page, '.actions .btn');
        await waitFor(() => !me.myTurn || me.g.status !== 'playing', 5000, 'moved');
      }
      await sleep(80);
    }
    await page.waitForSelector('.overlay .scores');
    await sleep(1500);
    await glide(page, '.overlay .scores', 30);
    await sleep(3000);
    await rec.stop();
  }

  for (const b of [...bots, me]) b.close();
  await ctx.close();
}

async function mobileFlow(browser, only) {
  if (only.length && !only.includes('mobile')) return;
  const size = { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', colorScheme: 'light' });
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = await ctx.newPage();

  // 방장은 봇, 브라우저는 QR 링크로 들어오는 친구
  const host = new Bot('지호');
  await host.create();
  await host.call('config', { config: { boardSize: 7, stones: 30, heroes: 2, handLimit: 4, maxDistance: 2, cardCopies: 2 } });
  const code = host.code;

  const rec = await recorder(page, 'mobile', { width: size.width * 2, height: size.height * 2 });
  await page.goto(`${BASE}/r/${code}`);
  await sleep(900);
  await page.tap('.field input');
  await typeSlow(page, '하린');
  await sleep(300);
  await page.tap('button.primary:has-text("입장")');
  await page.waitForSelector('.code.big');
  const token = await page.evaluate((c) => localStorage.getItem(`el:token:${c}`), code);
  const me = new Bot('하린');
  await me.join(code, { token });
  await sleep(1500);
  host.s.emit('emote', { id: 'please' }, () => {});
  await sleep(1300);
  await host.call('start');
  host.play({ delay: 1300, heroRate: 0, emoteRate: 0.6, emotes: ['teabag', 'meh', 'think'] });
  for (let turn = 0; turn < 3; turn++) {
    await myTurn(me);
    await sleep(1300);
    const place = me.plays('place');
    if (!place.length) break;
    await page.tap(handSel(me, place[0]));
    await sleep(1000);
    await page.tap('.actions .btn.primary');
    await waitFor(() => !me.myTurn, 5000, 'turn passed');
  }
  await sleep(2600);
  host.stop();
  await rec.stop();
  for (const b of [host, me]) b.close();
  await ctx.close();
}

// ---------- 실행 ----------

const only = process.argv.slice(2);
mkdirSync(join(OUT, 'clips'), { recursive: true });
mkdirSync(join(OUT, 'gif'), { recursive: true });
const server = await startServer();
const browser = await chromium.launch({ executablePath: findChromium() });
try {
  await desktopFlow(browser, only);
  await mobileFlow(browser, only);
} finally {
  await browser.close();
  server.kill();
}

console.log('GIF 변환…');
// [너비, fps, 앞에서 건너뛸 초] — README에서 GitHub가 그려 주도록 파일마다 약 8MB 이하로
const gifs = { intro: [960, 12], lobby: [960, 12], play: [880, 10], knight: [960, 15], ending: [880, 10], mobile: [390, 12] };
await Promise.all(
  Object.entries(gifs)
    .filter(([n]) => (!only.length || only.includes(n)) && existsSync(join(OUT, 'clips', `${n}.mp4`)))
    .map(([n, [w, fps, skip = 0]]) => gif(n, w, fps, skip)),
);
if (!only.length) await reel();
// 게임 방법 모달(apps/web/public/guide)에 쓰는 가벼운 영상: 녹화 클립 이름 → 모달 파일 이름
const GUIDE = join(ROOT, 'apps/web/public/guide');
mkdirSync(GUIDE, { recursive: true });
for (const [n, out] of Object.entries({ lobby: 'lobby', play: 'move', knight: 'knight', ending: 'end' })) {
  const src = join(OUT, 'clips', `${n}.mp4`);
  if (!existsSync(src) || (only.length && !only.includes(n))) continue;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=960:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(GUIDE, `${out}.mp4`)]);
}
writeFileSync(join(OUT, 'README.txt'), '`npm run build && npm run media`로 생성됩니다. 손으로 편집하지 마세요.\n');
console.log('done');
process.exit(0);
