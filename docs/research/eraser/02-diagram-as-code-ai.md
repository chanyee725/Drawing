# Eraser.io 조사 02 — Diagram-as-code와 AI

조사일: 2026-11-12. 공개 문서만 봤어요 (로그인·가입 없음).
표기: 출처 URL은 문장 옆에 달았어요. 확인 못 한 건 **(미확인)**, 추정은 **(추정)**.
주의: 문서 본문은 WebFetch의 요약 모델을 거쳐 읽었어요. 코드 예시는 문법 표를 바탕으로 직접 짠 거라 Eraser 렌더러에 넣어 검증하지는 않았어요 **(미확인: 실제 렌더 결과)**.

## 1. 한눈에 보기

- Eraser는 "Diagram as code"(DSL)와 "Freeform"(캔버스에 직접 그리기) 두 가지 방식을 나란히 둬요. https://docs.eraser.io/freeform-diagrams.md
- 코드로 쓰는 다이어그램은 5종이에요: Flow Chart, ERD, Cloud Architecture, Sequence, BPMN(Swimlane). https://docs.eraser.io/diagram-as-code.md
- 5종 모두 문법 골격이 같아요: `이름 [속성]`, `A > B: 라벨`, `{ }` 그룹, `title`, `direction`, `colorMode` 같은 전역 스타일, `legend`, `//` 주석.
- 레이아웃은 코드에서 자동으로 만들어져요. https://docs.eraser.io/freeform-diagrams.md
- 별도 문서 없는 "기타 종류"(UML 클래스, 간트 등)는 DSL 5종에 없어요. 자유 그리기(Freeform)로만 그려요. https://docs.eraser.io/freeform-diagrams.md ("Anything you can draw")

## 2. 공통 문법 (5종 공통)

출처: 각 문법 페이지 — https://docs.eraser.io/flow-chart-syntax.md , https://docs.eraser.io/architecture-diagram-syntax.md , https://docs.eraser.io/sequence-diagram-syntax.md , https://docs.eraser.io/erd-syntax.md , https://docs.eraser.io/bpmn-syntax.md

### 연결 기호
| 기호 | 뜻 |
|---|---|
| `>` | 왼→오 화살표 |
| `<` | 오→왼 화살표 |
| `<>` | 양방향 |
| `-` | 실선 |
| `--` | 점선 |
| `-->` | 점선 화살표 (`<--`, `<-->`도 있음) |

ERD만 의미가 달라요: `<` 1:N, `>` N:1, `-` 1:1, `<>` N:M. https://docs.eraser.io/erd-syntax.md

### 속성 `[ ]`
| 속성 | 값 | 적용 |
|---|---|---|
| `icon` | `aws-ec2`, `user`, `monitor` 등 아이콘 이름 | 노드·그룹·열·엔티티 |
| `color` | 이름(`blue`) 또는 hex(`#000000`) | 노드·그룹·연결선 |
| `label` | 문자열. 쉼표·콜론·괄호가 있으면 따옴표 | 노드·그룹. 이름은 유일해야 하고 라벨은 겹쳐도 돼요 |
| `link` | 따옴표 URL | 노드·그룹 |
| `colorMode` | `pastel`(기본) / `bold` / `outline` | 요소 또는 전역 |
| `styleMode` | `shadow`(기본) / `plain` / `watercolor` | 요소 또는 전역 |
| `typeface` | `rough`(기본) / `clean` / `mono` | 요소 또는 전역 |
| `textSize` | `small`(기본) / `medium` / `large` | 요소 또는 전역 |
| `wrap` | `on`(기본) / `off` | 플로우차트·아키텍처 |
| `connectorStyle` | `elbow` / `straight` / `arc` | 연결선 (플로우차트·아키텍처) |

- 연결선 속성은 반드시 `:` 뒤에 써요 (`A > B: [color: green]`). `:`가 없으면 대상 노드의 속성이 돼요. https://docs.eraser.io/architecture-diagram-syntax.md
- 전역 스타일(`colorMode bold` 등)은 그 줄 **이후에 정의된** 요소에 적용돼요. https://docs.eraser.io/flow-chart-syntax.md
- 예약어로 시작하거나 특수문자가 있는 이름은 `"..."`로 감싸요. 주석은 `//`.
- 아직 정의 안 한 이름을 연결에 쓰면 빈 노드가 자동 생성돼요. 그룹 안 노드는 연결보다 먼저 정의해야 해요. 안 그러면 중복 이름 오류가 나고 노드가 그룹 밖에 남아요. https://docs.eraser.io/architecture-diagram-syntax.md
- 범례: `legend [position: bottom-left] { [connection: -->, label: Async] [color: red, label: Error] }`. 스와치는 `connection`/`color`/`icon`/`shape`, 위치는 8가지(기본 `top-right`). 범례는 다이어그램 요소와 연결되지 않아요(그냥 표시용).

## 3. 종류별 문법과 예시

### 3.1 Flow Chart
- 노드 `shape`: `rectangle`(기본), `diamond`, `oval`, `cylinder`. 이 4개만 문서에 있어요. https://docs.eraser.io/flow-chart-syntax.md
- `direction`: `down`(기본) / `up` / `left` / `right`. 코드 어디에 써도 돼요.
- 그룹 `{ }` 중첩 가능. 분기 `A > B, C`, 체인 `A > B > C`(체인에는 라벨 불가).

```eraser
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

### 3.2 Entity Relationship Diagram (ERD)
- 엔티티 `이름 { 속성타입 메타 }`. 속성 형식은 `name type metadata`(타입은 선택, `pk`/`fk`/`unique not null`). 공백 있는 타입은 따옴표. https://docs.eraser.io/erd-syntax.md
- 관계는 `entity.attr > entity.attr` 또는 엔티티끼리 `users > teams`.
- 전역 `notation chen`(기본) / `crows-foot`.
- ERD 문서에는 `direction`이 없어요 (페이지에서 확인 못 함) **(미확인)**.

```eraser
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

### 3.3 Cloud Architecture
- 노드·그룹(중첩 가능, VPC→서브넷→서버 식). `direction`: `right`(기본) / `down` / `up` / `left`. 연결선 기본은 `elbow`. https://docs.eraser.io/architecture-diagram-syntax.md
- 아이콘은 General, Tech Logos, AWS, Google Cloud, Azure 묶음에서 이름으로 골라요. https://docs.eraser.io/erd-syntax.md (Icons 절). 커스텀 아이콘도 있어요 https://docs.eraser.io/custom-icons.md (세부 **미확인**).
- 라벨 줄바꿈: `wrap off` 후 `"web-01\n10.0.12.34"`.

```eraser
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

### 3.4 Sequence Diagram
- 열(column)이 처음 등장하면 자동 생성. 메시지 `A > B: text`. https://docs.eraser.io/sequence-diagram-syntax.md
- 열 속성: `icon`, `color`, `label`, `link` 등. 화살표 속성은 `color`만.
- 블록: `loop`, `alt`/`else`, `opt`, `par`/`and`, `break` (`type [label: ...] { }`).
- `activate X` / `deactivate X`, `order A, B`(열 순서), `autoNumber on|nested|off`.

```eraser
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

### 3.5 BPMN (Swimlane)
- 노드 `type`: `activity`(기본) / `event` / `gateway`. 최외곽 `{ }`가 pool, 중첩 `{ }`가 lane. https://docs.eraser.io/bpmn-syntax.md
- 연결은 pool/lane 블록 **밖**, 모든 정의 뒤에 써요. pool·lane에 거는 연결은 무시돼요.
- `direction right`(기본) / `down`(세로 레인). 전역 `layout compact`(기본) / `sequential`.

```eraser
title Order flow
direction right
layout sequential

Online store {
  Customer {
    Open website [type: activity]
    Place order [type: activity, icon: flag]
  }
  Warehouse {
    Approved? [type: gateway]
    Shipped [type: event]
  }
}

Open website > Place order: Browse
Place order > Approved?
Approved? > Shipped: yes [color: green]
```

## 4. 렌더링과 자동 레이아웃

- 코드 다이어그램은 "layout is handled automatically"예요. https://docs.eraser.io/diagram-as-code.md
- 레이아웃 알고리즘 이름(ELK/dagre 등), 간격 규칙, 연결선 교차 처리는 공개 문서에 없어요 **(미확인)**. 문서에 있는 조절 수단은 `direction`, `connectorStyle`, BPMN의 `layout`, 그룹 중첩뿐이에요.
- 기본 스타일이 손그림 느낌(`typeface rough`, `styleMode shadow`)이에요. 문법 페이지 기본값 표 참고.
- Drag-Drop Editing: 전체 코드 다이어그램을 선택한 뒤 노드·그룹·화살표를 끌어 옮기거나 크기를 바꿔요. 내용은 안 바뀌고 레이아웃만 바뀌어요. 코드를 "significant"하게 고치면 기본 엔진 레이아웃으로 자동 리셋돼요. `Reset Layout` 버튼도 있어요. "significant"의 기준, 수동 위치 저장 방식은 문서에 없어요 **(미확인)**. https://docs.eraser.io/draggable-edits-beta.md
- 앱 쪽 구현 힌트 **(추정)**: 수동 위치는 DSL과 별도 레이어(오버라이드 맵)로 두고, 코드 구조가 바뀌면 버리는 설계로 보여요.

## 5. 코드 다이어그램과 자유 캔버스의 공존

출처: https://docs.eraser.io/freeform-diagrams.md

| | Freeform | Diagram as code |
|---|---|---|
| 편집 | 캔버스 또는 AI | 코드 에디터 또는 AI |
| 레이아웃 | 놓은 자리 그대로 | 코드에서 자동 |
| 저장 형식 | JSON | Eraser DSL |
| 종류 | 무엇이든 | architecture, flow chart, ERD, sequence, BPMN |

- 한 캔버스(파일)에 여러 다이어그램이 들어가요: 파일 API가 "diagrams in a file"을 목록·생성·수정·삭제해요. https://docs.eraser.io/llms.txt 의 REST API 절. 코드 다이어그램과 freeform이 한 캔버스에 섞여 있는지는 문서에서 명시 확인 못 했어요 **(미확인)**.
- 변환은 한 방향이에요: 코드(architecture·flowchart) → freeform `Convert to freeform`(원본 유지). 반대(freeform → 코드)는 문서에 없어요 **(미확인)**.
- freeform은 DB 테이블·범례·pool·lane을 못 그려요. ERD·BPMN은 코드로만 가능해요.
- AI가 architecture·flowchart를 만들 때 기본 결과는 freeform이에요. 팀 설정의 diagram format이 `Code (DSL)`이면 DSL로 나와요. 나머지(sequence·ERD·BPMN)는 항상 코드예요. https://docs.eraser.io/ai-diagrams.md , https://docs.eraser.io/cloud-architecture-diagrams.md
- freeform JSON 형식 문서가 따로 있어요 https://docs.eraser.io/freeform-diagram-format.md (본문 **미확인**).
- freeform 가져오기: JSON/XML 붙여넣기, `.drawio`·`.eraserdiagram` 드롭. 내보내기: PNG, SVG, PDF, Visio, draw.io, PowerPoint. https://docs.eraser.io/freeform-diagrams.md

## 6. Eraser AI / DiagramGPT

### 입력
- 자연어 프롬프트 또는 코드 조각. 이미지·파일(`/` → Image/File 또는 드래그). https://docs.eraser.io/ai-diagrams.md
- 이미지: `.png`/`.jpeg`만, 프롬프트는 "Re-draw this diagram."을 권장. Lucidchart·Visio·draw.io 이전과 손그림 사진 용도. https://docs.eraser.io/image-import.md
- Git 저장소: 프롬프트를 주면 관련 파일을 스캔해 그려요. 비공개 저장소는 먼저 연결해야 하고, 공개는 연결 없이 돼요. 폴더·파일 경로를 쓰면 결과가 나아져요. https://docs.eraser.io/codebase-diagrams.md
- AI preset: Rules(항상 지킬 것) + Templates(시작 구조) + References(참고 자료). 팀 단위, 관리자만 편집. https://docs.eraser.io/ai-presets.md

### 출력
- 편집 가능한 다이어그램. 종류를 직접 고르거나 비우면 AI가 고르고, 선택지는 Sequence / ERD / Cloud Architecture / Flow Chart예요. https://docs.eraser.io/ai-diagrams.md
- BPMN은 UI 선택지에는 없지만 API `diagramType`에는 있어요. 값: `sequence-diagram`, `entity-relationship-diagram`, `cloud-architecture-diagram`, `flowchart-diagram`, `bpmn-diagram`, `freeform-diagram`. https://docs.eraser.io/reference/generate-diagram-from-prompt
- 문서(notes) 생성도 있어요 https://docs.eraser.io/description-generation.md (본문 **미확인**). 생성물 검증 기능 "Verify"도 있어요 https://docs.eraser.io/diagram-verification.md (본문 **미확인**).

### 프롬프트 수정 흐름
- UI: 캔버스에서 `/` 또는 `⌘/Ctrl+J` → AI Diagram → 프롬프트 → (종류 선택) → Generate. 이후 손으로 고치거나 후속 프롬프트로 고쳐요. 요소를 선택하고 AI 채팅에 변경을 적는 방식도 있어요. https://docs.eraser.io/ai-diagrams.md , https://docs.eraser.io/freeform-diagrams.md
- 후속 프롬프트의 세부 UX(diff 표시, 되돌리기)는 문서에 없어요 **(미확인)**.
- API `POST https://app.eraser.io/api/render/prompt` https://docs.eraser.io/reference/generate-diagram-from-prompt
  - 주요 필드: `text`(필수), `diagramType`(생략 시 자동), `mode`(`standard` 빠름·저렴 / `premium` 기본), `priorRequestId`(이전 요청을 이어서 수정), `inlineCodeEdit{code, diagramType}`(기존 코드를 직접 수정, `priorRequestId`와 배타), `attachments`(base64, 최대 10MB), `presetId`, `gitContexts`, `theme`, `imageQuality`(1~3), `fileOptions`.
  - 응답: `requestId`, `imageUrl`, `diagrams[]{id, diagramUrl, diagramType, code, ...}`, `changed`.
  - 공개된 요청 한도 수치 없음 **(미확인)**. 과부하 시 503.
- 모델: FAQ에는 작업별로 Anthropic Claude와 OpenAI 모델 중에서 고른다고 적혀 있어요. 모델명은 페이지 표기를 그대로 믿기 어려워 정확한 목록은 **(미확인)**. 학습 데이터 미사용, OpenAI는 API 기록을 최대 30일 보관, SOC 2 Type 2 보고서 요청 가능. https://docs.eraser.io/ai-faq.md

## 7. 연동과 내보내기

| 항목 | 내용 | 출처 |
|---|---|---|
| GitHub sync | GitHub만 지원(GitLab·Azure DevOps 미지원). `main`의 `.md`를 pull(노트만 덮어씀, 캔버스 영향 없음). push는 파일 단위 또는 전체, 브랜치 선택·PR 생성 가능. 충돌은 Eraser에서 해결 불가. **DSL 코드는 저장 안 되고 PNG만 `/.eraser`에 저장**. freeform은 `.eraserdiagram`(JSON)으로 동기화 가능하다고도 적혀 있어요(두 문장이 충돌해요). | https://docs.eraser.io/git-sync.md |
| Eraserbot | PR이 감시 파일을 건드리면 다이어그램을 갱신하고 PR에 댓글. GitHub·GitLab 지원(위 Git sync 문서와 범위가 달라요). usage-based pricing 필요. | https://docs.eraser.io/eraserbot.md |
| VS Code | 확장 설치. `.eraserdiagram` 파일(DSL)을 만들고 미리보기. 첫 줄에 종류(`cloud-architecture-diagram`, `entity-relationship-diagram`, `sequence-diagram`, `flow-chart`) 지정. BPMN 포함 여부는 **미확인**. | https://docs.eraser.io/using-the-vs-code-extension.md |
| Notion | Eraser 링크를 "Paste as preview"로 붙이면 실시간 갱신 미리보기. 각 Notion 사용자가 연동 설치 필요. | https://docs.eraser.io/using-the-notion-integration.md |
| Confluence | Marketplace 앱을 사이트에 1회 설치. `/eraser` 명령 또는 링크 붙여넣기. 라이브 갱신. | https://docs.eraser.io/using-the-confluence-integration.md |
| Export | PNG·SVG·PDF(모든 종류), BPMN(BPMN만), Visio `.vsdx`(Architecture·Flowchart·Freeform·BPMN), draw.io, PowerPoint, Google Slides. 이미지 옵션: 1x/2x/3x, 투명/불투명, 라이트/다크. 문서는 `.md` 또는 PDF. 클립보드: PNG/SVG, Markdown/HTML 임베드 코드. | https://docs.eraser.io/export.md |
| Embed API | 서버가 토큰 요청 → `embedUrl`을 iframe에. 읽기 전용(이동·확대만), 만료 기본 1일, 토큰당 시간당 20,000회. 팀/조직 API 토큰(유료) 필요. | https://docs.eraser.io/reference/embedding.md |
| REST API | 파일·다이어그램·폴더 CRUD, 프롬프트→다이어그램, DSL→다이어그램, 내보내기, 임베드, 사용량, 감사 로그. | https://docs.eraser.io/llms.txt |
| MCP server | `https://app.eraser.io/api/mcp`(원격), 로컬은 npm `@eraserlabs/eraser-mcp`. 약 50개 도구(다이어그램·문서·파일·폴더·프리셋 등). 인증은 OAuth 또는 API 키(Bearer). 클라이언트: Claude Code, Claude, ChatGPT, Codex, Cursor, VS Code, GitHub Copilot 등. 무료 사용 가능, AI 호출은 크레딧 소모. | https://docs.eraser.io/mcp.md |

- 문서 간 불일치: `export.md`는 PDF·2x/3x 품질·워터마크 제거가 유료라고 하고, 가격 페이지는 PDF/PNG/SVG/MD 내보내기를 전 플랜에 포함이라고 해요. 최신 기준은 **(미확인)**. https://docs.eraser.io/export.md , https://www.eraser.io/pricing

## 8. 가격 (월, 멤버당)

출처: https://www.eraser.io/pricing , https://docs.eraser.io/plans.md

| 플랜 | 가격 | AI 크레딧 | 파일 | Git repo + 데이터 소스 |
|---|---|---|---|---|
| Free | $0 | 총 3 | 3개 | 없음 |
| Business | 연간 결제 $45 / 월간 $60 | 월 100 | 무제한 | 1 + 1 |
| Business Plus | 연간 결제 $42, 최소 10석 | 월 250 | 무제한 | 3 + 3 |
| Enterprise | 문의 | 무제한 | 무제한 | 무제한 |

플랜별로 막힌 것 (가격 페이지 기준):
- Diagram-as-code, AI 다이어그램, Notion·Confluence·VS Code: 전 플랜 포함.
- GitHub 연동: Free 제외.
- API: Free 제외, 사용량 과금. 임베드 토큰도 유료. 비공개 파일: Business 이상.
- 커스텀 아이콘: Business 100개, 그 위 무제한. 버전 기록: Free 7일, 유료 무제한.
- SAML SSO: Business Plus 이상. SCIM·SIEM 로깅: Enterprise.
- Starter 플랜은 신규 가입 중단. https://docs.eraser.io/plans.md
- 크레딧 1개의 정의: 플랜 문서에는 "맵에서 뷰를 그리거나 바꿀 때 1크레딧"만 있어요. 다이어그램 1회 생성의 소모량은 **(미확인)**.

## 9. 우리 도구(로컬 셀프호스팅)에 주는 시사점 (추정)

1. DSL 하나로 5종을 다루는 공통 골격(노드·그룹·연결·속성·전역 스타일)이 핵심이라, 파서 하나 + 종류별 레이아웃 어댑터 구조가 맞아 보여요.
2. "코드 ↔ 자유 캔버스"는 Eraser도 단방향(코드 → freeform)이에요. 같은 제약으로 시작해도 돼요.
3. 드래그 편집은 레이아웃 오버라이드로 두고 코드 변경 시 리셋하는 단순한 규칙을 Eraser가 쓰고 있어요.
4. Git 동기화에서 DSL 원문이 빠지는 점은 Eraser의 약점이에요. 로컬 도구는 DSL 텍스트 파일을 그대로 저장하면 차별점이 돼요.
5. AI 수정 흐름은 `priorRequestId`와 `inlineCodeEdit` 두 방식이에요. 로컬에서는 "현재 코드 + 지시문 → 새 코드" 한 방식으로 충분해요.
