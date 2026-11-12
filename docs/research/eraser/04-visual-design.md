# 04. Eraser Visual Design System (조사 노트)

> 범위: 레이아웃 비율, 사이드바/헤더, 타이포, 색, 캔버스, 도형/선, 아이콘, 상호작용 상태, 모션, empty state, onboarding.
> 방법: 공개 페이지만 사용 (로그인/가입 없음). 에디터 내부 화면은 공개 문서에 거의 없어서 **대부분 (미확인)** 또는 (추정)으로 표시했다.
> 표기: 출처 URL = 확인됨 / (미확인) = 공개 근거 없음 / (추정) = 일반적 패턴에서 추론.

## 0. 근거 수준 요약

- 확인된 것: 다이어그램 스타일 속성(`colorMode`, `styleMode`, `typeface`, `textSize`, `connectorStyle`), dark mode가 개인 설정이라는 점, 마케팅 사이트 구조, Custom styles의 Defaults 탭 항목.
- 확인 못 한 것: 정확한 px/hex/폰트 패밀리, 에디터 패널 폭, 모션 값, 선택 핸들 모양. (에디터는 로그인 뒤에 있고, 공개 docs 중 canvas/shortcuts 페이지는 404였다.)
- 따라서 아래 "수치" 항목은 **클론용 제안값**이지 Eraser의 실제 값이 아니다. 실제 값이 필요하면 사람이 직접 에디터 화면을 보고 확인해야 한다.

## 1. 전체 레이아웃 비율

- 마케팅 사이트: 상단 내비 바(Product, Solutions, Resources, Agents + "Log in" / "Try Eraser" 버튼) → 큰 hero 헤드라인 + CTA 2개 + 전폭 아키텍처 이미지 → 로고 줄 → 후기 → 기능 블록(텍스트와 스크린샷 교차 배치) → 엔터프라이즈 → 마지막 CTA → 푸터. 출처: https://www.eraser.io
- 에디터 (미확인, 2026-11-12 재확인에서도 레이아웃 근거 없음): 공개 문서는 "dashboard에서 Canvas 파일을 만든다", "캔버스에서 `/` 로 insert menu를 연다", "`⌘J`/`Ctrl+J`로 AI Diagram" 정도만 언급한다. 출처: https://docs.eraser.io/docs/quickstart
- (추정) 일반적인 구성: 왼쪽 파일 사이드바 + 가운데 캔버스(화면 대부분) + 오른쪽 선택적 패널(속성/코드/코멘트). 캔버스가 70~85%를 차지하는 비율.
- 클론 제안: 사이드바 240px(접으면 0), 헤더 48px, 오른쪽 패널 320px, 나머지는 캔버스.

## 2. 사이드바 / 파일 목록

- 일부 확인(2026-11-12): dashboard 왼쪽 **sidebar**에 "Folders" 항목과 "+" 버튼이 있고, 파일을 sidebar의 폴더로 드래그해 옮길 수 있다. 대시보드 단축키 `P`는 Private Files로 간다. Getting Started 페이지가 있고 개인 설정에서 숨길 수 있다. 출처: https://docs.eraser.io/folders.md , https://docs.eraser.io/private-files.md , https://docs.eraser.io/personal-settings.md 전체 레이아웃은 스크린샷을 못 봐서 (미확인).
- (추정) 파일 타입 아이콘, 최근 파일 섹션, 상단 검색 또는 새 파일 버튼. (폴더 sidebar는 위에서 확인됨.)
- 클론 제안: 행 높이 28~32px, 들여쓰기 12~16px, hover 시 배경 약간 진하게, 선택 행은 액센트색 연한 배경 + 왼쪽 2px 바.

## 3. 헤더

- 마케팅 헤더는 위 §1 참고. 에디터 헤더는 (미확인).
- (추정) 파일 이름, 공유 버튼, 협업자 아바타, 모드 전환(예: 문서/캔버스) 정도.
- 클론 제안: 높이 48px, 하단 1px 구분선, 좌측 파일명(인라인 편집), 우측 아바타 + 공유.

## 4. 패널 폭

- (미확인). Property bar가 존재한다는 것만 확인됨: "Connector style option in the property bar". 출처: https://docs.eraser.io/docs/styling
- 즉 선택한 객체의 속성을 바꾸는 **property bar**가 있다. 재확인: property bar에는 connector 화살촉·라우팅(elbow/straight/arc)과 "…" 메뉴(Copy/Paste As, Convert to freeform)가 있고, diagram toolbar에는 Verify가 있다. 출처: https://docs.eraser.io/freeform-diagrams.md 또 diagram-as-code 요소를 선택하면 **하단에 draggable edit 배너**(Reset Layout 버튼)가 뜬다. 출처: https://docs.eraser.io/draggable-edits-beta.md 이 바 자체의 위치(상단 부유 vs 패널)는 여전히 (미확인).
- 클론 제안: 선택 객체 위에 뜨는 부유 property bar(높이 40px) + 코드 패널(오른쪽, 리사이즈 가능, 기본 360px).

## 5. 간격 리듬 (spacing)

- (미확인). 클론 제안: 4px 기반 스케일 (4, 8, 12, 16, 24, 32, 48). 컴포넌트 내부 8~12px, 섹션 사이 24px 이상.

## 6. 타이포그래피

확인된 것 (다이어그램 안의 글꼴):
- `typeface`: `rough` (기본값, 손글씨 스타일), `clean` (sans serif), `mono` (고정폭).
- `textSize`: `small`(기본) / `medium` / `large`.
- `wrap`: `on`(기본) / `off`.
- 출처: https://docs.eraser.io/docs/styling

즉 **기본 다이어그램 글꼴이 손글씨체**라는 점이 Eraser의 핵심 시각 특징이다.

UI 글꼴: 마케팅 사이트의 CSS에 `font-family: 'Inter var', Inter, system-ui, sans-serif`가 있다(2026-11-12 직접 받은 HTML/CSS 기준). 출처: https://www.eraser.io , https://www.eraser.io/_astro/_slug_.CVKwa36s.css (파일명은 빌드마다 바뀜). Inter는 OFL 폰트로 알려져 있지만 이 문서에서 라이선스 원문은 확인하지 않았다 (미확인). 에디터 앱 UI 폰트와 크기는 로그인 뒤라 (미확인). (추정) 모던 geometric/grotesque sans.
- 클론 제안: UI는 시스템 sans(Inter 등 OFL 폰트) 13px/14px 본문, 12px 보조, 600 weight 제목. 다이어그램용 손글씨체는 OFL 라이선스 폰트(Excalifont, Virgil, Caveat 등)를 쓰고 라이선스를 확인한다.

## 7. 색 팔레트 (light / dark)

확인된 것:
- 다이어그램 `colorMode`: `pastel`(기본, 밝은 채움) / `bold`(진한 채움) / `outline`(투명 채움). 노드에 `color: green` 같은 이름 색을 쓴다. 출처: https://docs.eraser.io/docs/styling
- Dark mode는 **개인 설정**이며 파일 설정이 아니다. 같은 파일을 한 사람은 dark, 다른 사람은 light로 볼 수 있다. 계정 설정의 Appearance 페이지에서 바꾼다. 출처: https://docs.eraser.io/docs/dark-mode
- 구현 시사점: 파일에는 테마가 저장되지 않고 렌더러가 테마별로 색을 해석해야 한다. (추정) 노드 색은 이름 토큰으로 저장하고 모드별 값을 매핑한다.

일부 확인: 마케팅 사이트 CSS에 변수 `--blue-primary: #2866df`가 있다(출처: 위 CSS URL). 이 변수가 로고·버튼 중 어디에 쓰이는지, 에디터에도 쓰이는지는 (미확인)이라 "브랜드 액센트"로 단정하지 않는다. 노드 색 이름은 freeform 포맷 문서에 `white, yellow, green, blue, purple, red, orange, black` 또는 임의 CSS 색으로 나온다(출처: https://docs.eraser.io/freeform-diagram-format.md). 각 이름의 hex, 배경색은 (미확인).

클론 제안 사용 규칙:
| 역할 | 사용처 |
|---|---|
| Surface | 앱 배경, 캔버스 배경 |
| Elevated | 사이드바, 패널, 팝오버 |
| Border | 1px 구분선 |
| Text / Text-muted | 본문 / 보조 |
| Accent | 선택, 포커스, 주요 버튼 (자체 브랜드색) |
| 노드 팔레트 8~10색 | pastel/bold/outline 3모드 각각의 값 세트 |

## 8. 캔버스 배경 / 그리드

- (미확인, 재확인). 공개 docs 89쪽에 캔버스 그리드·snap 언급 없음(`grid` 검색 결과가 CSS 예시뿐).
- 클론 제안: 점 그리드(간격 20px, 낮은 대비) 토글 가능, 줌에 따라 점 밀도 단계 조절, 스냅 옵션.

## 9. 도형 / 선 스타일 (sketchy vs clean)

확인된 것:
- `styleMode`: `shadow`(기본, 노드/그룹 뒤 그림자) / `plain`(그림자와 watercolor 제거) / `watercolor`(수채화 느낌). 출처: https://docs.eraser.io/docs/styling
- `connectorStyle`: `elbow`(기본, 직각) / `straight` / `arc`(곡선). cloud architecture와 flow chart에만 적용. 같은 노드 자기 연결, 노드와 소속 그룹 연결, 같은 두 노드 사이 복수 연결은 항상 elbow. 출처: 같은 페이지
- Custom styles의 Defaults 탭: Shape(corners, border style/thickness, alignment, icon size, typeface, font size), Group/lane/pool(title width, border…), Icon, Textbox, Divider(line style, thickness), Relationship(connector style, line style/thickness, 시작/끝 arrowhead, label size). 출처: https://docs.eraser.io/custom-styles
- 해석: "sketchy"는 필터가 아니라 **글꼴(rough) + styleMode(watercolor/shadow)** 조합으로 표현되며, `clean` + `plain`으로 깔끔한 모드가 된다. 선 자체의 흔들림(roughness) 여부는 (미확인).
- 도형 모서리 둥글기는 Defaults 탭에서 조절 가능(corners). 기본값은 (미확인). 참고로 custom style 예시 문구에 "Prefer rounded rectangles"가 있어 둥근 사각형이 흔한 형태임을 시사하지만 기본값 근거는 아니다. 출처: https://docs.eraser.io/custom-styles.md

클론 제안: 프리셋 2개 ("Sketch": 손글씨 + 그림자, "Clean": sans + plain)와 Defaults 패널을 만든다. 우리 프로젝트는 draw.io 파일이 대상이므로 draw.io의 `sketch=1` 스타일과 매핑하는 방안도 있다 (추정).

## 10. 아이콘 스타일

- 마케팅 사이트: 도구 로고(SAP, Kafka, EKS, Stripe 등)를 작은 SVG로 사용. 구분용 장식 글리프 "››››" / "‹‹‹‹"를 쓴다. 출처: https://www.eraser.io
- 에디터 UI 아이콘 선 굵기/스타일 (미확인). (추정) 얇은 outline 아이콘 세트.
- 다이어그램 안 아이콘: 클라우드/기술 아이콘은 노드에 붙는 `icon` 속성으로 쓰고 크기는 Defaults에서 조절 (Icon size).
- 클론 제안: UI는 Lucide(ISC) 같은 permissive outline 세트, 1.5px stroke, 16/20px 그리드. 기술 로고는 Simple Icons/각 벤더 공식 아이콘 라이선스를 확인.

## 11. 선택 핸들 / hover / focus

- (미확인, 재확인). docs 89쪽에 선택 핸들 모양 기술 없음(draggable edit 문서는 "move or resize"만 말함: https://docs.eraser.io/draggable-edits-beta.md ).
- 클론 제안: 선택 시 액센트 1.5px 외곽선 + 모서리 8px 사각 핸들(흰 채움), 회전 핸들은 위쪽, hover는 1px 외곽선 프리뷰, 키보드 포커스는 2px focus ring + 2px offset. 연결점(anchor)은 hover 시에만 노출.

## 12. 모션 / 애니메이션

- (미확인, 재확인). 마케팅 사이트 CSS(약 30KB)에는 `transition-duration` 값이 없고 `prefers-reduced-motion` 규칙만 1건 있다(2026-11-12 직접 받은 CSS grep). 에디터 모션 값은 로그인 뒤라 확인 불가.
- 클론 제안: 120~160ms ease-out (hover, 패널), 200~240ms (패널 열기), 줌/팬은 즉시 반응, `prefers-reduced-motion` 존중.
- AI 생성 시 다이어그램이 단계적으로 나타나는지 (미확인).

## 13. Empty state / Onboarding

- 확인: 새 파일은 dashboard에서 Canvas 등 타입을 골라 만들고, 캔버스에서 `/`로 insert menu를 열고, `⌘J`로 AI Diagram을 연다. Templates가 AI 출력을 일정하게 유지하는 수단으로 문서화돼 있다. 출처: https://docs.eraser.io/docs/quickstart
- 빈 캔버스의 안내 문구/일러스트 (미확인, 재확인). 가입 후 투어는 (미확인)이나, dashboard에 숨길 수 있는 Getting Started 페이지가 있다는 것은 확인됨: https://docs.eraser.io/personal-settings.md
- 클론 제안: 빈 캔버스 중앙에 한 줄 힌트("`/`를 눌러 추가해요"), 템플릿 3~5개 카드, 첫 실행 시 샘플 파일 1개. 문구는 해요체로 짧게.

## 14. 재사용 가능한 일반 UX 패턴 vs 클론이 교체해야 할 브랜드 요소

### 재사용해도 되는 일반 패턴
- 사이드바 + 캔버스 + 선택적 오른쪽 패널의 3분할 레이아웃.
- 선택한 객체 위/옆에 뜨는 property bar.
- `/` 로 여는 insert(커맨드) 메뉴, `⌘J` 류 AI 호출 단축키 개념.
- 색 모드 3종(pastel/bold/outline)이라는 개념, 연결선 3종(elbow/straight/arc), 그림자 on/off. 기능 개념은 일반적이며 (이름은 자체로 정하는 편이 안전, 추정).
- dark mode를 파일이 아닌 개인 설정으로 두는 방식.
- 4px 간격 스케일, 1px 구분선, outline 아이콘, 점 그리드, 모서리 핸들.
- 템플릿 카드 + 샘플 파일 onboarding.

### 교체해야 하는 브랜드 식별 요소
- 로고, 이름 "Eraser", 워드마크, 파비콘.
- 시그니처 색(실제 값은 미확인이지만 브랜드 액센트는 그대로 쓰지 않는다).
- 마케팅 일러스트, hero 이미지, 장식 글리프 "››››/‹‹‹‹" 배치, 카피 문구.
- 정확히 같은 기본 조합(rough 글꼴 + shadow + pastel)을 "그대로" 첫인상으로 복제하는 것은 피하고, 자체 프리셋 이름과 팔레트를 만든다 (추정, 법적 판단 아님).
- `rough` 글꼴의 실제 폰트 이름·라이선스는 공개 docs에 없어 (미확인)이다. 동일 폰트 사용 대신 OFL 대체재를 쓴다.
- 속성 이름(`colorMode`, `styleMode` 등) DSL 문법은 호환 목적이 아니면 자체 이름 사용 (02 파일 범위와 겹치므로 여기선 언급만).

## 15. 남은 확인 항목 (사람이 에디터를 직접 볼 때)

1. 에디터 패널 폭, 헤더 높이, 사이드바 구조.
2. UI 폰트 패밀리와 색 hex (DevTools로 확인).
3. 선택 핸들, hover/focus, 모션.
4. 빈 캔버스와 onboarding 화면.

## 출처
- https://www.eraser.io
- https://docs.eraser.io/docs/quickstart
- https://docs.eraser.io/docs/styling
- https://docs.eraser.io/docs/dark-mode
- https://docs.eraser.io/custom-styles
