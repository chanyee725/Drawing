# Eraser 리서치 요약 (00)

> 01~08을 대조해 상충 주장과 바뀐 결론을 한곳에 모았어요. 01~08 본문은 고치지 않았고, 어긋난 곳은 아래 표에만 적었어요.
> 기준일: 2026-11-12. 표기: **채택** = 근거가 가장 강한 쪽을 따라요, **보류** = 둘 다 맞을 수 있어 결정을 미뤄요, **미확인** = 근거가 없어요.
> 이 문서는 새 웹 조사를 하지 않고, 01~08 본문과 각 파일의 재확인 커밋(`git log docs/eraser-summary` 및 두 브랜치)에 적힌 근거만 썼어요. 법률 검토가 아니에요.

## 1. 전제

- 이 도구는 **내부 전용·비배포**예요. 판매·배포하지 않고 회사 밖에 노출하지 않아요.
- 브랜드(상표·트레이드 드레스) 위험은 이 전제에서 낮아요. 그래서 **디자인을 Eraser처럼 닮게 만드는 것은 막지 않아요** (배치·색 팔레트·폰트 조합·톤). 근거: [03](03-build-local.md) §5.
- 그래도 **실제 자산 파일의 복제는 계속 피해요**: 아이콘·일러스트·폰트 파일·비공개 코드. 복제는 배포 여부와 상관없이 권리자 허락이 필요한 행위라서요. 이름·로고·워드마크·파비콘도 쓰지 않아요.
- 예외로 쓸 수 있는 것: Eraser가 MIT로 공개한 eraser-diagrams 코드(저작권 고지 유지), 각 원 배포처에서 받는 OFL 폰트. 4,000개 아이콘 세트는 조건이 공개돼 있지 않아요.

## 2. 상충 주장 판정 표

| # | 주장 A (파일) | 주장 B (파일) | 판정 | 근거 |
|---|---|---|---|---|
| 1 | 가격 페이지: Publicly editable files가 Free에도 "Included" ([01](01-product-ui.md) §1.5·§1.7 재확인) | docs: Publicly editable은 유료 전용 ([01](01-product-ui.md) §1.5, sharing-a-file) | **미확인** | 둘 다 2026-11-12 현재 원문이라 오래된 캐시 탓이 아니에요. 어느 쪽이 실제 동작인지는 계정으로 시험해야 해요. <https://www.eraser.io/pricing>, <https://docs.eraser.io/sharing-a-file.md> |
| 2 | 가격 페이지: 유료 "Unlimited version history" ([01](01-product-ui.md) §1.7, [02](02-diagram-as-code-ai.md) "버전 기록: 유료 무제한") | docs: 유료 90일 ([01](01-product-ui.md) §6.3) | **미확인** | Free 7일은 양쪽이 같아요. 유료 보존 기간만 어긋나요. <https://www.eraser.io/pricing>, <https://docs.eraser.io/version-history.md> |
| 3 | sharing-a-file: Private file에는 link access 설정 4종이 없음 ([01](01-product-ui.md) §1.5) | private-files: **Share to Web** 토글로 public link 공유 가능 ([01](01-product-ui.md) §1.5) | **보류** | 서로 다른 장치를 말하는 것으로 보여요(링크 접근 *설정* vs 웹 공유 *토글*). 두 장치의 관계는 공식 문서에 명시가 없어요. 이 프로젝트에는 영향이 작아서 보류해요. <https://docs.eraser.io/private-files.md>, <https://docs.eraser.io/sharing-a-file.md> |
| 4 | `rough` 글꼴의 실제 이름은 공개 docs에 없음 ([04](04-visual-design.md) §14), 04:130은 동일 폰트 대신 대체재를 권고 | `typeface: rough`는 Shantell Sans ([03](03-build-local.md) §1) | **채택** (공개 렌더러 기준 Shantell Sans) / **앱 동일 여부 미확인** | 채택: 공개 렌더러 eraser-diagrams 소스가 `rough`를 Shantell Sans(OFL)로 매핑해요. 미확인: Eraser 앱이 같은 글꼴인지는 확인된 바 없어요. 04 본문은 아직 "이름 미확인"이라고 적혀 있어요. 04:130의 대체재 권고는 03 §5 개정판으로 대체돼요. 소스 파일: `packages/diagrams/src/fonts/eraserFonts.ts` (`roles: { rough: 'ShantellSans' }`, <https://github.com/eraserlabs/eraser-diagrams> 안) |
| 5 | elkjs 라이선스: "EPL-2.0" ([03](03-build-local.md) 컴포넌트 표) | "EPL-2.0 OR GPL-3.0-or-later" ([08](08-spike-oss.md) §2·§3·§7) | **채택** (08) | 표기만 달라요. 03 본문도 "EPL-2.0에 Secondary License로 GPL-3.0+"라고 해서 08과 같은 내용이에요. 사내 비배포면 두 쪽 모두 의무가 사실상 없어요. `npm view elkjs license`, <https://github.com/kieler/elkjs/blob/master/LICENSE.md> |
| 6 | tldraw: "로컬 개인 도구는 괜찮고 배포하면 걸림" ([06](06-alternatives.md) 이전 판) | tldraw: 걸리는 건 배포가 아니라 **production 사용**이라 내부 업무용도 걸릴 수 있음 ([08](08-spike-oss.md) §7.2) | **채택** (08) | 원문 LICENSE.md가 "Not to use the Software in Production Environments"이고, 예외는 "internal development"뿐이에요. 06과 03 표는 이미 08에 맞춰 고쳐졌어요. 남은 건 "end users에 직원이 들어가는가"인데 원문에 정의가 없어서 그 부분은 미확인이에요. <https://github.com/tldraw/tldraw/blob/main/LICENSE.md> |
| 7 | "화면 룩앤필을 그대로 따라 하면 trade dress 소지, 비주얼은 자체 스타일로" ([03](03-build-local.md) §5 이전 판, [04](04-visual-design.md) §14 "그대로 복제 피함", 줄 129). 같은 계열: 04:128 시그니처 색·브랜드 액센트를 그대로 쓰지 않음(04 §7에서 #2866df를 이미 찾았는데 "미확인"이라 적혀 있어요), 04:130 동일 폰트 대신 OFL 대체재, 04 §6 클론 제안(Excalifont·Virgil·Caveat), 04:124·125 헤딩 "교체해야 하는 브랜드 식별 요소" | 내부 전용이면 상표·트레이드 드레스 위험이 크게 낮고 닮게 만드는 건 막지 않음. 자산 파일 복제만 금지 ([03](03-build-local.md) §5 개정판) | **채택** (03 개정판) | 사용자가 확정한 전제(내부 전용·비배포)와 Eraser 약관 문구 "trademarks and trade dress may not be used in connection with any product or service" 기준이에요. 04의 "그대로 복제 피함" 문구는 개정 전 판이라 이 판정이 우선해요. 04 §14 중 이름·로고·파비콘·일러스트 금지만 유효하고, 색·글꼴·조합 관련 줄은 03 §5 개정판이 우선해요. 사용자가 공개 범위를 바꾸면 다시 봐야 해요. <https://www.eraser.io/terms> |
| 8 | REST `diagramType`에 DSL 5종뿐이고 `freeform-diagram`은 목록에 없음 ([02](02-diagram-as-code-ai.md) §5) | 에디터에서는 `/` → Freeform으로 만들 수 있음 ([01](01-product-ui.md) §3.1) | **API 범위 미확인** (상충 아님) | 두 말은 서로 부정하지 않아요. 에디터에서 되는 것과 REST가 지원하는 범위는 따로 봐야 해요. 실제 API 호출(유료 토큰 필요)로만 확인돼요. <https://docs.eraser.io/freeform-diagrams.md> |
| 9 | 한 정리글이 "Git 추적은 Eraser가 draw.io보다 낫다"는 의견을 전함 ([07](07-user-voice.md) 이전 판) | 원문 가이드에는 그 문장이 없고 일반론(diagram-as-code는 Git diff 가능)만 있음 ([07](07-user-voice.md) 재확인) | **채택** (원문) | 원문에 없는 주장이라 근거 없음으로 낮췄어요. <https://www.eraser.io/guides/best-diagram-as-code-tools-in-2025> |
| 10 | 검색 요약: Eraser의 "Atlassian 인수" ([07](07-user-voice.md)) | Atlassian Marketplace: "Eraser for Confluence by Eraser", "Partner Supported", 인수 언급 없음 ([07](07-user-voice.md)) | **미확인** | 인수를 뒷받침하는 자료는 찾지 못했어요. 반증도 아니라서(목록 페이지에 언급이 없을 뿐) "아니다"라고 단정하지 않고 쓰지 않기로 해요. <https://marketplace.atlassian.com/apps/1232673> |

## 3. 이전 → 바뀐 결론 표

이번 재확인 커밋(`338685f`, `cade532`, `7b5da94`, `d5e16e9`, `a82e7a0`, `963ec23`, `cea5506`, `1d0cf90`, `12561af`, `1ce537e`)에서 결론이 바뀐 항목만 모았어요.

| # | 이전 결론 | 바뀐 결론 | 근거 파일 |
|---|---|---|---|
| 1 | 가격 페이지가 Free도 "Yes"인 건 오래된 캐시일 수 있음 (추정) | 직접 받아 보니 현재 페이지가 그래요. 추정이 틀렸고 충돌은 유효해요 | [01](01-product-ui.md) §1.7 |
| 2 | 역할은 member와 team admin 둘뿐 | admin / member / guest 3종. guest는 파일 단위로 읽기·쓰기·댓글 | [01](01-product-ui.md) §1.5 |
| 3 | Private file: link 접근 없음 vs public web link 가능, 정확한 동작 미확인 | 서로 다른 장치(설정 4종 vs Share to Web 토글)로 보임. 관계는 여전히 미확인 | [01](01-product-ui.md) §1.5 |
| 4 | flowchart `shape`는 4종(rectangle·diamond·oval·cylinder) | 12종 | [02](02-diagram-as-code-ai.md) §2·§3 |
| 5 | 전역 스타일은 그 줄 이후 요소에 적용 | `wrap`·`connectorStyle`만 원문으로 확인. 나머지 전역 스타일은 문서에 없음. ERD는 `direction` 자체가 없고, 속성 `:`가 없으면 관계가 빠짐 | [02](02-diagram-as-code-ai.md) §2·§3 |
| 6 | 렌더러 종류·손그림 라이브러리·`rough` 글꼴·레이아웃 엔진 모두 미확인/추정 | 공개 렌더러 eraser-diagrams(MIT, 2026-09): HTML+CSS에 SVG 선, 손그림 라이브러리 없음, `rough`=Shantell Sans. 블로그가 "deterministic layout engines like ELK"라고 써요(앱 자체는 미확인) | [03](03-build-local.md) §1 |
| 7 | Eraser UI 글꼴·색은 미확인 | 마케팅 사이트 CSS에 `Inter var`, `--blue-primary: #2866df`가 있어요. 에디터 앱 값인지는 미확인 | [04](04-visual-design.md) §6·§7 |
| 8 | sticky note·freehand는 미확인 | 공개 docs 89쪽에서 0건이라 "없음에 가까움". 에디터를 직접 못 봐서 표시는 미확인 유지 | [01](01-product-ui.md) §3.2·§3.4 |
| 9 | Git 추적에서 Eraser가 draw.io보다 낫다는 의견이 있음 | 원문에 없음. 근거 없음으로 낮춤 | [07](07-user-voice.md) |
| 10 | Eraser 룩앤필을 그대로 따라 하면 trade dress 소지. 비주얼은 자체 스타일로 | 내부 전용이면 위험이 낮아 막지 않음. 이름·로고·자산 파일 복제 금지는 유지 | [03](03-build-local.md) §5 |
| 11 | tldraw: 로컬 개인 도구는 괜찮고 배포하면 걸림, 컴포넌트 표에서 "조건부" | 걸리는 건 배포가 아니라 production 사용. 내부 전용이어도 제외 유지, 표는 "제외" | [06](06-alternatives.md), [03](03-build-local.md), [08](08-spike-oss.md) §7 |
| 12 | tldraw 5.6.0: "자체 라이선스(프로덕션은 키 필요)" 한 줄 | 원문 기준: 소스 공개, 오픈소스 아님, 기본 조건은 개발 환경 한정. 키 없이도 CDN에 35건 요청. Excalidraw는 외부 요청 0건 | [08](08-spike-oss.md) §2·§7 |
| 13 | Mermaid 레이아웃·Excalidraw/tldraw AI·가격은 일부 미확인 | Mermaid v12.0.0부터 ELK 기본, Excalidraw Free는 하루 10회 AI, tldraw는 금액 비공개(value-based) | [06](06-alternatives.md) |

## 4. 이 프로젝트(Draw-Pipelines)에 주는 결론

1. 내부 전용이니 Eraser처럼 보이는 화면을 만들어도 돼요. 단 이름·로고·아이콘·폰트·코드 파일은 복사하지 않아요.
2. 부품은 MIT 계열(Excalidraw 등)과 elkjs(사내 비배포면 의무 없음)를 쓰고, tldraw는 제외해요. 외부 요청이 0건인 쪽이 로컬 도구에 맞아요.
3. 손글씨체는 Shantell Sans 하나뿐이에요. 본문·코드용 Inter·JetBrains Mono와 함께 모두 원 배포처(OFL)에서 받아요.
4. 가격·플랜 수치(공개 편집, 버전 보존)는 이 도구의 설계에 쓰지 않아요. 충돌이 풀리지 않았어요.
5. 사용자가 공개 범위나 배포 계획을 바꾸면 1번과 2번을 다시 판정해요.

### 아직 미확인으로 남은 핵심 항목

1. Free 플랜의 Publicly editable 가능 여부, 유료 버전 기록 보존 기간 (표 #1, #2)
2. 에디터의 라이브 커서·presence UI, 줌/팬 단축키, snapping, sticky, freehand (로그인 뒤라 공개 자료에 없어요)
3. Eraser 앱 UI에 쓰는 실제 글꼴과 색 hex, 앱의 렌더러(canvas/SVG)와 동시 편집 방식(CRDT/OT)
4. tldraw의 "end users"에 사내 직원이 들어가는지 (tldraw 서면 확인 필요)
5. Eraser 아이콘 4,000개 세트와 클라우드 아이콘의 라이선스 조건
