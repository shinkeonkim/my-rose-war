/**
 * 무중단 배포용 방 상태 넘겨받기 (my-lost-city와 같은 방식).
 *
 * 롤링 업데이트(maxSurge 1, maxUnavailable 0):
 *   1. 새 파드는 시작하자마자 HANDOFF_PEER(Ready 파드만 가리키는 내부 Service = 이전 파드)에 POST /handoff
 *   2. 이전 파드는 모든 방을 JSON으로 돌려주고 즉시 draining(Ready 내림, 상태 변경 요청 거절, 타이머 정지)
 *   3. 새 파드는 방을 등록한 뒤에야 /readyz 가 200 → 서비스가 새 파드로 넘어감 → 이전 파드에 SIGTERM
 *   4. 이전 파드는 전송 계층을 닫음 → 브라우저 자동 재연결 → 토큰으로 같은 방에 재입장
 * 이전 파드가 없으면(첫 배포·재시작) 5초 뒤 빈 상태로 시작한다.
 * 내부 포트는 Ingress·터널에 연결되지 않고, NetworkPolicy로 같은 네임스페이스 파드끼리만 허용한다.
 */
import { createServer } from 'node:http';

export async function pullFromPeer<T>(peer: string, secret: string): Promise<T | null> {
  try {
    const r = await fetch(`${peer.replace(/\/$/, '')}/handoff`, {
      method: 'POST',
      headers: secret ? { 'x-handoff-secret': secret } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    console.log(`handoff: 넘겨받을 이전 파드 없음 (${e instanceof Error ? e.message : e})`);
    return null;
  }
}

export function serveHandoff(port: number, secret: string, give: () => unknown) {
  createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/handoff') return void res.writeHead(404).end();
    if (secret && req.headers['x-handoff-secret'] !== secret) return void res.writeHead(403).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(give()));
  }).listen(port, () => console.log(`handoff listening on :${port}`));
}
