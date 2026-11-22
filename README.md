# Crown March · 왕관 행진

> **보관됨** — 이 저장소는 더 이상 갱신하지 않습니다. 게임은 [shinkeonkim/boardgame](https://github.com/shinkeonkim/boardgame)의 `games/crown-march`로 옮겨졌고, 지금은 https://boardgame.shinkeonkim.com/games/crown-march 에서 플레이할 수 있어요.


모두가 함께 움직이는 왕관을 이동 카드로 옮기며 내 돌로 영토를 넓히는 2~4인 온라인 땅따먹기.
각자 휴대폰/PC로 QR·링크를 열어 바로 참가한다.
규칙 메커니즘은 고전 2인 추상 전략 게임(조사: `docs/01-원작-룰-조사.md`)을 바탕으로 하되, 이름·문장·일러스트·외형은 자체 제작이다.

<p align="center"><img src="docs/media/cover.png" alt="Crown March 게임 화면" width="820"></p>

**바로 플레이:** https://my-rose-war.shinkeonkim.com · 전체 데모 영상: [`docs/media/crown-march-demo.mp4`](docs/media/crown-march-demo.mp4)

## 미리보기

### 첫 화면과 게임 방법

왕관이 움직이며 돌을 놓는 시연이 돌아가고, "게임 방법"을 열면 목표·구성·차례·기사·점수를 그림과 영상으로 설명한다 (로비·게임 중에도 열 수 있음).

<img src="docs/media/gif/intro.gif" alt="첫 화면 시연과 게임 방법 모달" width="720">

### 방 만들기 → QR로 초대 → 규칙 고르기

방을 만들면 4자리 코드와 QR이 생기고, 친구가 들어오면 바로 목록에 뜬다. 프리셋으로 보드 크기·막힌 칸·팀전을 바꾸면 미리보기가 따라 바뀐다.

<img src="docs/media/gif/lobby.gif" alt="로비: 방 만들기, 친구 입장, 규칙 프리셋 변경" width="720">

### 카드로 왕관 옮기기

카드를 누르면 왕관에서 목적지까지 경로가 보이고, 한 번 더 누르면 왕관이 이동해 돌을 놓는다. 카드를 보드로 끌어다 놓아도 된다.

<img src="docs/media/gif/play.gif" alt="게임: 카드 선택으로 경로 미리보기, 돌 놓기, 끌어다 놓기, 감정 표현" width="720">

### 기사로 상대 돌 뒤집기

상대 돌로 가는 카드에는 방패 표시가 붙고, 기사 1장을 써서 그 돌을 내 색으로 뒤집는다.

<img src="docs/media/gif/knight.gif" alt="기사 카드로 상대 돌을 뒤집는 장면" width="720">

### 남은 돌 경고와 결과

공용 돌이 얼마 안 남으면 패널 위쪽에 경고가 뜨고, 판이 끝나면 영역별 점수(예: 5² + 3² + …)가 정리된다.

<img src="docs/media/gif/ending.gif" alt="남은 돌 경고, 마지막 수, 결과표" width="720">

### 휴대폰

QR이나 링크로 열고 닉네임만 넣으면 입장한다. 보드 바로 아래에 내 카드가 있고, 정보 패널은 따로 스크롤된다.

<img src="docs/media/gif/mobile.gif" alt="휴대폰 화면에서 링크로 입장해 몇 차례 진행" width="300">

> 영상과 GIF는 `npm run build && npm run media`로 실제 앱을 봇과 함께 돌려 녹화한 것이다 (`scripts/media/record.mjs`, 2배 픽셀). 게임 방법 모달의 영상(`apps/web/public/guide/`)도 같이 만들어진다.


## 기능

- 방 만들기 → 4자리 코드 + QR/공유 링크, 선택적 방 암호(QR에 암호 포함 토글), 방 최대 5개(`MAX_ROOMS`)
- 2~4인 + 관전, 끊겨도 같은 기기에서 다시 열면 자동 복귀, 방장 자동 승계, 방장 "방 닫기", 각자 "로비로 돌아가기"
- 방장이 게임 중지 → 로비에서 규칙을 바꾼 뒤 이어서 하기 (my-lost-city와 공통)
- 무중단 배포: 롤링 업데이트 때 새 파드가 이전 파드에게서 방 상태를 받아 와 진행 중인 게임이 이어진다
- 모두 나간 뒤 1시간 유휴면 방 자동 해제(`ROOM_IDLE_MINUTES`)
- 규칙 커스텀: 보드 5×5~13×13, 공용 돌 개수, 막힌 칸(대칭 무작위), 이동 거리 1~4, 대각선 카드 on/off, 카드 벌 수,
  손패 상한, 기사 카드 수, 손패 공개/비공개, 점수(칸 수² / 칸 수), 대각선 영역 연결, 판 수, 턴 타이머, 4인 2:2 팀전
- 프리셋: 원작(2인) / 3인 권장 / 4인 권장 / 4인 팀전 / 빠른 게임 / 폐허 지도
- 차례 배너·턴 전환 스플래시·알림음·진동, 갈 수 있는 칸 표시, 카드 미리보기 경로, 왕관 이동·돌 놓기·기사 뒤집기 애니메이션,
  실시간 점수와 "영역" 보기, 카드 끌어다 놓기, 감정 표현(🍵 티배깅 등 약올리기 포함), 끊긴 플레이어 대신 진행
- 게임 방법 모달(9개 섹션, 그림·영상), 기기 화면에 고정되는 반응형 레이아웃

## 개발

```bash
npm install
npm run dev        # 서버 :3001 + Vite :5173 (휴대폰은 같은 Wi-Fi에서 로비의 QR로 접속)
npm test           # 엔진(+퍼즈)·방 로직 테스트
npm run build && npm start   # 프로덕션 빌드 → :3001 (PORT로 변경)
npm run media      # README·게임 방법용 영상/GIF 다시 녹화 (빌드 후, ffmpeg + 크로미움 필요, PW_CHROMIUM=크롬 경로) → docs/media/
```

구조: `packages/engine`(순수 게임 로직), `apps/server`(Node + Socket.IO, 권위 서버, 방 상태는 메모리),
`apps/web`(React + Vite).

## 배포 (oh-my-homelab)

- `main` push → `.github/workflows/release.yml`이 `ghcr.io/shinkeonkim/my-rose-war:sha-xxxx` 빌드 후 `deploy/kustomization.yaml` 태그 갱신
- oh-my-homelab의 `helm-charts/apps/my-rose-war.yaml`이 `deploy/`를 ArgoCD로 동기화
- 방 상태가 메모리에 있으므로 replicas 1. 배포는 RollingUpdate: 새 파드가 `my-rose-war-handoff`(:9090)로 이전 파드의 방을 받아 온 뒤 Ready(`/readyz`), 이전 파드는 연결을 끊어 클라이언트가 새 파드로 자동 재접속 (`apps/server/src/handoff.ts`)
- 환경변수 `PUBLIC_URL`: QR/공유 링크에 쓰는 외부 주소 (Cloudflare Tunnel `my-rose-war.shinkeonkim.com`)
