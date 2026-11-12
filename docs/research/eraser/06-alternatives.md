# 06. 대안 도구 비교 (Eraser 로컬 클론이 경쟁하거나 빌려올 것들)

조사일: 2026-11-12. 공개 자료만 사용. 로그인/가입 없음.
재확인: 2026-11-12. (미확인)/(추정) 항목을 공식 페이지, GitHub 원문, `npm view`로 다시 확인했어요. 남은 표시에는 이유를 붙였어요.
표기: 출처 URL = 확인된 사실, (미확인) = 근거 못 찾음, (추정) = 내 추론.
범위: 01(제품/에디터), 02(DSL/AI/연동/가격), 03(스택/OSS/MVP)과 겹치지 않게 "대안 비교"만 다룬다.

핵심 기준 3개로 본다.
- **Model**: canvas(마우스로 그림) / code(텍스트로 그림) / both
- **Licence / self-host**: 로컬에 올려도 되는가
- **Eraser 대비**: 약점·강점, 가져올 아이디어

---

## 1. Excalidraw

- **Model**: canvas. 손그림(sketch) 스타일 화이트보드. 코드 모델은 없지만 Mermaid를 캔버스에 붙여넣으면 편집 가능한 요소로 바꿔준다. 변환기는 flowchart, sequence, class, ER, state, Gantt, quadrant, timeline을 지원하고 나머지는 이미지로 삽입된다. https://github.com/excalidraw/mermaid-to-excalidraw
- **Licence / self-host**: MIT. 저장소에 Dockerfile, docker-compose.yml이 있다. npm 패키지 `@excalidraw/excalidraw`로 React에 임베드 가능. 협업은 end-to-end encrypted를 내세운다. https://github.com/excalidraw/excalidraw
- **AI**: excalidraw.com / Excalidraw+에 Text to diagram, Wireframe to code가 있다. Free는 "Generative AI, 10 requests a day", Plus($6/user/월)는 하루 100회 또는 자기 키(BYOK). MCP·REST API는 public beta. https://plus.excalidraw.com/pricing
- **강점 (vs Eraser)**: 라이선스가 가장 관대하다. 임베드 쉬움. 손그림 느낌 때문에 "초안" 분위기가 나서 부담이 낮다.
- **약점**: 자동 레이아웃과 코드 → 다이어그램 모델이 없다. 문서(doc) 편집, 버전/diff 개념이 없다 (추정: README 기능 목록과 Excalidraw+ 가격표에 해당 항목이 없음. "없다"는 공식 문구는 못 찾음).
- **가져올 아이디어**: (1) 요소를 JSON으로 저장하는 단순한 scene 포맷, (2) Mermaid → 편집 가능 요소 변환 경로, (3) 임베드 가능한 패키지 형태.

## 2. tldraw

- **Model**: canvas SDK. 에디터 자체가 아니라 "캔버스 엔진"에 가깝다.
- **Licence / self-host**: 자체 tldraw license. 개발 중에는 자유롭고 "Production use requires a license key". starter kit은 각각 MIT. 멀티플레이는 `@tldraw/sync`로 self-host 가능하고 starter kit은 Cloudflare Durable Objects 기반. https://github.com/tldraw/tldraw
- **AI**: README에 "AI integrations — canvas primitives for building with LLMs"가 있고, starter kit 중 Agent(캔버스를 읽고 고치는 AI 에이전트)가 있다. https://github.com/tldraw/tldraw
- **가격**: 금액은 공개 안 한다. "Value-based pricing", 100일 무료 체험, 취미용 무료 hobby license 신청, 초기 스타트업 할인이 있다. https://tldraw.dev/pricing
- **강점**: 커스텀 shape, 도구, UI를 코드로 확장하기 가장 좋다. 실시간 동기화 레퍼런스가 있다.
- **약점**: 기본 라이선스는 배포가 아니라 프로덕션 사용 자체를 막는다("Not to use the Software in Production Environments"). 사내 전용 업무 도구도 production으로 볼 여지가 커서 키(상용 계약)가 필요할 수 있다. 원문 판정은 [08](08-spike-oss.md) §7. https://github.com/tldraw/tldraw/blob/main/LICENSE.md
- **가져올 아이디어**: 커스텀 shape를 1급으로 취급하는 확장 구조(예: 클라우드 아이콘 노드), 멀티플레이어 sync 레이어 분리.

## 3. draw.io / diagrams.net

- **Model**: canvas (XML 기반 파일). 레이아웃/아이콘 라이브러리가 방대하다.
- **Licence / self-host**: 소스는 Apache 2.0. 아이콘·stencil·템플릿은 별도 조건(Atlassian 제품과 함께 쓰는 것 제한). 다이어그램 결과물에는 저작권 주장 없음. Docker 이미지(jgraph/docker-drawio)와 .war 배포, 데스크톱 앱 있음. 이 저장소는 "test version"이라 하고 프로덕션은 유료 버전을 안내한다. https://github.com/jgraph/drawio
- **협업**: 이 버전은 real-time collaborative editing 미지원. https://github.com/jgraph/drawio
- **AI**: self-hosted LLM 백엔드를 지정해 다이어그램을 생성하는 설정 문서가 있다. https://www.drawio.com/docs/reference/diagram-generation/configure-ai-options/
- **강점**: 오프라인/로컬 파일 중심, 거의 모든 다이어그램 유형, 파일이 곧 소스(git에 넣기 쉬움).
- **약점**: UI가 구식이고 "코드로 그리기"가 중심이 아니다. XML diff가 사람이 읽기 어렵다 (추정: 사용 경험 판단, 공식 자료로 판단할 수 없음).
- **가져올 아이디어**: 파일 하나 = 다이어그램 하나 + SVG/PNG에 소스를 심는 임베드 방식, 로컬 파일 우선 철학. 공식 문서: SVG는 "saves your diagram as a SVG image with embedded diagram data", PNG도 같다. https://www.drawio.com/doc/faq/save-file-formats `.drawio.svg`/`.drawio.png` 확장자 관행은 VS Code 확장 README가 "valid `.svg` files that can be embedded in Github readme"라고 설명한다. https://github.com/hediet/vscode-drawio

## 4. Mermaid (+ Mermaid Live)

- **Model**: code. 마크다운 친화적 텍스트 DSL. 시각 편집기는 기본 제공 안 함.
- **Licence / self-host**: MIT. 20종이 넘는 다이어그램 타입(Flowchart, Sequence, Class, State, ER, Gantt, Git Graph, Mindmap, Timeline, Sankey 등). GitHub Markdown에서 코드블록이 바로 렌더링된다. CLI와 HTTP server 관련 프로젝트가 있다. https://github.com/mermaid-js/mermaid
- **레이아웃**: v12.0.0부터 ELK가 내장되고 기본값이다("ELK is bundled and default from v12.0.0"). `layout: dagre`, cose-bilkent, tidy-tree도 고를 수 있다. npm 최신 12.3.0. https://github.com/mermaid-js/mermaid/blob/develop/docs/config/layouts.md
- **Mermaid Live Editor**: 브라우저 에디터 https://mermaid.live (공식 README가 언급, README 상단은 https://mermaid.ai/live/ 로도 링크). Self-host는 공식 Docker 이미지로 된다: `docker run ... ghcr.io/mermaid-js/mermaid-live-editor`, 직접 빌드도 가능. 라이선스 MIT. https://github.com/mermaid-js/mermaid-live-editor
- **AI**: 오픈소스 라이브러리에는 없다. 상용 서비스 mermaid.ai에 "Create with AI"와 MCP 서버, 실시간 공동 편집이 있다. https://mermaid.ai/
- **강점**: 사실상 표준. GitHub/문서도구/LLM이 모두 이미 안다. Miro도 Mermaid 코드를 편집 가능한 도형으로 가져오고 코드를 원본으로 유지한다고 한다. https://help.miro.com/hc/en-us/articles/7004628130962-Create-Mermaid-diagrams
- **약점**: 레이아웃 제어가 약하다(노드 위치 고정 불가), 큰 다이어그램에서 지저분해진다 (추정: 일반적 평판. 엔진 선택은 되지만 위치 고정 기능은 레이아웃 문서에서 못 찾음). 캔버스 편집 없음.
- **가져올 아이디어**: Mermaid를 **import/export 호환 포맷**으로 반드시 지원. LLM이 가장 잘 쓰는 입력 형식이라 AI 연동 기본값으로 좋다 (추정: 비교 자료 없음).

## 5. D2

- **Model**: code. 선언형 DSL이고 소프트웨어 아키텍처 다이어그램에 초점.
- **Licence / self-host**: MPL 2.0. CLI는 로컬 실행, 플레이그라운드 https://play.d2lang.com (소스 d2lang/d2-playground). https://github.com/terrastruct/d2
- **엔진**: 세 엔진을 번들한다. 기본 Dagro(Dagre Go 포트), elk-go(ELK Go 포트), opt-in TALA(아키텍처용 레이아웃·엣지 라우팅, `--layout=tala`). https://github.com/terrastruct/d2
- **TALA 라이선스**: 2026-09에 D2 저장소로 들어왔다(커밋 "open source TALA", `d2layouts/d2talalayout`). README: "TALA does not carry a separate primary license in D2", D2 저장소 라이선스(MPL-2.0)를 따른다. https://github.com/terrastruct/d2/tree/master/d2layouts/d2talalayout 단, 예전 별도 저장소 README는 아직 "TALA is closed-source", "paid layout engine"이라고 적혀 있어 출처끼리 다르다. https://github.com/terrastruct/TALA
- **기능**: themes, sketch mode(rough-go), sequence diagram, grid 레이아웃. 출력 SVG, PNG, GIF, PDF, PPTX. https://github.com/terrastruct/d2
- **강점**: 문법이 깔끔하고 레이아웃 엔진을 갈아 끼울 수 있다. 테마와 스케치 모드가 기본이다. GIF 애니메이션 출력.
- **약점**: 생태계가 Mermaid보다 작다. 캔버스 편집기는 없다 (추정: 오픈소스 D2 README에는 없음. 상용 D2 Studio https://d2studio.ai 는 JS로만 그려지는 페이지라 기능을 확인 못 함).
- **가져올 아이디어**: **레이아웃 엔진 플러그인 구조**(dagre ↔ elk ↔ 커스텀), 렌더러와 문법 분리, 테마 파일.

## 6. PlantUML

- **Model**: code. UML 중심.
- **Licence / self-host**: 기본 GPL, 그 외 LGPL, Apache, EPL, MIT 빌드가 있고 DITAA 같은 일부 기능은 빠진다. Java 필요, 일부 레이아웃은 Graphviz 필요. 공개 서버는 저장은 안 하지만 HTTP이므로 민감한 내용은 로컬 서버를 권장하고, jar에 작은 웹서버(picoweb)가 내장돼 있다. https://plantuml.com/faq
- **Graphviz**: usecase, class, object, component, deployment, state, legacy activity만 필요하고 "For all other diagrams, GraphViz is not needed". Windows 1.2020.21부터 작은 dot.exe를 jar에 같이 넣는다. https://plantuml.com/graphviz-dot Java 포트 Smetana(`!pragma layout smetana`)로 Graphviz 없이도 된다. https://plantuml.com/smetana02
- **다이어그램 종류**: Sequence, Use Case, Class, Activity, Component, State, Deployment, Gantt, MindMap, WBS, JSON, YAML 등. https://plantuml.com/faq
- **강점**: 가장 오래되고 UML 커버리지가 넓다. 로컬 서버 모드가 있다.
- **약점**: Java가 필요해서 설치가 무겁다(Graphviz는 일부 다이어그램만, Smetana로 대체 가능). 결과물이 구식으로 보이기 쉽다 (추정: 주관적 평가). 협업/GUI 없음.
- **가져올 아이디어**: "프라이버시 때문에 로컬 서버를 쓰라"는 포지션 자체. `@startuml` 스타일의 텍스트 한 덩어리 → URL 인코딩 렌더링 방식. 공식 Text Encoding은 텍스트를 압축해 숫자·문자·`_`·`-`만으로 바꾸고, 목적은 "to facilitate communication of diagrams through URL". https://plantuml.com/text-encoding

## 7. Structurizr

- **Model**: code, 단 "모델 + 뷰" 구조. 하나의 모델에서 여러 아키텍처 다이어그램을 만든다. C4 model의 reference implementation. https://docs.structurizr.com/
- **Licence / self-host**: "All Structurizr commands are free to use except for server", server는 prebuilt binary로 쓸 때 라이선스가 필요하다. https://docs.structurizr.com/
- **local 명령 (예전 Lite)**: "free and open source", "equivalent to the previous Structurizr Lite". `workspace.dsl`/`workspace.json`을 읽고 파일을 고치면 브라우저 새로고침에 반영된다. localhost 접속만 되고 인증·협업 기능은 없다. https://docs.structurizr.com/local
- **server 가격**: 설치당, 연간 고유 사용자 수 기준. 1-20명 £300/월 ~ 1001명 이상 £2,400/월, 연 단위 청구, 14일 체험. https://docs.structurizr.com/server/pricing
- **AI / 내보내기**: 문서 목차에 "AI + MCP"(DSL generation, MCP server)와 PlantUML/Mermaid 내보내기가 있다. https://docs.structurizr.com/
- **강점**: 모델(요소·관계)과 뷰(어떤 걸 보여줄지)를 분리해서 일관성이 유지된다. 컨텍스트→컨테이너→컴포넌트로 줌 인.
- **약점**: C4에 특화돼서 범용 플로차트/ERD에는 안 맞는다. 학습 비용이 있다 (추정: 주관적 판단).
- **가져올 아이디어**: **단일 모델 → 다중 뷰**. 한 번 정의한 서비스·DB를 여러 다이어그램에서 재사용하고, 이름을 바꾸면 전부 갱신. 이건 Eraser 쪽에서도 약한 부분일 수 있다 (추정, 01/02 문서와 교차 확인 필요).

## 8. Whimsical

- **Model**: canvas. flowchart, wireframe, mind map, doc 등을 빠르고 단정하게 그리는 제품. 클라우드 SaaS.
- **Licence / self-host**: 상용 (미확인: 공식 가격 페이지에 self-host/on-prem 언급이 없음).
- **가격**: Free $0: "Create up to 50 board objects per month", 월 50 doc blocks, 내보내기 워터마크, 7일 버전 기록, 멤버당 10 AI credits. Pro $10/editor/월(연간) 또는 $12(월간). Business $20(연간) 또는 $24(월간). 뷰어는 무료. https://whimsical.com/pricing 예전 도움말의 "3 collaborative boards + 100 AI actions"는 지금 가격 페이지와 다르다. https://help.whimsical.com/billing/pricing
- **AI/에이전트**: AI Flowcharts, AI Mind maps, AI Wireframes, 그리고 "Skills — Let your AI agent build Whimsical boards for you". https://whimsical.com/pricing
- **강점**: 속도와 깔끔함, 단순한 단축키. (추정: 일반 평판)
- **약점**: 코드 기반 입력이 중심이 아님. Docs 제품은 있지만 개발자 문서·코드 저장소와의 결합은 약함 (추정: 사용 경험 판단).
- **가져올 아이디어**: "키보드만으로 노드 추가→연결" 같은 극단적으로 빠른 조작감.

## 9. Miro

- **Model**: both에 가깝다. 무한 캔버스 화이트보드가 본체이고, Mermaid 코드를 편집 가능한 도형으로 만들며 코드가 그대로 유지된다고 소개한다. 보드에서 시각 편집하면 Mermaid 코드가 갱신된다는 설명도 있다(일본어 제품 페이지 기준). https://miro.com/ja/diagramming/what-is-mermaid/
- **AI**: flowchart, UML, ER, Mermaid 생성. Miro MCP 서버로 Cursor/Claude Code 같은 도구가 보드에 쓸 수 있고, Enterprise는 관리자가 MCP를 켜야 한다. 모든 플랜에서 크레딧 방식. https://help.miro.com/hc/en-us/articles/7004628130962-Create-Mermaid-diagrams
- **Licence / self-host**: 클라우드 SaaS. 공식 가격표에는 self-host 없이 "Regional data hosting"(EU, US, AU, JP 데이터 보관)만 있다. https://miro.com/pricing/ (미확인: "self-host 불가"라는 공식 문구는 못 찾음).
- **강점**: 협업 규모, 워크숍/브레인스토밍, 거대한 생태계.
- **약점**: 무겁고 범용이라 "기술 문서 + 다이어그램" 흐름에는 과하다 (추정: 사용 경험 판단). 로컬 사용 불가.
- **가져올 아이디어**: **코드 ↔ 시각 양방향 동기화**, 에이전트가 보드를 편집하는 MCP 인터페이스.

## 10. Lucidchart

- **Model**: canvas + 데이터 연결. 엔터프라이즈 다이어그램 도구.
- **Licence / self-host**: 상용 SaaS (미확인: lucid.co 페이지가 자동 요청에 403을 돌려줘서 이번에 확인 못 함).
- **기능**: ERD 템플릿과 SQL DB import(MySQL, Oracle, PostgreSQL, SQL Server 마케팅 페이지 기준). 도움말은 Free 플랜 포함이라고 하나 커뮤니티에는 사라졌다는 보고도 있다. https://help.lucid.co/hc/en-us/articles/16471565238292 , https://community.lucid.co/product-questions-3/bug-unable-to-click-import-your-data-when-creating-erd-9932
- **데이터 링크**: Google Sheets, Excel, CSV를 도형에 연결. https://lucid.co/blog/automate-your-work-with-lucidchart
- **가격**: 출처별 상이(Individual 약 $9/월, Team 약 $10/user/월 등). https://costbench.com/software/diagramming/lucidchart/free-plan/ (미확인: 제3자 자료이고, 공식 가격 페이지는 자동 요청에 403이라 재확인 못 함).
- **강점**: 데이터 기반 다이어그램, 엔터프라이즈 기능.
- **약점**: 무료 한도 작음(문서 수, 객체 수), 폐쇄형.
- **가져올 아이디어**: **실제 DB 스키마/데이터에서 다이어그램 자동 생성** (로컬 도구라면 로컬 DB·코드 저장소 직접 연결이 더 쉽다, 추정: 설계 판단).

---

## 11. Feature matrix

범례: ● 있음(출처 확인), ◐ 부분/조건부, ○ 없음 또는 근거 못 찾음, ? 미확인

| 도구 | Model | 라이선스 | Self-host | 코드 DSL | 캔버스 편집 | 코드↔캔버스 | 실시간 협업 | 자동 레이아웃 | AI 생성 |
|---|---|---|---|---|---|---|---|---|---|
| Excalidraw | canvas | MIT | ● | ○ | ● | ◐ (Mermaid import) | ● | ○ | ◐ (excalidraw.com/Plus, OSS 패키지 아님) |
| tldraw | canvas SDK | 자체 license (프로덕션 키) | ◐ (sync 가능) | ○ | ● | ○ | ● | ○ | ◐ (AI 프리미티브, Agent kit) |
| draw.io | canvas | Apache 2.0 (아이콘 별도) | ● | ○ | ● | ○ | ○ (이 저장소 기준) | ◐ | ◐ (자체 LLM 설정) |
| Mermaid | code | MIT | ● | ● | ○ | ○ | ○ | ● (v12부터 ELK 기본) | ◐ (상용 mermaid.ai) |
| D2 | code | MPL 2.0 (TALA 포함, 2026-09~) | ● | ● | ○ | ○ | ○ | ● (dagre/ELK/TALA) | ? |
| PlantUML | code | GPL 등 다중 | ● (Java) | ● | ○ | ○ | ○ | ● (Graphviz/Smetana) | ? |
| Structurizr | code (model+views) | 대부분 무료, server는 라이선스 | ◐ (local은 localhost만) | ● | ○ | ○ | ? | ◐ | ◐ (DSL generation, MCP) |
| Whimsical | canvas | 상용 | ○ (근거 못 찾음) | ○ | ● | ○ | ● | ◐ | ● |
| Miro | both | 상용 | ○ (미확인) | ◐ (Mermaid) | ● | ● | ● | ◐ | ● |
| Lucidchart | canvas | 상용 | ? | ○ | ● | ○ | ● | ◐ | ? |

`?`는 이번 조사에서 해당 칸을 확인하지 못했다는 뜻이다. 없다는 뜻이 아님.

---

## 12. 로컬 Eraser형 도구가 차별화할 수 있는 지점

공백을 먼저 보면, 위 표에서 **"코드 DSL + 캔버스 편집 + 코드↔캔버스 동기화 + self-host"**가 동시에 켜진 칸이 없다. Miro가 가장 가깝지만 클라우드 전용이다(추정: 공식 가격표에 self-host 없음, 지역 데이터 호스팅만 있음). (이 문장은 위 표 기준의 추정이며, Eraser 자체는 01/02 문서가 다룬다.)

차별화 후보를 우선순위로 정리한다.

1. **로컬 우선 + 파일이 곧 소스.** 프라이버시 때문에 PlantUML이 로컬 서버를 권하는 것과 같은 논리. 다이어그램을 git 저장소 안 텍스트 파일로 둔다. 데이터가 밖으로 안 나간다.
2. **코드 ↔ 캔버스 양방향.** Mermaid/D2식 코드를 쓰다가 자리만 마우스로 옮기고, 위치는 별도 레이어(코드 옆 메타)에 저장. Excalidraw는 단방향 import뿐이다.
3. **단일 모델 → 다중 뷰 (Structurizr 아이디어).** 노드를 한 번 정의해 여러 다이어그램에 재사용.
4. **레이아웃 엔진 교체 (D2 아이디어).** dagre/ELK를 옵션으로, 위치 고정 핀 지원.
5. **로컬 에이전트 연동.** MCP나 파일 감시로 AI가 파일을 편집하면 화면이 바로 갱신. Miro의 MCP 방식이 선례. (이 저장소의 Draw-Pipelines 아이디어와도 맞닿음, 추정.)
6. **Mermaid/D2/draw.io import·export.** 기존 자산을 가져올 수 있어야 진입 장벽이 낮다.

피해야 할 것:
- 범용 화이트보드로 Miro/Excalidraw와 정면 경쟁 (추정: 규모 싸움에서 불리).
- tldraw를 라이선스 확인 없이 업무에 쓰는 것. 배포하지 않아도 production 사용이면 걸린다([08](08-spike-oss.md) §7).
- PlantUML식 무거운 런타임 의존성(Java, 일부 다이어그램은 Graphviz).

## 13. 미해결/후속 확인

- 해결: tldraw 라이선스 조건은 원문으로 [08](08-spike-oss.md) §7에서 판정했어요. 남은 건 "사내 업무 사용이 Development Environment인가"를 tldraw에 서면 확인하는 일뿐이에요. 가격은 비공개("Value-based pricing").
- Lucidchart 현재 공식 가격, 무료 한도, self-host 여부 (공식 페이지가 자동 요청에 403).
- D2 TALA: D2 저장소 쪽 README와 예전 TALA 저장소 README가 서로 달라요. 바이너리 배포판에 워터마크가 남는지는 직접 실행해 봐야 해요.
- 해결: Whimsical 가격(위 8절), Structurizr local(예전 Lite) 동작 방식(위 7절), Mermaid Live Editor self-host(위 4절).
