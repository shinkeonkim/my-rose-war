/**
 * 무중단 배포용 방 상태 넘겨주기.
 *
 * 롤링 업데이트(maxSurge 1, maxUnavailable 0)에서 새 파드가 Ready가 된 뒤 이전 파드가 SIGTERM을 받으면:
 *   1. 이전 파드는 게임 조작을 잠그고(freeze) 모든 방을 스냅샷으로 만든다
 *   2. 헤드리스 서비스 DNS로 자기 자신이 아닌 파드를 찾아 내부 포트(HANDOFF_PORT)로 POST
 *   3. 새 파드가 방을 등록하면, 이전 파드는 클라이언트 연결을 끊는다(transport close)
 *   4. 브라우저는 자동 재연결 → 서비스는 이제 새 파드만 가리킴 → 토큰으로 같은 방에 재입장
 *
 * 내부 포트는 서비스(80)·Ingress·터널에 노출되지 않고, NetworkPolicy로 같은 네임스페이스 파드끼리만 허용한다.
 */
import { createServer, request } from 'node:http';
import { lookup } from 'node:dns/promises';

const MAX_BODY = 32 * 1024 * 1024;

export function startHandoffServer(port: number, onImport: (snapshot: unknown) => { imported: number; skipped: number }) {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/import') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const r = onImport(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        console.log(`[handoff] 방 ${r.imported}개 이어받음 (건너뜀 ${r.skipped})`);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, ...r }));
      } catch (e) {
        console.error('[handoff] 가져오기 실패', e);
        res.writeHead(400).end();
      }
    });
  });
  server.listen(port, () => console.log(`[handoff] 내부 포트 :${port}`));
  return server;
}

function post(host: string, port: number, body: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      { host, port, path: '/import', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end(body);
  });
}

/** 자기 자신(POD_IP)이 아닌 피어에게 스냅샷 전달. 최대 deadlineMs 동안 재시도 */
export async function sendToPeer(opts: { peersHost: string; port: number; selfIp: string | null; snapshot: unknown; deadlineMs: number }): Promise<string | null> {
  const body = JSON.stringify(opts.snapshot);
  const until = Date.now() + opts.deadlineMs;
  while (Date.now() < until) {
    let ips: string[] = [];
    try {
      ips = (await lookup(opts.peersHost, { all: true, family: 4 })).map((a) => a.address);
    } catch {
      /* DNS 아직 없음 */
    }
    for (const ip of ips) {
      if (ip === opts.selfIp) continue;
      if (await post(ip, opts.port, body, 5000)) return ip;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}
