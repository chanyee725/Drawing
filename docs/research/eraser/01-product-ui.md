# Eraser.io 리서치 01 — 제품 모델과 에디터 UI

조사 범위: 공개 자료만 (docs.eraser.io, eraser.io). 로그인·가입 없음. 조사일 2026-11-12.
표기: 근거 URL은 문장 끝에 인라인. **(미확인)** = 공개 자료에서 못 찾음. **(추정)** = 내 추론.

## 1. 제품 모델

### 1.1 한 줄 정의
- Eraser는 AI 다이어그램 도구예요. 다이어그램은 같은 파일 안의 markdown 문서 옆에 놓이고, 모든 다이어그램은 텍스트(diagram-as-code)로도 저장돼요. 편집 방식은 채팅(AI)과 비주얼 에디터 두 가지예요. <https://docs.eraser.io/what-is-eraser.md>
- 다이어그램 종류: architecture, sequence, flow chart, ERD, BPMN (DSL 기반) + Freeform(자유 배치). <https://docs.eraser.io/what-is-eraser.md>, <https://docs.eraser.io/freeform-diagrams.md>

### 1.2 File = 무한 캔버스 1개 + 노트(문서) 에디터 1개
- "A file consists of a single infinite canvas and a note editor." <https://www.eraser.io/pricing>
- 캔버스 쪽이 diagram, 노트 쪽이 document. Export 때도 "canvas (diagrams)"와 "document (notes)"로 나눠 다뤄요. <https://docs.eraser.io/export.md>
- 문서와 캔버스는 **figure embed**로 연결돼요 (3.3, 4.2 참고).
- 한 파일에 여러 diagram이 들어가요. API에도 "파일 안 diagram 목록/생성/수정/삭제"가 있어요. <https://docs.eraser.io/> (REST API › Files)

### 1.3 Team(워크스페이스)
- 모든 user와 file은 team에 속해요 (1인 team 포함). 한 user가 여러 team에 속할 수 있어요. <https://docs.eraser.io/teams.md>
- 생성: 가입 시, 또는 대시보드를 처음 열 때. 설정 항목은 team 이름, 멤버 초대, 이메일 도메인 자동 가입. <https://docs.eraser.io/teams.md>
- 전환: 대시보드의 team switcher 드롭다운 → "Join or Create team". <https://docs.eraser.io/teams.md>
- 역할: 문서에는 member와 team admin만 나와요. admin 전용: team 설정 변경, team 삭제. <https://docs.eraser.io/teams.md> 관리 문서는 admin / member / guest 3종을 말해요. admin 전용: member 승급·강등, member 제거, 도메인 자동 가입·가입 링크 활성화, 유료 플랜 변경, team 이름 변경. guest는 파일 단위로 읽기·쓰기·댓글이 되고 모든 플랜에서 무료·무제한이에요. <https://docs.eraser.io/managing-users.md> (admin 전용 목록은 teams.md와 managing-users.md가 조금 달라요. 더 자세한 role은 여전히 **(미확인)**.)
- 관리 기능: Allowed email domain, SAML SSO, Organizations, SCIM 문서가 따로 있어요. <https://docs.eraser.io/>

### 1.4 Folder
- 사이드바 "Folders" 옆 "+"로 생성. 파일을 사이드바 폴더에 드래그하거나 파일 3점 메뉴 "Move File"로 이동. <https://docs.eraser.io/folders.md>
- 중첩은 2단계까지. 모든 team member가 모든 folder를 볼 수 있어요. private file은 folder에 못 넣어요. <https://docs.eraser.io/folders.md>
- 폴더 삭제 = 안의 파일을 archive (영구 삭제 아님). <https://docs.eraser.io/folders.md>

### 1.5 Sharing / 권한
- 파일 타입 2종 (creator만 변경 가능, Share File 메뉴): <https://docs.eraser.io/sharing-a-file.md>
  - **Team file** (기본): team 전원 접근. 전 플랜. folder 가능. link 접근 설정 가능.
  - **Private file**: creator + 초대된 협업자만. 유료 플랜. folder 불가. link 접근 없음. <https://docs.eraser.io/private-files.md> 에서는 초대(이메일) 또는 public web link로 공유 가능하다고 해요. 재확인(2026-11-12): sharing-a-file은 4가지 link access *설정*(No link / edit / viewable / editable)이 private file에는 없다고 하고, private-files는 별도의 **Share to Web** 토글로 public link 공유가 가능하다고 해요(team 구성원 대시보드에는 안 보임). 즉 두 문서는 서로 다른 장치를 말하는 것으로 보여요. 두 장치의 관계는 공식 문서에 명시가 없어서 **(미확인)**으로 남겨요.
- Link access (team file): <https://docs.eraser.io/sharing-a-file.md>
  - No link access (유료) / Anyone with the link can edit — Eraser 계정 필요 (기본값) / Publicly viewable — 계정 불필요 / Publicly editable — 계정 불필요, 유료.
  - 유료 team은 Team Settings › Link Access for New Files로 신규 파일 기본값 지정.
- 재확인(2026-11-12): 가격 페이지를 직접 받아 보니 Compare plans 표에서 Publicly editable files가 Free 열에도 "Included"로 나오고, docs는 "Paid plan only"라서 여전히 충돌해요. 오래된 캐시 탓이라는 추정은 틀렸어요(현재 페이지가 그래요). 어느 쪽이 맞는지는 **(미확인)**. <https://www.eraser.io/pricing>, <https://docs.eraser.io/sharing-a-file.md>
- 게스트: 초대된 파일에서만 편집·댓글 가능. member는 team file 전체 편집 가능. 게스트 무제한. <https://www.eraser.io/pricing>
- Dashboard에 Private Files 섹션이 따로 있어요. <https://docs.eraser.io/private-files.md>

### 1.6 Template
- Template = 일반 Eraser file. diagram, document(SOP 등), 또는 둘 다. AI 생성 시 scaffold로 써서 구조·섹션을 유지해요. <https://docs.eraser.io/templates.md>
- preset의 Templates 탭에서 관리. team admin이 추가/제거. **publish해야** AI가 써요 (Never published / Pending review / Published). <https://docs.eraser.io/templates.md>
- 사용자용 템플릿 갤러리(시작 화면)의 UI는 공개 docs에 없어요 → 여전히 **(미확인)**. docs의 Templates는 AI preset의 Templates 탭(파일 이름·마지막 publish한 사람·시각·publish 상태 Never published/Pending review/Published)과 Publish 단계를 설명하는 개념이에요. <https://docs.eraser.io/templates.md>

### 1.7 플랜 (참고)
- Free: 파일 3개, 버전 기록 7일. Business/Business Plus: 파일 무제한, private file. <https://docs.eraser.io/plans.md>
- 가격 표의 Business 이상 version history는 "Unlimited" <https://www.eraser.io/pricing>, version-history 문서는 유료 90일 <https://docs.eraser.io/version-history.md>. 둘이 달라요.

## 2. 에디터 레이아웃

공개 문서에서 확인된 UI 요소만 적어요. 픽셀 단위 레이아웃은 **(미확인)** — 스크린샷을 못 봤어요.

| 영역 | 확인된 내용 | 출처 |
|---|---|---|
| Dashboard | 사이드바(Folders, Private Files), team switcher, 파일 생성(`^ N`), Getting Started 페이지 | quickstart, folders, teams, personal-settings |
| 헤더 | 파일명 옆 3점 메뉴(version history), "…" 메뉴(Export), "Toggle comments" 버튼. 맵은 가운데 Edit/Present 토글 | version-history, export, comments, presenting-maps |
| 캔버스 | 무한 캔버스, 툴바, property bar (선택 요소 스타일, "…" 메뉴에 Copy/Paste As), diagram 툴바 ("…" › Export selection, Verify 버튼) | freeform-diagrams, export |
| 노트 에디터 | 하단 formatting bar ("+" 삽입, Typography, Copy Link), 우상단 목차 버튼 | headers, tables |
| 우측 사이드바 | version history에서 이전 버전 선택 | version-history |
| AI chat | 캔버스에서 diagram에 대해 채팅으로 수정 | freeform-diagrams |
| 코드 패널 | DSL 텍스트 편집 → 캔버스 실시간 갱신 | quickstart |

URL은 모두 `https://docs.eraser.io/<slug>.md` 형식이에요.

- 캔버스와 문서가 "나란히" 보이는지(split view)는 문서에 명시가 없어요. pricing FAQ는 "canvas + note editor"만 말해요. 레이아웃은 **(미확인)**.
- 드래그 편집(beta): 요소 선택 시 하단 배너가 활성화되고, 수동 레이아웃은 reset 전까지 유지돼요. 코드를 크게 고치면 자동 reset. <https://docs.eraser.io/draggable-edits-beta.md>

## 3. 캔버스

### 3.1 Insert menu (`/`)
- `/` 키로 열고, 입력으로 필터 (예: `ec2` → EC2 아이콘), Return으로 선택. <https://docs.eraser.io/insert-menu.md>
- 항목: Figure, Diagram-as-code, Shape(cylinder, diamond 등), Icon(아이콘·기술 로고·클라우드), Code Block, Image, Device Frame(와이어프레임). <https://docs.eraser.io/insert-menu.md>
- AI Diagram: `/` → Diagram as Code → AI Diagram, 또는 `⌘J`/`Ctrl+J`. <https://docs.eraser.io/quickstart.md>

### 3.2 Freeform 요소
- 요소 태그: `Shape`(rectangle, oval, diamond, cylinder, star 등), `Icon`(sm/md/lg/xl), `Textbox`(markdown), `Group`(`title`, 자식은 `containerId`), `Divider`(각도·곡선, `lineStyle`), `Relationship`(`from`/`to`, arrowhead, `connectorStyle`). <https://docs.eraser.io/freeform-diagram-format.md>
- 커넥터 routing: elbow / straight / arc. `lineStyle`: solid / dashed / dotted. <https://docs.eraser.io/freeform-diagram-format.md>
- 입력 경로: `/` → Freeform, AI chat, JSON/XML 붙여넣기, `.drawio`·`.eraserdiagram` 파일 드롭. <https://docs.eraser.io/freeform-diagrams.md>
- Freeform에서 DB table, legend, pool, lane은 렌더 안 돼요 (ERD/BPMN 사용). <https://docs.eraser.io/freeform-diagrams.md>
- Frame: Figure가 frame 역할 (3.3). "device frame"은 와이어프레임용. 일반 frame 요소는 insert menu 목록(Figure, Diagram-as-code, Shape, Icon, Code Block, Image, Device Frame)에 없고, Freeform 포맷에는 container인 `Group`(title 가능, `containerId`로 소속)이 있어요. <https://docs.eraser.io/insert-menu.md>, <https://docs.eraser.io/freeform-diagram-format.md>
- Sticky note: insert menu와 freeform 요소 목록(Shape, Icon, Textbox, Group, Divider, Relationship)에 없어요. 공개 docs 89쪽을 `sticky` 키워드로 검색해도 0건이라 docs 기준으로는 **없음에 가까움**이지만, 에디터에서 직접 본 건 아니라서 **(미확인)**으로 둬요.
- Image: PNG/JPEG/GIF/SVG 임베드. `.drawio`는 편집 가능 diagram으로 변환. 다른 Eraser 파일에서 복사한 요소도 붙여넣기 가능. <https://docs.eraser.io/import.md>
- Freehand(손그림) 도구: docs 89쪽 전체에서 `freehand` 0건, insert menu에도 없어요. 단 Freeform의 "freeform"은 자유 배치 뜻이지 손그림이 아니에요. 에디터 툴바는 못 봐서 **(미확인)** 유지.
- Grouping / snapping: Group 요소는 확인(위). 마우스로 묶는 법, snapping 동작은 docs에 없어요(`snap` 검색 0건) → **(미확인)**. 참고: diagram-as-code는 draggable edit(노드·group·arrow를 끌어 옮기고 크기 조절, 하단 배너의 Reset Layout, 코드를 크게 고치면 자동 리셋)이 있어요. <https://docs.eraser.io/draggable-edits-beta.md>

### 3.3 Figure
- 컨테이너로 캔버스를 구획해요. `F` 키 + 드래그로 빈 figure, 기존 요소 위로 드래그하거나 요소 선택 후 우클릭 "Create Figure". <https://docs.eraser.io/figures.md>
- 이름은 더블클릭으로 편집. 이름을 잡고 끌면 내용물이 같이 이동. 요소를 안팎으로 끌거나 figure 크기를 조절해 포함 여부를 바꿔요. <https://docs.eraser.io/figures.md>

### 3.4 단축키 (확인된 것만)
| 동작 | 키 | 출처 |
|---|---|---|
| 파일 생성 | `^ N` | quickstart |
| Insert menu | `/` | insert-menu |
| AI Diagram | `⌘J` / `Ctrl+J` | quickstart |
| Figure 도구 | `F` | figures |
| Export | `Ctrl/⌘ + E` | export |
| Comment 도구 | `C` | comments |
| 댓글 제출 | `Cmd/Ctrl + Return` | comments |
| 선택 요소/텍스트에 댓글 | `Cmd/Ctrl + Shift + M` | comments |
| 스레드 resolve / delete | `Opt/Alt + R` / `Opt/Alt + D` | comments |
| 댓글 토글 | `Ctrl/Alt + C` | comments |
| H1~H3 | `⌘⌥1` ~ / `Ctrl Alt 1` ~ | headers |
| 표 삽입 | `Cmd+Opt+T` / `Ctrl+Alt+T` | tables |
| 행/열 추가 | `Cmd+Shift++` / `Cmd+Shift+Opt++` | tables |

- 검색 요약이 선택(V 또는 1), 사각형(R 또는 2), 텍스트(T 또는 8), Space 드래그 이동을 전했어요. 원문 페이지(`help.eraser.io/keyboard-shortcuts-and-markdown-syntax`)는 2026-11-12에도 접속이 안 돼(curl 연결 실패) 직접 검증 못 했어요. 대신 docs.eraser.io에서 확인된 단축키: `/` insert menu, Cmd/Ctrl+Alt+1 heading, Cmd/Ctrl+Shift+E archive, Alt+R comment thread resolve, Maps의 Cmd/Ctrl+K·Ctrl 1–3. <https://docs.eraser.io/insert-menu.md>, <https://docs.eraser.io/headers.md>, <https://docs.eraser.io/deleting-files.md>, <https://docs.eraser.io/comments.md>, <https://docs.eraser.io/map-views.md> V/R/T/Space 등 도구 키는 여전히 **(미확인)**. 검색 결과 링크: <https://help.eraser.io/keyboard-shortcuts-and-markdown-syntax/>
- Command palette: 별도 팔레트는 못 찾았고, `/` insert menu가 그 역할이에요(추정).

### 3.5 줌/팬/프레젠테이션
- 줌·팬 단축키: docs 전체에서 zoom 단축키 언급이 없어요 → **(미확인)**. 다만 figure/wikilink를 누르면 캔버스가 해당 figure 위치로 pan 돼요. <https://docs.eraser.io/figure-embeds.md>, <https://docs.eraser.io/wikilink.md>
- Present mode: 문서는 **Maps** 기능만 설명해요. 헤더 가운데 Edit/Present 토글, Present는 편집 도구와 AI를 숨겨요. 보기 전용 접근자는 Present로 열려요. <https://docs.eraser.io/presenting-maps.md>, <https://docs.eraser.io/sharing-a-file.md> 일반 canvas 파일의 슬라이드형 프레젠테이션은 **(미확인)**.

## 4. 문서(노트) 에디터

### 4.1 서식
- Markdown 입력 지원 (`#` + space = H1). H1~H3, 단축키, 헤더별 고유 링크("Copy Link"), 자동 목차. <https://docs.eraser.io/headers.md>
- Table: 삽입, hover "+"로 행/열 추가, 우클릭 Row 메뉴. <https://docs.eraser.io/tables.md>
- 붙여넣기: 문서에서 markdown은 서식으로 변환, rich text/HTML은 서식 유지, WebP 포함 이미지 지원. <https://docs.eraser.io/import.md>
- Code Block은 insert menu에서 삽입 (캔버스 항목). 문서 안 code block 세부는 **(미확인)**.

### 4.2 diagram 임베드
- 캔버스에서 figure를 복사해 노트에 붙여넣으면 embed가 돼요. Expanded = 실시간 미리보기, Collapsed = 링크. 링크 클릭 시 캔버스가 해당 figure로 이동. <https://docs.eraser.io/figure-embeds.md>
- 링크 텍스트는 figure 아이콘 → embed modal에서 수정, 원래 이름으로 reset 가능. <https://docs.eraser.io/figure-embeds.md>
- `<Figure src="..." alt="..." video />` 형태가 문서에 보이지만 사용자용 문법인지는 불분명해요. <https://docs.eraser.io/figure-embeds.md>
- 노트 내용 마크다운 내보내기 시 embed 처리는 docs에 없어요 → **(미확인)**.

### 4.3 Wikilink / Mention
- Wikilink: 문서나 캔버스 텍스트에서 줄 시작/공백 뒤에 `+` 입력 → 파일·figure·header 검색. figure/header 검색은 현재 파일 안만. <https://docs.eraser.io/wikilink.md>
- Mention: 문서에서 `@이름` → 이메일 알림. 캔버스 mention은 예정(미지원). <https://docs.eraser.io/mentions.md>

## 5. 시각 스타일

- DSL 스타일 속성 6개 (전체 또는 노드/그룹 단위): <https://docs.eraser.io/styling.md>
  - `colorMode`: pastel(기본) / bold / outline
  - `styleMode`: shadow(기본) / plain / watercolor
  - `typeface`: **rough**(손글씨, 기본) / clean(sans serif) / mono
  - `textSize`: small(기본) / medium / large
  - `wrap`: on / off, `connectorStyle`: elbow(기본) / straight / arc
- 즉 기본 룩은 손글씨(sketchy)체 + 파스텔 + 그림자이고, plain/clean으로 깔끔한 룩으로 바꿀 수 있어요. typeface는 `rough`(손글씨 폰트) / `clean`(산세리프) / `mono`로 정의돼요. <https://docs.eraser.io/styling.md> 실제 폰트 파일 이름과 색 hex는 docs에 없어서 **(미확인)**.
- Custom styles: 요소별 기본값 공급. <https://docs.eraser.io/freeform-diagrams.md>
- Dark mode: 개인 설정(Appearance 페이지), 파일 설정이 아니에요. 협업자끼리 다른 모드로 볼 수 있어요. <https://docs.eraser.io/dark-mode.md> Export 시 PNG/SVG는 light/dark 선택. <https://docs.eraser.io/export.md>

## 6. 협업

### 6.1 실시간
- Free 포함 전 플랜에서 real-time collaboration 제공. <https://www.eraser.io/pricing>
- 공식 Miro 비교 페이지가 Miro를 "multiplayer board with cursors and comments"로 평가하지만, Eraser 자신의 cursor/presence UI는 어떤 자료에서도 확인 못 했어요. 라이브 커서·아바타·선택 표시는 2026-11-12 재조사(docs 89쪽 `cursor`/`presence` 검색 포함)에서도 근거가 없어 **(미확인)**. 벤더 작성 자료예요. <https://www.eraser.io/alternatives/miro>
- 동시 편집 충돌 해결 방식(CRDT/OT)은 재조사(docs 89쪽 + 홈페이지)에서도 언급이 없어 **(미확인)**.

### 6.2 Comments
- 캔버스 어디든, 또는 요소에 부착(요소와 함께 이동). 문서는 선택한 텍스트에. 스레드 단위, 3점 메뉴로 Resolve/Delete. 헤더 "Toggle comments"로 전체 숨김/표시. 로그인 필요. <https://docs.eraser.io/comments.md>
- 알림 방식은 comments 문서에 없어요 **(미확인)**. mention은 이메일 알림이에요(확인). <https://docs.eraser.io/mentions.md>

### 6.3 Version history
- 편집이 멈춘 뒤 30분에 자동 버전, 수동 "Save version". 파일명 옆 3점 메뉴에서 열고, 우측 사이드바에서 이전 버전 미리보기. <https://docs.eraser.io/version-history.md>
- Restore는 현재 상태를 새 버전으로 먼저 저장한 뒤 되돌려요. Duplicate는 이전 버전으로 새 파일 생성. <https://docs.eraser.io/version-history.md>
- 보존: Free 7일, 유료 90일(version-history 문서). 재확인(2026-11-12): 가격 페이지는 유료 "Unlimited version history"라서 여전히 불일치예요. <https://www.eraser.io/pricing>
- 버전 간 diff 표시: version-history 문서에 preview(오른쪽 사이드바)·Restore·Duplicate만 있고 diff 언급이 없어요 → **(미확인)**. 30분 비활동 뒤 자동 버전, 수동 Save version 가능. <https://docs.eraser.io/version-history.md>

## 7. 대표 사용 흐름

### 7.1 AI로 만들기 (quickstart 기준) <https://docs.eraser.io/quickstart.md>
1. 대시보드에서 파일 생성 (`^ N`), **Canvas** 선택.
2. `/` → Diagram as Code → AI Diagram (또는 `⌘J`). 시스템을 문장으로 설명 → **Generate**. 타입은 자동 선택, 직접 변경 가능.
3. 코드 텍스트를 직접 수정 → 캔버스가 입력과 함께 갱신. `[icon: ...]`로 아이콘 지정.
4. 필요 시 다시 프롬프트하거나 캔버스에서 드래그.
5. 기존 자료(이미지, Terraform, DB 스키마, Git repo)에서 시작 가능.

### 7.2 설계 문서 쓰기 (추정 조합, 재확인 불가: 에디터 실사용 순서는 공개 자료에 없음)
1. 파일 생성 → 노트 에디터에 markdown으로 본문 작성 (`#`, `⌘⌥1`).
2. 캔버스에서 `F`로 figure를 만들어 diagram을 묶음.
3. figure 복사 → 노트에 붙여넣어 live embed.
4. 목차·header 링크로 구조화, `@`로 리뷰어 호출, `C`로 댓글.
5. 공유: Share File에서 link access 설정, Export(`Ctrl/⌘+E`)로 PDF/Markdown/PNG.
(각 단계는 위 출처의 기능 조합이에요. 실제 UI 순서는 **(추정)**.)

### 7.3 팀 협업
1. team 생성/참가 → 폴더 구성 → 파일을 team file로 두고 필요하면 private으로 전환(유료).
2. 링크 공유, 게스트 초대.
3. 댓글 스레드로 리뷰 → resolve.
4. version history로 비교·복원.

## 8. 내 프로젝트(로컬 셀프호스트)용 시사점 (추정)
- 핵심 모델은 "파일 = 캔버스 + 문서" 1:N diagram이에요. 데이터 모델을 file → {canvas elements, note doc, diagrams[]}로 잡으면 맞아요.
- 개인정보/인증이 필요 없는 로컬 도구면 team·sharing·SSO는 범위 밖으로 둘 수 있어요.
- 차별 핵심: 텍스트(DSL) ↔ 캔버스 양방향 동기화, figure embed, `/` insert menu.
- 미확인 항목(커서 UI, 줌/팬 키, sticky, freehand, snapping)은 2026-11-12 재조사에서도 공개 docs 89쪽에 근거가 없어요(sticky·freehand는 docs에 아예 없어 "없음"에 가까워요). 필요하면 공개 데모/스크린샷 영상으로 보완해야 해요.

## 9. 출처 한계
- docs.eraser.io는 `.md` 원문으로 조회했고 WebFetch 요약을 거쳤어요(원문 대조는 안 함).
- help.eraser.io 접속 실패(재시도 후에도 동일). 가격 페이지는 2026-11-12에 직접 받았고 오래된 캐시가 아니었어요. 재확인은 curl로 원문을 /tmp에 저장해 grep으로 했어요.
- 독립 제3자 리뷰는 이번 범위에서 못 찾았어요. 위 서술은 전부 벤더 자료예요.
