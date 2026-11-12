# Eraser.io 로컬 대체품 만들기 (03-build-local)

조사일: 2026-11-12. 공개 자료만 사용했어요. 로그인·가입 없음.
재확인: 2026-11-12. (미확인)·(추정) 항목을 원문(curl, `npm view`)으로 다시 봤어요. 근거가 생긴 건 표시를 지우고 출처를 달았어요.
표기: 출처 없는 문장은 없어요. 확인 못 한 것은 (미확인), 추론은 (추정)으로 표시했어요.

## 1. Eraser의 기술 기반 (공개 정보 + 추정)

### 공개로 확인된 것

- **자체 diagram-as-code**: 채용 페이지가 "proprietary diagram-as-code implementation"과 "free-form infinite canvas"를 언급해요. 출처: <https://www.eraser.io/roles/software-engineer>
- **레이아웃·파서 관련 우대 기술**: 같은 채용 페이지의 Diagrams 역할 우대 사항에 D3.js, Graphviz, ELK, lexical parsers, language servers가 있어요. 출처: <https://www.eraser.io/roles/software-engineer> ("우대"이지 "사용 중"이라는 확인은 아니에요.)
- **DSL은 선언형 텍스트**: node, group, connection 세 가지로 구성돼요. 출처: <https://docs.eraser.io/docs/cloud-architecture-diagrams>
- **기본 레이아웃은 자동**: 위치를 직접 지정하지 않아도 돼요. 출처: <https://docs.eraser.io/docs/diagram-as-code>
- **다이어그램 두 형식**: Code(DSL)와 freeform 두 가지예요. 팀 설정이 Code가 아니면 AI가 freeform을 만들어요. 출처: <https://docs.eraser.io/docs/cloud-architecture-diagrams>
- **지원 diagram 종류**: flow chart, ERD, cloud architecture, sequence, BPMN(swimlane) 5가지예요. 출처: <https://docs.eraser.io/docs/diagram-as-code>
- **공개 렌더러 eraser-diagrams (2026-09 공개)**: 좌표를 담은 JSON 형식과 렌더러를 MIT로 공개했어요. 범위는 "Data schema · rendering engine · line routing · icon library adapter · exporting"이고 GUI 편집기·AI 프롬프트는 빠져요. 출처: <https://www.eraser.io/open-source>, <https://github.com/eraserlabs/eraser-diagrams>. 이 렌더러가 앱의 DSL 렌더링과 같은 코드인지는 (미확인: 저장소가 "reference renderer"라고만 해요).

### 공개 DSL 문법 (architecture 기준, 로컬 파서 설계의 기준선)

출처: <https://docs.eraser.io/docs/architecture-diagram-syntax>

- 노드: `compute [icon: aws-ec2]`. 이름은 유일해야 해요.
- 그룹: `Name { ... }`. 중첩 가능해요.
- 속성(`[ ]` 안, 쉼표 구분): `icon`, `color`, `label`, `colorMode`(`pastel`/`bold`/`outline`), `styleMode`(`shadow`/`plain`/`watercolor`), `typeface`(`rough`/`clean`/`mono`), `textSize`, `wrap`, `link`.
- 연결: `>` `<` `<>` `-` `--` `-->` (`<--`, `<-->`도 있어요). 라벨은 `:` 뒤에 써요. 연결 속성은 `color`, `wrap`, `connectorStyle`(`elbow`/`straight`/`arc`)이에요.
- 방향: `direction down|up|right|left` (기본 `right`). 기본 `connectorStyle`은 `elbow`예요.
- 기타: `// comment`, `title ...`, `legend { ... }`, 예약어는 따옴표로 이스케이프해요.
- 정의되지 않은 이름에 연결하면 빈 노드가 생겨요. 노드는 첫 연결 전에 정의해야 해요(안 하면 중복 이름 오류).

### 공개되지 않은 것 (전부 (미확인))

- 프런트엔드 프레임워크, 서버 언어, DB, 실시간 협업 방식(CRDT/OT 여부). 채용 페이지에 실시간 협업과 프로그래밍 언어가 없어요(Platform 역할에 Docker, Kubernetes, Terraform, Pulumi만 있어요). 출처: <https://www.eraser.io/roles/software-engineer>. GitHub 조직에 firebase-tools, fireway(Firestore 마이그레이션), slate 포크가 있지만 포크만으로는 사용 근거가 약해요 (추정). 출처: <https://github.com/eraserlabs>
- 앱 렌더러가 canvas인지 SVG인지는 (미확인)이에요. 다만 공개 렌더러 eraser-diagrams는 "HTML and CSS as the visual substrate"이고 선은 SVG로 그려요. 헤드리스 Chromium으로 PNG를 만들어요. 출처: <https://github.com/eraserlabs/eraser-diagrams/blob/main/README.md>
- 손그림 라이브러리는 안 써요(eraser-diagrams 기준). `typeface: rough`는 손글씨 글꼴 Shantell Sans예요 ("Shantell Sans for rough, Inter for clean, JetBrains Mono for mono"). 출처: <https://github.com/eraserlabs/eraser-diagrams/blob/main/packages/diagrams/src/fonts/eraserFonts.ts>. `watercolor`는 미리 만든 텍스처 이미지를 SVG 휘도 LUT로 색칠하는 방식이에요. 출처: <https://github.com/eraserlabs/eraser-diagrams/blob/main/packages/templates/src/watercolorTexture.ts>. 렌더 패키지 의존성에 rough.js 같은 외부 라이브러리가 없어요. 출처: <https://github.com/eraserlabs/eraser-diagrams/blob/main/packages/render/package.json>
- 레이아웃 엔진: Eraser 블로그가 AI 다이어그램 도구들이 "Eraser included – have always relied on deterministic layout engines like ELK"라고 써요. 출처: <https://www.eraser.io/blog/open-sourcing-eraser-diagrams>. "like ELK"라서 정확한 엔진 이름은 (미확인: 블로그가 단정하지 않아요). 새 JSON 형식은 좌표를 LLM이 정하고, 선은 자체 corridor 라우터(`@eraserlabs/layout`)가 그려요. 출처: <https://github.com/eraserlabs/eraser-diagrams/blob/main/packages/layout/README.md>
- 블로그는 있어요. 글은 2편(maps 소개, eraser-diagrams 공개)이고 스택 전체를 밝힌 글은 없어요. 출처: <https://www.eraser.io/blog>

## 2. 오픈소스 부품 평가

| 부품 | 라이선스 | 역할 | 적합도 |
|---|---|---|---|
| tldraw | 자체 SDK 라이선스 (오픈소스 아님) | freeform canvas | 제외. 사내 전용이어도 production 사용일 수 있어요([08](08-spike-oss.md) §7) |
| Excalidraw | MIT | freeform canvas, 손그림 | 높음 |
| rough.js | MIT | 손그림 렌더링 | 높음 (DSL 렌더러용) |
| ELK.js | EPL-2.0 | 그룹·포트 있는 레이아웃 | 높음 |
| dagre | MIT | 단순 DAG 레이아웃 | 중간 |
| Mermaid | MIT | 텍스트→다이어그램 | 참고/보조 |
| Yjs | MIT | CRDT 동기화 | 높음 (후반 단계) |
| Automerge | MIT | CRDT | 대안 |
| TipTap | MIT (Pro 확장은 유료) | 문서 에디터 | 중간 |
| Lexical | MIT | 문서 에디터 | 중간 |
| CodeMirror 6 | MIT | DSL 에디터 | 최우선 |
| Monaco | MIT | DSL 에디터 | 보조 (무거움) |
| Langium / Chevrotain | MIT / Apache-2.0 | 파서 | 선택 |

### 상세 메모

- **tldraw** (원문 직접 확인, 2026-11-12): 라이선스 본문(LICENSE.md)과 tldraw.dev 문서가 말하는 범위가 달라서 나눠 적어요.
  - LICENSE.md 본문: 허용은 "Use the Software in Development Environments", 조건은 "Not to use the Software in Production Environments"예요. 키 집행을 끄거나 바꾸면 안 돼요. 트라이얼은 "for the specified period"라고만 하고 일수가 없어요. hobby 라이선스는 본문에 없어요. 데이터는 "may collect and transmit usage data to tldraw for license compliance purposes"라고만 해요. 출처: <https://github.com/tldraw/tldraw/blob/main/LICENSE.md>
  - tldraw.dev 문서: 프로덕션에는 trial(100일 무료, 상업 단위당 1회)·commercial·hobby 중 하나의 키가 필요해요. 워터마크("made with tldraw")는 hobby에서 의무예요. hobby는 비상업 프로젝트에 재량 발급이에요. 데이터는 commercial·hobby는 "no information is sent", 프로덕션 trial은 키 해시만 보낸다고 해요. 키는 클라이언트에서 검증하고 오프라인에서도 쓸 수 있어요. 출처: <https://tldraw.dev/community/license>
  - 가격 페이지는 "Value-based pricing", "Talk to sales"만 있고 금액이 없어요. 출처: <https://tldraw.dev/pricing>
  - 코드(5.6.0)는 키 상태에 따라 tldraw CDN으로 추적 요청을 보내는 분기가 있고, 그 유형에 hobby로 보이는 `with_watermark`도 있어 문서와 어긋나 보여요. 키가 없어도 글꼴·아이콘을 CDN에서 35건 받아요. 자세한 건 [08](08-spike-oss.md) §2.
  - 이 프로젝트는 외부 통신을 피하는 로컬 도구라서, 외부 요청이 0건이었던 Excalidraw가 더 안전해요 (추정).
- **Excalidraw**: MIT이고 `@excalidraw/excalidraw` React 컴포넌트로 임베드할 수 있어요. 출처: <https://github.com/excalidraw/excalidraw>. 다만 Eraser의 `typeface: rough`는 손글씨 글꼴일 뿐이고(위 1절), Excalidraw는 rough.js로 선 자체를 흔들어 그려요. 출처: `npm view @excalidraw/excalidraw dependencies`에 `roughjs`. 그래서 겉모습은 결이 다를 수 있어요 (추정: 화면 비교 안 함). 또, freeform 편집기이지 DSL 레이아웃 엔진이 아니에요.
- **rough.js**: MIT. canvas와 SVG 양쪽에서 쓸 수 있고 hachure, zigzag 같은 채움을 지원해요. 출처: <https://github.com/rough-stuff/rough>. 채움은 "hachure(default), solid, zigzag, cross-hatch, dots, dashed, or zigzag-line"뿐이라 `styleMode: watercolor` 효과는 없어요. 출처: <https://github.com/rough-stuff/rough/blob/master/README.md>. 직접 구현해야 해요. Eraser는 텍스처 이미지 방식을 써요(1절).
- **ELK.js**: ELK 알고리즘을 JS로 옮긴 것이고 레이아웃만 계산해요. 렌더링은 따로 해야 해요. `new ELK().layout(graph)`가 Promise를 반환하고, Web Worker로 돌릴 수 있어요. 출처: <https://github.com/kieler/elkjs>. 라이선스는 EPL-2.0이고 Secondary License로 GPL-3.0-or-later를 명시해요. 출처: <https://github.com/kieler/elkjs/blob/master/LICENSE.md>. EPL은 배포("Distribute")할 때만 소스 제공 의무가 생겨요. 이 도구는 사내 전용·비배포라서 사실상 의무가 없어요. 원문 인용과 판정은 [08](08-spike-oss.md) §7. 중첩 group(compound node)을 지원해요. `hierarchyHandling: INCLUDE_CHILDREN`이면 한 번에 배치해요. 출처: <https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html>
- **dagre**: MIT. `@dagrejs/dagre`만 갱신되고 있어요. 출처: <https://github.com/dagrejs/dagre>. 중첩 group(compound graph)도 지원해요. graphlib에서 `compound: true` + `setParent`를 쓰고, 위키가 클러스터 구현이 Sander의 "Layout of Compound Directed Graphs"를 따른다고 해요. 출처: <https://github.com/dagrejs/dagre/wiki>, <https://github.com/dagrejs/graphlib/wiki/API-Reference>. 포트·계층 옵션이 더 많은 ELK가 group 중심 architecture diagram에 낫다고 (추정: 비교 실험 안 함)해요.
- **Mermaid**: MIT, "20+ Diagram Types". 출처: <https://github.com/mermaid-js/mermaid>. 레이아웃은 v12.0.0부터 ELK가 번들 기본값이고 "replacing Dagre"예요. `layout: dagre`로 되돌릴 수 있어요. 출처: <https://mermaid.js.org/config/layouts.html>. Mermaid 문법을 import하는 용도나 sequence diagram 렌더링 참고로 쓸 만해요 (추정: 설계 판단).
- **Yjs**: MIT, 네트워크 독립 CRDT예요. y-websocket 서버로 동기화하고, y-indexeddb 등으로 저장해요. 출처: <https://github.com/yjs/yjs>. Lexical은 Yjs 협업을 지원해요. 출처: <https://github.com/facebook/lexical>.
- **Automerge**: MIT. 여러 CRDT 구현, 압축 저장 형식, 동기화 프로토콜을 제공해요. 코어는 Rust이고 JS는 WebAssembly(`@automerge/automerge`)로 써요. "Automerge aims to be PostgreSQL for your local-first app." 출처: <https://github.com/automerge/automerge>
- **TipTap**: MIT, ProseMirror 기반이에요. 협업·댓글·버전 같은 Pro 확장은 구독이 필요해요. 출처: <https://github.com/ueberdosis/tiptap>. 협업은 오픈소스 Hocuspocus(Yjs)로 대체할 수 있어요. 출처: 같은 페이지.
- **Lexical**: MIT(Meta), JSON/Markdown/HTML 입출력, Yjs 협업 지원. 출처: <https://github.com/facebook/lexical>.
- **CodeMirror 6**: MIT. 파싱 트리, lint 표시, 자동완성, 확장 인터페이스, 모바일 네이티브 편집을 지원해요. 출처: <https://codemirror.net/>. 개발 저장소는 2026-04-15에 아카이브돼 `code.haverbeke.berlin`으로 옮겨졌어요. 출처: <https://github.com/codemirror/dev>. 언어 지원은 Lezer 기반이에요. 공식 예제가 파서 방법으로 Lezer 문법, stream parser, 완전 자체 파서 세 가지를 들어요. 출처: <https://codemirror.net/examples/lang-package/>. `@codemirror/language`가 `@lezer/common`, `@lezer/lr`에 의존해요(`npm view @codemirror/language dependencies`).
- **Monaco**: MIT. 모바일 브라우저는 지원하지 않는다고 FAQ에 적혀 있어요. Monarch 토크나이저로 커스텀 언어를 만들 수 있어요. 출처: <https://github.com/microsoft/monaco-editor>. DSL 에디터로는 가벼운 CodeMirror가 낫다고 (추정: 설계 판단)해요.
- **Langium**: MIT, Chevrotain 기반, LSP 내장, 브라우저에서도 동작해요. 출처: <https://github.com/langium/langium>. 문법이 작은 DSL에는 과할 수 있어요 (추정: 설계 판단).

### DSL 파서 접근

1. **손으로 쓴 recursive descent (권장, MVP)**: 문법이 작아요(node/group/connection/속성 블록/주석/title/legend/direction). 줄 단위라 구현이 단순하고 오류 메시지를 줄·열 단위로 통제하기 쉬워요. 출처의 문법 규칙: <https://docs.eraser.io/docs/architecture-diagram-syntax>
2. **Chevrotain 직접 사용 (중기)**: 문법이 커지면 도입해요. Langium의 기반이기도 해요. 출처: <https://github.com/langium/langium>
3. **Langium (후기)**: LSP까지 필요할 때만 써요. Eraser도 language server를 우대 기술로 적었어요. 출처: <https://www.eraser.io/roles/software-engineer>
4. 어느 방식이든 파서는 AST와 함께 소스 위치(range)를 내보내야 해요. 에디터 오류 표시와 "다이어그램 클릭 → 코드 위치 이동"에 쓰여요 (추정: 설계 판단).

## 3. 제안 아키텍처 (127.0.0.1 전용)

이 저장소 규칙을 따라요: 서버는 127.0.0.1에만 바인딩하고, 토큰·이메일·실명은 저장하거나 로그에 남기지 않아요 (CLAUDE.md).

```
브라우저 (React + Vite)
  ├─ CodeMirror 6: DSL 에디터 (lint = 파서 오류)
  ├─ Canvas 뷰: SVG 렌더 (rough.js, 선택)
  └─ Web Worker: ELK.js 레이아웃
        ▲  HTTP/WebSocket (127.0.0.1)
Node 서버 (Fastify 또는 Express)
  ├─ 파일 저장소: workspace/*.diagram.er (DSL 텍스트)
  ├─ 파일 감시: chokidar로 외부 편집 반영
  ├─ 버전: 저장 시 스냅샷 (.history/ 폴더)
  └─ export: SVG/PNG/JSON
```

- **저장 형식**: 평문 DSL 파일 1개 = 다이어그램 1개. git에 그대로 넣을 수 있고 에이전트가 직접 편집할 수 있어요 (추정: 설계 판단, 이 저장소의 방식과 동일).
- **freeform 모드**: 위치 정보가 필요하니 별도 JSON (`*.canvas.json`). Excalidraw 포맷 호환을 우선 고려해요 (추정: 설계 판단).
- **레이아웃 결과 캐시**: DSL 해시 → 좌표. 손으로 옮긴 노드 위치는 별도 오버라이드 파일로 둬요 (추정: 설계 판단).
- **서버 비밀·PII**: 계정 없음, 외부 호출 없음(폰트·아이콘은 번들), 로그에 파일 내용을 남기지 않아요.
- **실시간 협업(후기)**: Yjs 문서를 서버가 메모리에 두고 y-websocket 방식으로 동기화해요. 출처: <https://github.com/yjs/yjs>. 단일 사용자 로컬이면 필요 없어요.

## 4. 우선순위 MVP와 단계

### MVP (P0)

1. DSL 파서: node, group(중첩), connection 6종, 속성, `title`, `direction`, 주석.
2. ELK.js 자동 레이아웃 + SVG 렌더 (group = 박스, `elbow` 연결선).
3. CodeMirror 에디터 + 실시간 미리보기 + 줄·열 오류 표시.
4. 파일 기반 저장, 파일 목록, 외부 편집 감지.
5. SVG/PNG export.

### P1

- `colorMode`, `styleMode`, `typeface: rough`(rough.js), `connectorStyle` 3종, `legend`.
- 아이콘 세트(자체 제작 또는 허용된 라이선스의 세트만), `icon:` 속성.
- 버전 히스토리, 코드↔도형 선택 동기화.

### P2

- 다른 diagram 종류: sequence, ERD, flow chart, BPMN. 종류 목록 출처: <https://docs.eraser.io/docs/diagram-as-code>
- freeform 캔버스(Excalidraw 임베드).
- 문서 + 다이어그램 혼합 편집(Lexical 또는 TipTap).

### P3

- 다중 사용자 실시간 협업(Yjs).
- AI 생성 연동(별도 키가 필요해요. 키는 저장하지 않고 환경 변수로만).
- LSP(Langium).

## 5. 상표·트레이드 드레스와 저작권 (내부 전용 전제, 2026-11-12 개정)

전제(사용자 확정): 이 도구는 판매·배포하지 않고 회사 안에서만 써요. 외부에 노출하지 않아요. 아래는 법률 검토가 아니에요.

- Eraser 약관: "Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of the Company." 같은 절에서 서비스의 "features and functionality"가 회사 소유라고 해요. 경쟁 제품 금지나 리버스 엔지니어링 금지 조항은 약관 본문에서 찾지 못했어요. 출처: <https://www.eraser.io/terms>
- **상표·트레이드 드레스 위험은 내부 전용이면 크게 낮아져요 (추정: 법률 판단).** 상표·트레이드 드레스는 시장에서 소비자가 출처를 헷갈리는 걸 막는 권리라서, 팔지도 공개하지도 않는 사내 도구는 혼동할 소비자가 없어요. 그래서 화면 배치, 색 팔레트, 폰트 조합, 톤을 Eraser와 똑같이 맞추는 것 자체는 막지 않아요.
  - 그래도 이름·로고·워드마크·파비콘은 쓰지 않아요. 사내 도구에 남의 이름을 붙일 이유가 없고, 나중에 공개 범위가 바뀌면 바로 문제가 돼요. 위 약관 조항은 회사가 Eraser 계정을 쓰는 경우 계약 조건으로도 걸려요 (추정).
- **저작권은 내부 전용이어도 그대로예요.** 복제 자체가 권리자 허락이 필요한 행위라서, 배포 여부와 관계없이 Eraser의 실제 자산 파일(아이콘·일러스트·폰트 파일·비공개 코드)을 앱이나 사이트에서 가져와 복사해 넣으면 안 돼요 (추정: 법률 판단).
  - 예외: Eraser가 MIT로 공개한 eraser-diagrams 코드는 MIT 조건(저작권 고지 유지)대로 쓸 수 있어요. 출처: <https://github.com/eraserlabs/eraser-diagrams/blob/main/LICENSE>. 단, 4,000개 아이콘 세트는 "as an optional add-on"이라 별도이고, 그 라이선스는 (미확인: 공개 페이지에 조건이 없어요). 출처: <https://www.eraser.io/open-source>
  - 폰트: 공개 렌더러가 쓰는 Shantell Sans·Inter·JetBrains Mono는 모두 SIL OFL 1.1이에요. Eraser에서 파일을 복사하지 말고 각 원 배포처에서 받으면 같은 모양을 쓸 수 있어요. 출처: <https://github.com/arrowtype/shantell-sans/blob/main/OFL.txt>, <https://github.com/rsms/inter/blob/master/LICENSE.txt>, <https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt>
  - 아이콘: `aws-ec2` 같은 아이콘 이름은 문법에 나오지만 이미지는 Eraser 자산이거나 AWS 등 각 사 자산이에요. 각 클라우드 회사가 공식 배포하는 아이콘 세트를 그 조건대로 쓰거나 직접 그려요. Eraser 아이콘 문서는 이름 목록만 있고 라이선스가 없어요 (미확인). 출처: <https://docs.eraser.io/docs/icons>
- DSL 문법(키워드 `icon`, `color`, `direction` 등)을 똑같이 읽는 파서를 직접 짜는 건 자산 복제가 아니라서 허용 쪽으로 봐요 (추정: 법률 판단. 약관·문서에 문법 언급이 없어요). 새 JSON 형식은 MIT로 공개됐어요. 출처: <https://www.eraser.io/open-source>
- 사용자 콘텐츠: Eraser 약관상 사용자가 콘텐츠 소유권을 유지해요. 출처: <https://www.eraser.io/terms>. 그래서 회사가 Eraser에서 만든 다이어그램을 export해 로컬 도구로 가져오는 건 문제가 없어 보여요 (추정: 법률 판단).
- 이전 판과 달라진 점: 이전 판은 "룩앤필을 그대로 따라 하면 trade dress 주장의 소지"가 있다며 비주얼을 자체 스타일로 하라고 권했어요. 내부 전용 전제로 이 권고를 풀었어요. 이름·로고와 자산 파일 복제 금지는 유지해요.

## 6. 열린 질문 (사용자 결정 필요)

1. ~~혼자 쓰는 로컬 도구로 끝낼지, 배포까지 갈지~~ → 결정됨(2026-11-12): 판매·배포 없이 사내 전용. 라이선스 판정은 [08](08-spike-oss.md) §7. 나중에 공개 범위가 바뀌면 이 문서 5절과 08 §7을 다시 봐야 해요.
2. Eraser DSL과 문법 호환을 목표로 할지, 영감만 받고 자체 DSL을 만들지.
3. freeform 캔버스가 MVP에 필요한지.
