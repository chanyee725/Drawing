# Eraser.io 로컬 대체품 만들기 (03-build-local)

조사일: 2026-11-12. 공개 자료만 사용했어요. 로그인·가입 없음.
표기: 출처 없는 문장은 없어요. 확인 못 한 것은 (미확인), 추론은 (추정)으로 표시했어요.

## 1. Eraser의 기술 기반 (공개 정보 + 추정)

### 공개로 확인된 것

- **자체 diagram-as-code**: 채용 페이지가 "proprietary diagram-as-code implementation"과 "free-form infinite canvas"를 언급해요. 출처: <https://www.eraser.io/roles/software-engineer>
- **레이아웃·파서 관련 우대 기술**: 같은 채용 페이지의 Diagrams 역할 우대 사항에 D3.js, Graphviz, ELK, lexical parsers, language servers가 있어요. 출처: <https://www.eraser.io/roles/software-engineer> ("우대"이지 "사용 중"이라는 확인은 아니에요.)
- **DSL은 선언형 텍스트**: node, group, connection 세 가지로 구성돼요. 출처: <https://docs.eraser.io/docs/cloud-architecture-diagrams>
- **기본 레이아웃은 자동**: 위치를 직접 지정하지 않아도 돼요. 출처: <https://docs.eraser.io/docs/diagram-as-code>
- **다이어그램 두 형식**: Code(DSL)와 freeform 두 가지예요. 팀 설정이 Code가 아니면 AI가 freeform을 만들어요. 출처: <https://docs.eraser.io/docs/cloud-architecture-diagrams>
- **지원 diagram 종류**: flow chart, ERD, cloud architecture, sequence, BPMN(swimlane). 출처: <https://docs.eraser.io/docs/diagram-as-code>

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

- 프런트엔드 프레임워크, 서버 언어, DB, 실시간 협업 방식(CRDT/OT 여부). 채용 페이지에 실시간 협업과 프로그래밍 언어가 없어요. 출처: <https://www.eraser.io/roles/software-engineer>
- 렌더러가 canvas인지 SVG인지. `typeface: rough`, `watercolor` 스타일이 있으니 손그림 렌더링을 쓸 거라고 (추정)하지만, 라이브러리 이름은 (미확인)이에요.
- 레이아웃 엔진 실제 선택. ELK/Graphviz가 후보라는 건 채용 우대 기술에서 나온 (추정)이에요.
- 엔지니어링 블로그나 스택 공개 글은 검색에서 못 찾았어요. 출처: 검색 결과 <https://www.eraser.io/> 계열 페이지에 해당 글 없음 (미확인).

## 2. 오픈소스 부품 평가

| 부품 | 라이선스 | 역할 | 적합도 |
|---|---|---|---|
| tldraw | 자체 SDK 라이선스 (오픈소스 아님) | freeform canvas | 조건부. 아래 참고 |
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
| Langium / Chevrotain | MIT | 파서 | 선택 |

### 상세 메모

- **tldraw** (원문 직접 확인, 2026-11-12): 라이선스 본문(LICENSE.md)과 tldraw.dev 문서가 말하는 범위가 달라서 나눠 적어요.
  - LICENSE.md 본문: 허용은 "Use the Software in Development Environments", 조건은 "Not to use the Software in Production Environments"예요. 키 집행을 끄거나 바꾸면 안 돼요. 트라이얼은 "for the specified period"라고만 하고 일수가 없어요. hobby 라이선스는 본문에 없어요. 데이터는 "may collect and transmit usage data to tldraw for license compliance purposes"라고만 해요. 출처: <https://github.com/tldraw/tldraw/blob/main/LICENSE.md>
  - tldraw.dev 문서: 프로덕션에는 trial(100일 무료, 상업 단위당 1회)·commercial·hobby 중 하나의 키가 필요해요. 워터마크("made with tldraw")는 hobby에서 의무예요. hobby는 비상업 프로젝트에 재량 발급이에요. 데이터는 commercial·hobby는 "no information is sent", 프로덕션 trial은 키 해시만 보낸다고 해요. 키는 클라이언트에서 검증하고 오프라인에서도 쓸 수 있어요. 출처: <https://tldraw.dev/community/license>
  - 가격 페이지는 "Value-based pricing", "Talk to sales"만 있고 금액이 없어요. 출처: <https://tldraw.dev/pricing>
  - 코드(5.6.0)는 키 상태에 따라 tldraw CDN으로 추적 요청을 보내는 분기가 있고, 그 유형에 hobby로 보이는 `with_watermark`도 있어 문서와 어긋나 보여요. 키가 없어도 글꼴·아이콘을 CDN에서 35건 받아요. 자세한 건 [08](08-spike-oss.md) §2.
  - 이 프로젝트는 외부 통신을 피하는 로컬 도구라서, 외부 요청이 0건이었던 Excalidraw가 더 안전해요 (추정).
- **Excalidraw**: MIT이고 `@excalidraw/excalidraw` React 컴포넌트로 임베드할 수 있어요. 출처: <https://github.com/excalidraw/excalidraw>. 손그림 스타일이 Eraser의 `typeface: rough` 기본값과 결이 비슷해요 (추정). 단, freeform 편집기이지 DSL 레이아웃 엔진이 아니에요.
- **rough.js**: MIT. canvas와 SVG 양쪽에서 쓸 수 있고 hachure, zigzag 같은 채움을 지원해요. 출처: <https://github.com/rough-stuff/rough>. `styleMode: watercolor`에 해당하는 효과는 기본 제공이 아니에요 (추정, 직접 구현 필요).
- **ELK.js**: ELK 알고리즘을 JS로 옮긴 것이고 레이아웃만 계산해요. 렌더링은 따로 해야 해요. `new ELK().layout(graph)`가 Promise를 반환하고, Web Worker로 돌릴 수 있어요. 출처: <https://github.com/kieler/elkjs>. 라이선스는 EPL-2.0이고 Secondary License로 GPL-3.0-or-later를 명시해요. 출처: <https://github.com/kieler/elkjs/blob/master/LICENSE.md>. EPL은 약한 카피레프트라서, 수정 없이 의존성으로 쓰는 로컬 앱에는 보통 문제가 없어요 (추정, 배포 시 법률 확인 필요). 중첩 group에 잘 맞아요 (추정).
- **dagre**: MIT. `@dagrejs/dagre`만 갱신되고 있어요. 출처: <https://github.com/dagrejs/dagre>. 중첩 group(compound graph) 지원은 (미확인)이에요. group이 핵심인 architecture diagram에는 ELK가 낫다고 (추정)해요.
- **Mermaid**: MIT, 20개 이상 diagram 종류, dagre-d3 기반 레이아웃을 쓰는 걸로 보여요. 출처: <https://github.com/mermaid-js/mermaid>. Mermaid 문법을 import하는 용도나 sequence diagram 렌더링 참고로 쓸 만해요 (추정).
- **Yjs**: MIT, 네트워크 독립 CRDT예요. y-websocket 서버로 동기화하고, y-indexeddb 등으로 저장해요. 출처: <https://github.com/yjs/yjs>. Lexical은 Yjs 협업을 지원해요. 출처: <https://github.com/facebook/lexical>.
- **Automerge**: MIT. 출처: <https://github.com/automerge/automerge>. 기능 세부는 미조사 (미확인).
- **TipTap**: MIT, ProseMirror 기반이에요. 협업·댓글·버전 같은 Pro 확장은 구독이 필요해요. 출처: <https://github.com/ueberdosis/tiptap>. 협업은 오픈소스 Hocuspocus(Yjs)로 대체할 수 있어요. 출처: 같은 페이지.
- **Lexical**: MIT(Meta), JSON/Markdown/HTML 입출력, Yjs 협업 지원. 출처: <https://github.com/facebook/lexical>.
- **CodeMirror 6**: MIT. 파싱 트리, lint 표시, 자동완성, 확장 인터페이스, 모바일 네이티브 편집을 지원해요. 출처: <https://codemirror.net/>. 개발 저장소는 2026-04-15에 아카이브돼 `code.haverbeke.berlin`으로 옮겨졌어요. 출처: <https://github.com/codemirror/dev>. 이 공개 페이지들에는 Lezer 언급이 없어요 (미확인, 다만 CodeMirror 6 언어 지원이 Lezer 기반이라는 건 일반 지식이라 문서로 재확인 필요).
- **Monaco**: MIT. 모바일 브라우저는 지원하지 않는다고 FAQ에 적혀 있어요. Monarch 토크나이저로 커스텀 언어를 만들 수 있어요. 출처: <https://github.com/microsoft/monaco-editor>. DSL 에디터로는 가벼운 CodeMirror가 낫다고 (추정)해요.
- **Langium**: MIT, Chevrotain 기반, LSP 내장, 브라우저에서도 동작해요. 출처: <https://github.com/langium/langium>. 문법이 작은 DSL에는 과할 수 있어요 (추정).

### DSL 파서 접근

1. **손으로 쓴 recursive descent (권장, MVP)**: 문법이 작아요(node/group/connection/속성 블록/주석/title/legend/direction). 줄 단위라 구현이 단순하고 오류 메시지를 줄·열 단위로 통제하기 쉬워요. 출처의 문법 규칙: <https://docs.eraser.io/docs/architecture-diagram-syntax>
2. **Chevrotain 직접 사용 (중기)**: 문법이 커지면 도입해요. Langium의 기반이기도 해요. 출처: <https://github.com/langium/langium>
3. **Langium (후기)**: LSP까지 필요할 때만 써요. Eraser도 language server를 우대 기술로 적었어요. 출처: <https://www.eraser.io/roles/software-engineer>
4. 어느 방식이든 파서는 AST와 함께 소스 위치(range)를 내보내야 해요. 에디터 오류 표시와 "다이어그램 클릭 → 코드 위치 이동"에 쓰여요 (추정).

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

- **저장 형식**: 평문 DSL 파일 1개 = 다이어그램 1개. git에 그대로 넣을 수 있고 에이전트가 직접 편집할 수 있어요 (추정, 이 저장소의 방식과 동일).
- **freeform 모드**: 위치 정보가 필요하니 별도 JSON (`*.canvas.json`). Excalidraw 포맷 호환을 우선 고려해요 (추정).
- **레이아웃 결과 캐시**: DSL 해시 → 좌표. 손으로 옮긴 노드 위치는 별도 오버라이드 파일로 둬요 (추정).
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

## 5. 상표·트레이드 드레스 리스크

- Eraser 약관: "Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of the Company." 별도 브랜드 가이드라인은 공개되어 있지 않아요. 출처: <https://www.eraser.io/terms>
- 따라서 이름·로고·로고 색·마스코트·마케팅 문구를 쓰지 마세요. 제품명에 "Eraser"나 유사 철자를 넣지 마세요 (추정, 상표 혼동 위험).
- 화면의 전체적인 룩앤필(색 팔레트, 폰트 조합, 아이콘 모양, 스크린샷 같은 배치)을 그대로 따라 하면 trade dress 주장의 소지가 있어요 (추정, 법률 자문 아님).
- 권장: **기능 구조와 UX 흐름(좌측 코드, 우측 캔버스 같은 분할 등)은 유지**하되, **비주얼은 자체 스타일**로 만들어요. 이 저장소의 UI는 이미 해요체 한국어 카피와 자체 스타일이 있으니 그걸 이어가면 돼요.
- DSL 문법 자체(키워드 `icon`, `color`, `direction` 등)의 저작권·호환성 문제는 (미확인)이에요. 호환 목표라면 "Eraser 호환"이라고 홍보하지 않는 게 안전해요 (추정).
- 아이콘: Eraser의 `aws-ec2` 같은 아이콘 이름은 문법에 나오지만, 실제 아이콘 이미지는 Eraser 자산이거나 AWS 등 각 사 상표일 수 있어요. 번들 전에 각 아이콘 세트의 라이선스를 확인하세요 (미확인).
- 사용자 콘텐츠: Eraser 약관상 사용자가 콘텐츠 소유권을 유지해요. 출처: <https://www.eraser.io/terms>. export한 다이어그램을 로컬 도구로 가져오는 것은 소유권 면에서 문제가 없어 보이나, 그 해석은 (추정)이에요.

## 6. 열린 질문 (사용자 결정 필요)

1. 혼자 쓰는 로컬 도구로 끝낼지, 배포까지 갈지. tldraw와 EPL 판단이 갈려요.
2. Eraser DSL과 문법 호환을 목표로 할지, 영감만 받고 자체 DSL을 만들지.
3. freeform 캔버스가 MVP에 필요한지.
