# Drawing

문서와 무한 캔버스를 파일 하나에 담는, 로컬 전용 다이어그램 도구예요. 글을 쓰다가 `/` 로 다이어그램을 넣고, 코드로 그린 그림을 캔버스에서 자유롭게 손볼 수 있어요.

- 파일 하나에 문서와 캔버스가 함께 들어 있어요. (`*.dpx.json`)
- 다이어그램은 코드로 써요. 아키텍처, 플로우차트, 시퀀스, ERD를 지원해요.
- 캔버스에서는 도형, 화살표, 손그림을 자유롭게 그려요.
- SVG, PNG, Markdown으로 내보내요. 옵션은 PNG 크기, 투명 배경, 라이트/다크예요.
- 내 컴퓨터의 폴더 하나가 작업 공간이에요. 서버는 그 폴더 안에서만 읽고 써요.

![문서와 캔버스를 함께 보는 화면](docs/images/overview.png)

## 설치와 실행

필요한 것: Node.js 22.18 이상

```
npm install
npm run build
npm start -- <작업 폴더>
```

터미널에 나온 주소(기본 `http://127.0.0.1:4330/`)를 브라우저로 열어요. `<작업 폴더>` 는 미리 만들어 둔 폴더여야 해요.

| 설정 | 설명 |
|---|---|
| `<작업 폴더>` | 파일이 저장되는 폴더. 필수예요. |
| `DRAW_PORT` | 포트 번호. 생략하면 4330. 예: `DRAW_PORT=4340 npm start -- <작업 폴더>` |

- `npm run build` 를 건너뛰면 서버는 켜지지만 페이지 대신 "Web app not built" 메시지가 나와요.
- 포트가 이미 쓰이고 있으면 서버가 바로 종료되고 다른 포트를 고르라는 메시지를 보여 줘요.

## 쓰는 법

1. 왼쪽 사이드바의 `+` 로 파일을 만들어요. 폴더는 `새 폴더` 로 만들어요.
2. 문서에서 `/` 를 누르고 `새 다이어그램` 을 골라요. 같은 그림이 캔버스에도 생겨요.
3. 캔버스에서 다이어그램을 더블클릭하면 코드 편집기가 열려요. 코드를 고치면 그림이 바로 바뀌고, 문법 오류는 줄에 표시돼요.
4. 위쪽의 `문서` / `둘 다` / `캔버스` 로 보기를 바꿔요. 변경은 자동으로 저장돼요.
5. `내보내기` (Ctrl+E, Mac은 ⌘E) 에서 SVG, PNG, Markdown을 골라요.

더 자세한 기능은 아래 `기능별 사용법` 에 있어요.

![다이어그램 코드 편집기](docs/images/code-editor.png)

## 기능별 사용법

### 블록 안 노드 옮기기와 레이아웃 초기화

아키텍처와 플로우차트 블록은 자동 배치된 노드를 손으로 옮길 수 있어요. 다른 종류(시퀀스, ERD 등)는 아직 옮길 수 없어요.

1. 캔버스에서 블록 하나를 골라요.
2. 노드를 끌어 옮겨요. 바로 옮기기 모드가 켜져요. (`Ctrl/⌘+K` 의 `레이아웃 편집` 으로도 켜요.)
3. 끌 때 가까운 줄에 맞춰 붙어요. Alt를 누르고 끌면 맞춤이 꺼져요. 방향키는 1칸, Shift+방향키는 10칸씩 옮겨요.
4. Esc 또는 아래 안내 막대의 `완료` 로 끝내요. Enter를 누르면 코드 편집기가 열려요.
5. 옮긴 배치를 버리려면 안내 막대의 `레이아웃 초기화` 를 눌러요. 팔레트에도 있어요. 자동 배치로 돌아가요.

- 코드를 고쳐도 옮긴 위치는 가능한 만큼 남아요.
- 코드에 오류가 있거나, 잠그거나 돌려 둔 블록은 옮길 수 없어요. 이유는 안내 막대에 나와요.

### 캔버스에서 `/` 메뉴

캔버스에서 `/` 를 누르면 넣을 것을 골라요. 다이어그램(아키텍처, 플로우차트, 시퀀스, ERD, BPMN 예시), 사각형, 원, 마름모, 화살표, 선, 텍스트, 프레임이 있어요. 다이어그램은 종류별 예시 코드로 시작해요.

### 블록 속성

코드 편집기 위쪽에서 방향, 색 모드, 스타일, 글꼴, 글자 크기, 연결선을 목록으로 골라요. 고르면 코드에 `direction right` 같은 줄이 써지거나 바뀌어요. 종류에 맞는 항목만 보여요.

### 자동완성

코드 편집기에서 `[ ]` 안에 쓰면 속성 이름과 값을 추천해요. 입력하면 열리고, `Ctrl+Space` 로도 열어요. `icon` 값에는 같이 들어 있는 아이콘 이름이, `color` 에는 색 이름이 나와요. Esc로 닫아요.

### 손글씨 글꼴

`typeface rough` 로 손글씨 느낌의 글꼴을 써요. 블록 속성의 `글꼴` 에서 `손글씨` 를 골라도 돼요. 영문, 숫자, 기본 문장부호만 이 글꼴이고 한글은 시스템 글꼴로 보여요. `typeface mono` 는 고정폭이에요.

### 아이콘

`[icon: 이름]` 에 두 묶음의 이름을 써요. 일반 아이콘은 Lucide(`users`, `server` …), 기술 로고는 Simple Icons(`postgres`, `redis` …)예요. AWS, Google Cloud, Azure 공식 아이콘은 없어요. `aws-ec2` 같은 이름은 가장 가까운 Lucide 아이콘으로 그려요. 모르는 이름은 점선 상자예요.

### 내보내기 옵션

`내보내기` 메뉴에서 PNG 크기(1배, 2배, 3배), 투명 배경, 라이트/다크를 골라요. 고른 값은 캔버스 내보내기, 이미지 복사, 문서 안 다이어그램 내보내기에 같이 적용돼요. SVG와 PNG, 이미지 복사, Markdown을 지원하고 PDF는 없어요.

### 버전 기록

위쪽 `버전 기록` 에서 이전에 저장된 버전을 읽기 전용으로 미리 보고 `이 버전으로 되돌리기` 를 눌러요. 되돌리기 전의 내용도 기록에 남아요. 버전은 파일을 저장할 때 5분에 한 번 이내로 만들고, 파일마다 최근 50개까지 남아요. 작업 폴더의 숨김 폴더 `.drawing/` 에 저장돼요.

### 최근에 지운 파일

파일이나 폴더를 지우면 30일 동안 보관해요. 사이드바 아래 `최근에 지운 파일` 에서 `되살리기` 를 누르면 원래 자리로 돌아오고 버전 기록도 같이 와요. 같은 이름의 파일이 이미 있으면 되살리지 못해요.

### 사이드바에서 옮기기와 이름 바꾸기

- 파일이나 폴더를 끌어서 다른 폴더(또는 목록 빈 곳)에 놓으면 옮겨져요.
- 이름을 더블클릭하거나 선택하고 F2를 누르면 이름을 바꿔요.

### 문서 목차, 링크, 프레임

- `목차` 버튼은 제목 1~3 목록을 보여 주고, 누르면 그 제목으로 가요.
- 제목의 `#` 버튼은 그 제목으로 가는 링크를 복사해요.
- 문서에서 `+` 를 쓰면 파일, 제목, 다이어그램을 골라 연결해요. 연결을 누르면 그곳으로 가요. 파일 이름을 바꾸거나 옮기면 그 파일로 가는 연결은 끊겨요.
- 캔버스에 프레임을 만들고 문서에서 `/` 로 `프레임 넣기` 를 고르면 읽기 전용 미리보기가 들어가요. 누르면 캔버스의 그 프레임으로 가요. 프레임 이름을 바꾸면 따라 바뀌고, 지우면 "찾을 수 없어요"라고 보여요.

## 다이어그램 코드 치트시트

종류는 코드 모양을 보고 자동으로 정하고, 편집기 위쪽 목록에서 직접 고를 수도 있어요. 아래 예시는 모두 앱에서 그대로 읽혀요. (`test/dsl/fixtures/` 에 같은 코드가 있고 `npm test` 가 확인해요.)

공통 문법:

| 문법 | 뜻 |
|---|---|
| `Name [icon: aws-ec2, color: blue]` | 노드와 속성. 주요 속성은 `icon`, `color`, `label`, `shape` |
| `Web [icon: react, subtitle: React SPA]` | 부제(두 번째 줄). 우리 확장 속성이라 Eraser에는 없어요 |
| `API [badge: v2, badgeColor: red]` · `Phase 2 [shape: divider]` | 노드 우상단 배지(색 없으면 노드 색, 그다음 indigo) · 라벨로 끊기는 가로 구분선 |
| `nodeStyle icon` | 아키텍처의 아이콘 노드를 상자 카드 대신 큰 아이콘 + 아래 글자로 그려요. 기본은 `box` |
| `Group { ... }` | 그룹. 안에 그룹을 또 넣을 수 있어요 |
| `A > B`, `A < B`, `A <> B`, `A - B`, `A -- B`, `A --> B` | 연결. `A > B > C` 처럼 이어 쓸 수 있어요 |
| `A > B: 라벨 [color: red]` | 연결 라벨과 속성 |
| `title`, `direction right` | 제목, 방향 |
| `// 설명` | 주석 |

### 클라우드 아키텍처

```
title Web service
direction right

Users [icon: users]
VPC {
  Public Subnet {
    LB [icon: aws-elb]
    Web [icon: aws-ec2, color: blue]
  }
  Private Subnet {
    DB [icon: aws-rds]
    Queue [icon: aws-sqs]
  }
}

Users > LB: HTTPS
LB > Web
Web > DB: SQL [color: green]
Web > Queue
```

### 플로우차트

```
title Ticket workflow
direction right

Start [shape: oval, color: green]
Triage [icon: flag]
Valid? [shape: diamond]
Fix [color: blue]
Done [shape: oval]

Start > Triage > Valid?
Valid? > Fix: yes
Valid? > Done: no [color: red]
Fix > Done
```

### 시퀀스

```
title Login
autoNumber on
order Client, API, DB

Client [icon: monitor] > API [icon: server]: POST /login
activate API
API > DB [icon: database]: find user
DB > API: row
alt [label: valid] {
  API > Client: token
}
else [label: invalid] {
  API > Client: 401 [color: red]
}
deactivate API
```

### ERD

```
title Billing
notation crows-foot

users [icon: user, color: blue] {
  id string pk
  email string unique not null
  teamId string
}
teams [icon: users] {
  id string pk
  name string
}
products {
  id int pk
  format "enum(DVD, Blu-ray)"
  price decimal(10,2)
}

users.teamId > teams.id: [color: green]
```

## 단축키

Mac에서는 Ctrl 대신 ⌘ 을 써요. `Ctrl/⌘+K` 로 여는 명령 팔레트에서도 같은 동작을 찾을 수 있어요.

어디서나 쓰는 키 (내보내기와 복사는 파일을 연 상태에서, 글을 쓰는 중이 아닐 때):

| 키 | 동작 |
|---|---|
| Ctrl/⌘+K | 명령 팔레트 |
| Ctrl/⌘+E | 내보내기 메뉴 (창 너비 768px 이상) |
| Shift+Alt+C (Mac은 Shift+Option+C) | 캔버스를 이미지로 복사 |

사이드바와 문서:

| 키 | 동작 |
|---|---|
| F2 | 선택한 파일·폴더 이름 바꾸기 (사이드바) |
| `/` | 문서에서 넣을 것 고르기 |
| `+` | 문서에서 파일·제목·다이어그램 연결 |

캔버스에 포커스가 있을 때:

| 키 | 동작 |
|---|---|
| V / R / D / O | 선택 / 사각형 / 마름모 / 원 |
| A / L / P | 화살표 / 선 / 그리기 |
| T / E / H | 글자 / 지우개 / 손(화면 이동) |
| Ctrl/⌘+`+` / `-` / `0` | 확대 / 축소 / 100% |
| Shift+1 | 모두 보이게 맞추기 |
| Ctrl/⌘+Z / Ctrl/⌘+Shift+Z | 실행 취소 / 다시 실행 |
| Ctrl/⌘+D | 복제 |
| Ctrl/⌘+A | 전체 선택 |
| Delete | 삭제 |
| `/` | 넣을 것 고르기 (다이어그램, 도형, 프레임) |

레이아웃 편집 모드 (노드 옮기는 중):

| 키 | 동작 |
|---|---|
| 방향키 / Shift+방향키 | 고른 노드를 1칸 / 10칸 옮기기 |
| Ctrl/⌘+A | 노드 모두 고르기 |
| Enter | 코드 편집기 열기 |
| Esc | 옮기기 끝내기 (끄는 중이면 취소) |
| Alt + 끌기 | 맞춤 끄기 |

코드 편집기에서는 `Ctrl+Space` 로 자동완성을 열어요.

## 개발과 검사

| 명령 | 설명 |
|---|---|
| `npm test` | 서버, 파서, 렌더, 웹 로직 테스트 |
| `npm run build` | 웹 앱을 `public/` 에 빌드 |
| `npm run dev:web` | Vite 개발 서버 (`/api` 는 4330 포트 서버로 넘겨요) |

### 브라우저 e2e

기본으로는 건너뛰어요. Chromium(headless shell)과 `playwright-core` 가 있을 때만 `DRAW_E2E=1` 로 켜요. 테스트가 빈 포트와 임시 작업 폴더로 자기 서버를 직접 띄워요.

```
DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
```

작업 목록은 `docs/tickets.md`, 조사 자료는 `docs/research/eraser/` 에 있어요.

## 안전 원칙

- **127.0.0.1 전용이에요.** 같은 컴퓨터에서만 접속할 수 있어요.
- **밖으로 요청을 보내지 않아요.** 글꼴, 아이콘, 캔버스 자산은 모두 같이 들어 있어요.
- **작업 폴더 안에서만 써요.**

## 지원하지 않는 것

- 여러 사람이 동시에 편집하는 협업
- AI로 다이어그램 만들기
- PDF 내보내기 (SVG, PNG, Markdown만 돼요)
- AWS, Google Cloud, Azure 공식 아이콘 (비슷한 Lucide 아이콘으로 대신 그려요)
- 시퀀스, ERD 블록의 노드 옮기기 (아키텍처와 플로우차트만 돼요)
- 파일 이름을 바꾸거나 옮길 때 문서의 파일 연결을 따라 고치기
- BPMN 코드 파서 (예시 코드만 있고 그림은 그려지지 않아요)
- 원격 접속
- 인증과 사용자 구분

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
- 다이어그램의 손글씨 글꼴(`typeface rough`)로 Shantell Sans(OFL-1.1)를 써요. `@fontsource/shantell-sans` 5.3.0(원본 arrowtype/shantell-sans)에서 받아 영문·숫자·기본 문장부호의 보통 굵기만 골라 담았어요(약 25KB). 파일과 라이선스 전문은 `shared/render/fonts/`에 있고, 그림(SVG)에 글꼴이 같이 들어가서 밖으로 요청을 보내지 않아요. 한글은 시스템 글꼴로 보여요.
- 다이어그램의 기본 글꼴로 Pretendard(OFL-1.1, npm `pretendard` 1.3.9)에서 영문·숫자·기본 문장부호의 보통(400)·조금 굵게(600)만 골라 담았어요(각 약 12KB). Pretendard는 예약된 글꼴 이름이라 고른 글꼴은 `Drawing Sans`라는 이름으로 들어가요. 파일과 라이선스 전문은 `shared/render/fonts/`에 있고, 그림(SVG)에 글꼴이 같이 들어가서 캔버스·문서 미리보기·내보내기가 같은 글꼴로 보여요. 한글은 시스템 글꼴로 보여요.
- 다이어그램 아이콘은 npm 패키지에서 고른 것만 `shared/render/icon-data.ts`에 넣어요(`npm run icons`로 다시 만들어요). 전문은 `NOTICE.md`에 있어요.

  | 묶음 | 쓰는 곳 | 라이선스 |
  | --- | --- | --- |
  | Lucide (`lucide-static`) | 일반 아이콘 (`users`, `server`, `key` …), `aws-*`·`gcp-*`·`azure-*` 이름의 대체 아이콘 | ISC (Feather에서 온 일부는 MIT) |
  | Simple Icons (`simple-icons`) | 기술 로고 (`postgres`, `k8s`, `redis` …) | CC0-1.0 (개별 라이선스가 따로 붙은 로고는 넣지 않아요) |

  로고는 각 회사의 상표예요. AWS·Google Cloud·Azure 공식 아이콘은 넣지 않았어요. 모르는 이름은 점선 상자로 그려요.
