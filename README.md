# Crown March · 왕관 행진

모두가 함께 움직이는 왕관을 이동 카드로 옮기며 내 돌로 영토를 넓히는 2~4인 온라인 땅따먹기.
각자 휴대폰/PC로 QR·링크를 열어 바로 참가한다.
규칙 메커니즘은 고전 2인 추상 전략 게임(조사: `docs/01-원작-룰-조사.md`)을 바탕으로 하되, 이름·문장·일러스트·외형은 자체 제작이다.

## 기능

- 방 만들기 → 4자리 코드 + QR/공유 링크, 선택적 방 암호(QR에 암호 포함 토글), 방 최대 5개(`MAX_ROOMS`)
- 2~4인 + 관전, 끊겨도 같은 기기에서 다시 열면 자동 복귀, 방장 자동 승계, 방장 "방 닫기", 각자 "로비로 돌아가기"
- 모두 나간 뒤 1시간 유휴면 방 자동 해제(`ROOM_IDLE_MINUTES`)
- 규칙 커스텀: 보드 5×5~13×13, 공용 돌 개수, 막힌 칸(대칭 무작위), 이동 거리 1~4, 대각선 카드 on/off, 카드 벌 수,
  손패 상한, 기사 카드 수, 손패 공개/비공개, 점수(칸 수² / 칸 수), 대각선 영역 연결, 판 수, 턴 타이머, 4인 2:2 팀전
- 프리셋: 원작(2인) / 3인 권장 / 4인 권장 / 4인 팀전 / 빠른 게임 / 폐허 지도
- 차례 배너·턴 전환 스플래시·알림음·진동, 갈 수 있는 칸 표시, 카드 미리보기 경로, 왕관 이동·돌 놓기·기사 뒤집기 애니메이션,
  실시간 점수와 "영역" 보기, 감정 표현, 끊긴 플레이어 대신 진행

## 개발

```bash
npm install
npm run dev        # 서버 :3001 + Vite :5173 (휴대폰은 같은 Wi-Fi에서 로비의 QR로 접속)
npm test           # 엔진(+퍼즈)·방 로직 테스트
npm run build && npm start   # 프로덕션 빌드 → :3001 (PORT로 변경)
```

구조: `packages/engine`(순수 게임 로직), `apps/server`(Node + Socket.IO, 권위 서버, 방 상태는 메모리),
`apps/web`(React + Vite).

## 배포 (oh-my-homelab)

- `main` push → `.github/workflows/release.yml`이 `ghcr.io/shinkeonkim/my-rose-war:sha-xxxx` 빌드 후 `deploy/kustomization.yaml` 태그 갱신
- oh-my-homelab의 `helm-charts/apps/my-rose-war.yaml`이 `deploy/`를 ArgoCD로 동기화
- 방 상태가 메모리에 있으므로 replicas 1 + Recreate. 재배포하면 진행 중인 게임은 사라진다.
- 환경변수 `PUBLIC_URL`: QR/공유 링크에 쓰는 외부 주소 (Cloudflare Tunnel `my-rose-war.shinkeonkim.com`)
