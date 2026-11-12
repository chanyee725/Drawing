# 06. 대안 도구 비교 (Eraser 로컬 클론이 경쟁하거나 빌려올 것들)

조사일: 2026-11-12. 공개 자료만 사용. 로그인/가입 없음.
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
- **강점 (vs Eraser)**: 라이선스가 가장 관대하다. 임베드 쉬움. 손그림 느낌 때문에 "초안" 분위기가 나서 부담이 낮다.
- **약점**: 자동 레이아웃과 코드 → 다이어그램 모델이 없다. 문서(doc) 편집, 버전/diff 개념이 없다 (추정: README에 언급 없음).
- **가져올 아이디어**: (1) 요소를 JSON으로 저장하는 단순한 scene 포맷, (2) Mermaid → 편집 가능 요소 변환 경로, (3) 임베드 가능한 패키지 형태.

## 2. tldraw

- **Model**: canvas SDK. 에디터 자체가 아니라 "캔버스 엔진"에 가깝다.
- **Licence / self-host**: 자체 tldraw license. 개발 중에는 자유롭고 "Production use requires a license key". starter kit은 각각 MIT. 멀티플레이는 `@tldraw/sync`로 self-host 가능하고 starter kit은 Cloudflare Durable Objects 기반. https://github.com/tldraw/tldraw
- **강점**: 커스텀 shape, 도구, UI를 코드로 확장하기 가장 좋다. 실시간 동기화 레퍼런스가 있다.
- **약점**: 상용 사용 시 라이선스 키가 필요해서 "로컬 개인 도구"는 괜찮지만 배포·공유하면 걸린다. 정확한 조건은 tldraw.dev에서 확인해야 한다 (미확인: 가격/조건 상세).
- **가져올 아이디어**: 커스텀 shape를 1급으로 취급하는 확장 구조(예: 클라우드 아이콘 노드), 멀티플레이어 sync 레이어 분리.

## 3. draw.io / diagrams.net

- **Model**: canvas (XML 기반 파일). 레이아웃/아이콘 라이브러리가 방대하다.
- **Licence / self-host**: 소스는 Apache 2.0. 아이콘·stencil·템플릿은 별도 조건(Atlassian 제품과 함께 쓰는 것 제한). 다이어그램 결과물에는 저작권 주장 없음. Docker 이미지(jgraph/docker-drawio)와 .war 배포, 데스크톱 앱 있음. 이 저장소는 "test version"이라 하고 프로덕션은 유료 버전을 안내한다. https://github.com/jgraph/drawio
- **협업**: 이 버전은 real-time collaborative editing 미지원. https://github.com/jgraph/drawio
- **AI**: self-hosted LLM 백엔드를 지정해 다이어그램을 생성하는 설정 문서가 있다. https://www.drawio.com/docs/reference/diagram-generation/configure-ai-options/
- **강점**: 오프라인/로컬 파일 중심, 거의 모든 다이어그램 유형, 파일이 곧 소스(git에 넣기 쉬움).
- **약점**: UI가 구식이고 "코드로 그리기"가 중심이 아니다. XML diff가 사람이 읽기 어렵다 (추정).
- **가져올 아이디어**: 파일 하나 = 다이어그램 하나 + `.drawio.svg`/png에 소스를 심는 임베드 방식(추정: 널리 쓰이는 관행, 이번에 직접 검증 못함), 로컬 파일 우선 철학.

## 4. Mermaid (+ Mermaid Live)

- **Model**: code. 마크다운 친화적 텍스트 DSL. 시각 편집기는 기본 제공 안 함.
- **Licence / self-host**: MIT. 20종이 넘는 다이어그램 타입(Flowchart, Sequence, Class, State, ER, Gantt, Git Graph, Mindmap, Timeline, Sankey 등). GitHub Markdown에서 코드블록이 바로 렌더링된다. CLI와 HTTP server 관련 프로젝트가 있다. https://github.com/mermaid-js/mermaid
- **Mermaid Live Editor**: 브라우저 에디터 https://mermaid.live (공식 README가 언급). 저장소에 Docker 파일이 있음 (Live Editor 자체의 self-host 방식은 미확인).
- **강점**: 사실상 표준. GitHub/문서도구/LLM이 모두 이미 안다. Miro도 Mermaid 코드를 편집 가능한 도형으로 가져오고 코드를 원본으로 유지한다고 한다. https://help.miro.com/hc/en-us/articles/7004628130962-Create-Mermaid-diagrams
- **약점**: 레이아웃 제어가 약하다(노드 위치 고정 불가), 큰 다이어그램에서 지저분해진다 (추정: 일반적 평판, 이번에 검증 안 함). 캔버스 편집 없음.
- **가져올 아이디어**: Mermaid를 **import/export 호환 포맷**으로 반드시 지원. LLM이 가장 잘 쓰는 입력 형식이라 AI 연동 기본값으로 좋다 (추정).

## 5. D2

- **Model**: code. 선언형 DSL이고 소프트웨어 아키텍처 다이어그램에 초점.
- **Licence / self-host**: MPL 2.0. CLI는 로컬 실행, 플레이그라운드 https://play.d2lang.com (소스 d2lang/d2-playground). https://github.com/terrastruct/d2
- **엔진**: 기본 Dagre 포트, ELK 포트, 옵션으로 TALA(아키텍처용 레이아웃·엣지 라우팅). TALA의 라이선스는 해당 페이지에서 확인 못 함 (미확인; 별도 유료로 알려졌으나 이번에 검증 안 함).
- **기능**: themes, sketch mode(rough-go), sequence diagram, grid 레이아웃. 출력 SVG, PNG, GIF, PDF, PPTX. https://github.com/terrastruct/d2
- **강점**: 문법이 깔끔하고 레이아웃 엔진을 갈아 끼울 수 있다. 테마와 스케치 모드가 기본이다. GIF 애니메이션 출력.
- **약점**: 생태계가 Mermaid보다 작다. 캔버스 편집기는 없다 (추정).
- **가져올 아이디어**: **레이아웃 엔진 플러그인 구조**(dagre ↔ elk ↔ 커스텀), 렌더러와 문법 분리, 테마 파일.

## 6. PlantUML

- **Model**: code. UML 중심.
- **Licence / self-host**: 기본 GPL, 그 외 LGPL, Apache, EPL, MIT 빌드가 있고 DITAA 같은 일부 기능은 빠진다. Java 필요, 일부 레이아웃은 Graphviz 필요. 공개 서버는 저장은 안 하지만 HTTP이므로 민감한 내용은 로컬 서버를 권장하고, jar에 작은 웹서버(picoweb)가 내장돼 있다. https://plantuml.com/faq
- **다이어그램 종류**: Sequence, Use Case, Class, Activity, Component, State, Deployment, Gantt, MindMap, WBS, JSON, YAML 등. 같은 곳.
- **강점**: 가장 오래되고 UML 커버리지가 넓다. 로컬 서버 모드가 있다.
- **약점**: Java + Graphviz 의존성으로 설치가 무겁고, 결과물이 구식으로 보이기 쉽다 (추정). 협업/GUI 없음.
- **가져올 아이디어**: "프라이버시 때문에 로컬 서버를 쓰라"는 포지션 자체. `@startuml` 스타일의 텍스트 한 덩어리 → URL 인코딩 렌더링 방식(추정: 이번에 직접 확인 안 함).

## 7. Structurizr

- **Model**: code, 단 "모델 + 뷰" 구조. 하나의 모델에서 여러 아키텍처 다이어그램을 만든다. C4 model의 reference implementation. https://docs.structurizr.com/
- **Licence / self-host**: 명령 대부분 무료이고 prebuilt binary의 `server` 명령만 라이선스가 필요하다고 한다. https://docs.structurizr.com/ 로컬 실행용 Lite 등 세부는 해당 페이지에서 확인 못 함 (미확인).
- **강점**: 모델(요소·관계)과 뷰(어떤 걸 보여줄지)를 분리해서 일관성이 유지된다. 컨텍스트→컨테이너→컴포넌트로 줌 인.
- **약점**: C4에 특화돼서 범용 플로차트/ERD에는 안 맞는다. 학습 비용이 있다 (추정).
- **가져올 아이디어**: **단일 모델 → 다중 뷰**. 한 번 정의한 서비스·DB를 여러 다이어그램에서 재사용하고, 이름을 바꾸면 전부 갱신. 이건 Eraser 쪽에서도 약한 부분일 수 있다 (추정, 01/02 문서와 교차 확인 필요).

## 8. Whimsical

- **Model**: canvas. flowchart, wireframe, mind map, doc 등을 빠르고 단정하게 그리는 제품. 클라우드 SaaS.
- **Licence / self-host**: 상용, self-host 정보 없음 (미확인).
- **가격**: 무료 한도 설명이 출처마다 다르다. 구형: 3 collaborative boards + 100 AI actions, 신형: 월 50 board objects + 10 AI credits. Pro는 약 $10/editor/month. https://help.whimsical.com/billing/pricing, https://whimsical.com/pricing (현재 값은 공식 페이지 직접 확인 필요).
- **강점**: 속도와 깔끔함, 단순한 단축키. (추정: 일반 평판)
- **약점**: 코드 기반 입력이 중심이 아님. 개발자 문서와의 결합이 약함 (추정).
- **가져올 아이디어**: "키보드만으로 노드 추가→연결" 같은 극단적으로 빠른 조작감.

## 9. Miro

- **Model**: both에 가깝다. 무한 캔버스 화이트보드가 본체이고, Mermaid 코드를 편집 가능한 도형으로 만들며 코드가 그대로 유지된다고 소개한다. 보드에서 시각 편집하면 Mermaid 코드가 갱신된다는 설명도 있다(일본어 제품 페이지 기준). https://miro.com/ja/diagramming/what-is-mermaid/
- **AI**: flowchart, UML, ER, Mermaid 생성. Miro MCP 서버로 Cursor/Claude Code 같은 도구가 보드에 쓸 수 있고, Enterprise는 관리자가 MCP를 켜야 한다. 모든 플랜에서 크레딧 방식. https://help.miro.com/hc/en-us/articles/7004628130962-Create-Mermaid-diagrams
- **Licence / self-host**: 클라우드 SaaS. 공식 self-host 근거는 못 찾음 (미확인; 경쟁사 홍보 글만 "없다"고 주장).
- **강점**: 협업 규모, 워크숍/브레인스토밍, 거대한 생태계.
- **약점**: 무겁고 범용이라 "기술 문서 + 다이어그램" 흐름에는 과하다 (추정). 로컬 사용 불가.
- **가져올 아이디어**: **코드 ↔ 시각 양방향 동기화**, 에이전트가 보드를 편집하는 MCP 인터페이스.

## 10. Lucidchart

- **Model**: canvas + 데이터 연결. 엔터프라이즈 다이어그램 도구.
- **Licence / self-host**: 상용 SaaS (self-host 미확인).
- **기능**: ERD 템플릿과 SQL DB import(MySQL, Oracle, PostgreSQL, SQL Server 마케팅 페이지 기준). 도움말은 Free 플랜 포함이라고 하나 커뮤니티에는 사라졌다는 보고도 있다. https://help.lucid.co/hc/en-us/articles/16471565238292 , https://community.lucid.co/product-questions-3/bug-unable-to-click-import-your-data-when-creating-erd-9932
- **데이터 링크**: Google Sheets, Excel, CSV를 도형에 연결. https://lucid.co/blog/automate-your-work-with-lucidchart
- **가격**: 출처별 상이(Individual 약 $9/월, Team 약 $10/user/월 등). 신뢰 못 하고 공식 확인 필요. https://costbench.com/software/diagramming/lucidchart/free-plan/
- **강점**: 데이터 기반 다이어그램, 엔터프라이즈 기능.
- **약점**: 무료 한도 작음(문서 수, 객체 수), 폐쇄형.
- **가져올 아이디어**: **실제 DB 스키마/데이터에서 다이어그램 자동 생성** (로컬 도구라면 로컬 DB·코드 저장소 직접 연결이 더 쉽다, 추정).

---

## 11. Feature matrix

범례: ● 있음(출처 확인), ◐ 부분/조건부, ○ 없음 또는 근거 못 찾음, ? 미확인

| 도구 | Model | 라이선스 | Self-host | 코드 DSL | 캔버스 편집 | 코드↔캔버스 | 실시간 협업 | 자동 레이아웃 | AI 생성 |
|---|---|---|---|---|---|---|---|---|---|
| Excalidraw | canvas | MIT | ● | ○ | ● | ◐ (Mermaid import) | ● | ○ | ? |
| tldraw | canvas SDK | 자체 license (프로덕션 키) | ◐ (sync 가능) | ○ | ● | ○ | ● | ○ | ? |
| draw.io | canvas | Apache 2.0 (아이콘 별도) | ● | ○ | ● | ○ | ○ (이 저장소 기준) | ◐ | ◐ (자체 LLM 설정) |
| Mermaid | code | MIT | ● | ● | ○ | ○ | ○ | ● | ? |
| D2 | code | MPL 2.0 | ● | ● | ○ | ○ | ○ | ● (dagre/ELK/TALA) | ? |
| PlantUML | code | GPL 등 다중 | ● (Java) | ● | ○ | ○ | ○ | ● (Graphviz) | ? |
| Structurizr | code (model+views) | 대부분 무료, server는 라이선스 | ◐ | ● | ○ | ○ | ? | ◐ | ? |
| Whimsical | canvas | 상용 | ? | ○ | ● | ○ | ● | ◐ | ● |
| Miro | both | 상용 | ○ (미확인) | ◐ (Mermaid) | ● | ● | ● | ◐ | ● |
| Lucidchart | canvas | 상용 | ? | ○ | ● | ○ | ● | ◐ | ? |

`?`는 이번 조사에서 해당 칸을 확인하지 못했다는 뜻이다. 없다는 뜻이 아님.

---

## 12. 로컬 Eraser형 도구가 차별화할 수 있는 지점

공백을 먼저 보면, 위 표에서 **"코드 DSL + 캔버스 편집 + 코드↔캔버스 동기화 + self-host"**가 동시에 켜진 칸이 없다. Miro가 가장 가깝지만 클라우드 전용(추정)이다. (이 문장은 위 표 기준의 추정이며, Eraser 자체는 01/02 문서가 다룬다.)

차별화 후보를 우선순위로 정리한다.

1. **로컬 우선 + 파일이 곧 소스.** 프라이버시 때문에 PlantUML이 로컬 서버를 권하는 것과 같은 논리. 다이어그램을 git 저장소 안 텍스트 파일로 둔다. 데이터가 밖으로 안 나간다.
2. **코드 ↔ 캔버스 양방향.** Mermaid/D2식 코드를 쓰다가 자리만 마우스로 옮기고, 위치는 별도 레이어(코드 옆 메타)에 저장. Excalidraw는 단방향 import뿐이다.
3. **단일 모델 → 다중 뷰 (Structurizr 아이디어).** 노드를 한 번 정의해 여러 다이어그램에 재사용.
4. **레이아웃 엔진 교체 (D2 아이디어).** dagre/ELK를 옵션으로, 위치 고정 핀 지원.
5. **로컬 에이전트 연동.** MCP나 파일 감시로 AI가 파일을 편집하면 화면이 바로 갱신. Miro의 MCP 방식이 선례. (이 저장소의 Draw-Pipelines 아이디어와도 맞닿음, 추정.)
6. **Mermaid/D2/draw.io import·export.** 기존 자산을 가져올 수 있어야 진입 장벽이 낮다.

피해야 할 것:
- 범용 화이트보드로 Miro/Excalidraw와 정면 경쟁 (추정: 규모 싸움에서 불리).
- tldraw를 그대로 얹을 때 라이선스 조건 확인 없이 배포 (tldraw.dev 확인 필요).
- PlantUML식 무거운 런타임 의존성(Java+Graphviz).

## 13. 미해결/후속 확인

- tldraw 프로덕션 라이선스의 정확한 조건과 가격 (https://tldraw.dev).
- Whimsical, Lucidchart 현재 공식 가격과 무료 한도.
- D2 TALA 라이선스.
- Structurizr Lite 동작 방식과 라이선스.
- Mermaid Live Editor self-host 방식.
