# Drawing

문서와 무한 캔버스를 파일 하나에 담는, 로컬 전용 다이어그램 도구예요. Eraser 처럼 쓰고 Eraser 처럼 보이는 것이 목표예요. 지금은 빈 화면(사이드바, 상단 바, 캔버스 영역)만 있고, 기능은 `docs/tickets.md` 순서대로 채워 가요.

## 시작하기

필요한 것: Node.js 22 이상

1. 저장소를 받고 의존성을 설치해서 빌드해요.
   ```
   npm install
   npm run build
   ```
2. 작업 폴더를 지정해서 서버를 켜요.
   ```
   npm start -- <workspace-dir>
   ```
3. 터미널에 나온 주소를 브라우저로 열어요. 기본 주소는 `http://127.0.0.1:4330/` 예요.

`npm run build` 를 건너뛰면 서버는 켜지지만 페이지 대신 "Web app not built" 메시지가 나와요.

## 실행 옵션

| 설정 | 설명 |
|---|---|
| `<workspace-dir>` | 작업 폴더. 필수예요. |
| `DRAW_PORT` | 포트 번호. 생략하면 4330 을 써요. 예: `DRAW_PORT=4340 npm start -- <workspace-dir>` |

포트가 이미 쓰이고 있으면 서버가 바로 종료되고, 다른 포트를 고르라는 메시지를 보여 줘요.

## 안전 원칙

- **127.0.0.1 전용이에요.** 같은 컴퓨터에서만 접속할 수 있어요. 다른 기기에서는 열리지 않아요.
- **밖으로 요청을 보내지 않아요.** 글꼴, 아이콘, 캔버스 자산은 모두 같이 들어 있어요.
- **작업 폴더 안에서만 써요.**
- **인증과 원격 접속은 없어요.** 지금 범위 밖이에요.

## 개발

| 명령 | 설명 |
|---|---|
| `npm test` | 서버 테스트 |
| `npm run build` | 웹 앱을 `public/` 에 빌드 |
| `npm run dev:web` | Vite 개발 서버 (`/api` 는 4330 포트 서버로 넘겨요) |

작업 목록은 `docs/tickets.md`, 조사 자료는 `docs/research/eraser/` 에 있어요. 예전 draw.io 라이브 뷰어는 없앴고, git 기록에 남아 있어요.

## 라이선스

- 레이아웃에 `elkjs`(EPL-2.0)를 써요. 소스는 `node_modules/elkjs`에 그대로 있고 수정하지 않았어요.
- 캔버스에 `@excalidraw/excalidraw`(MIT, `package.json` 표기)를 써요.
- Excalidraw 패키지에 든 글꼴을 `public/excalidraw/fonts/`로 함께 묶어요. 패키지에 글꼴 라이선스 파일이 없어서, 아래는 각 글꼴의 upstream 저장소 기준이에요.
  - Assistant: OFL-1.1
  - Cascadia Code: OFL-1.1
  - Comic Shanns: MIT
  - Excalifont: OFL-1.1
  - Liberation Sans: OFL-1.1
  - Lilita One: OFL-1.1
  - Nunito: OFL-1.1
  - Virgil: OFL-1.1
  - Xiaolai (LXGW 기반): OFL-1.1
