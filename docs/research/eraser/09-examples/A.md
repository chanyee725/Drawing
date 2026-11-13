# 09-examples / A: C4 · 아키텍처 리뷰 · 역량 맵 · 참조 아키텍처

대상 7개: `c4-model-food-delivery`, `c4-model-monolith-to-services`, `c4-model-four-levels`, `architecture-review-health-plan`, `business-capability-map-utility`, `enterprise-reference-architecture-airport`, `enterprise-reference-architecture-city`.

조사일 2026-11-13. 출처는 `https://www.eraser.io/examples/<slug>` 와 그 안의 `https://www.eraser.io/embeds/maps/<slug>/`. 캡처와 측정 JSON은 저장소 밖 `/home/bgk/personal/eraser-ref/<slug>/` 에 있어요 (`layout.json`, `styles.json`, `embed.png`, `view-N.png`, `zoom-*.png`, `ours.png`). Eraser 파일은 저장소에 넣지 않았고, 숫자만 옮겼어요.

## 0. 가장 중요한 발견

1. **이 예시들은 자동 배치가 아니에요.** embed 페이지의 `script#map-present-data` 에 모든 요소의 `x, y, width, height` 가 저작 값으로 들어 있고, 연결선도 `points` 배열(꺾임점)과 `labelPlacement` 를 직접 가져요. 즉 "Eraser 지도(map)" 예시는 사람이(또는 생성기가) 좌표를 정한 결과예요. ELK로 같은 그림을 얻으려면 배치 규칙을 흉내 내는 게 아니라 **격자·행 정렬 제약**을 넣어야 해요.
2. **화면 배율 0.87.** 저작 글자 크기 14 → 실제 12.18px, 30 → 26.1px, 12 → 10.44px. 선 굵기도 같은 계열(노드 테두리 1.2px, 연결선 1.3px). 초기 줌은 90% (`scale(0.9)`).
3. **노드 = 상자 + 왼쪽 아이콘 + 가운데 2줄 글(이름/종류).** 우리 cloud-architecture 노드(아이콘 위, 글 아래)와 생김새가 달라요. C4 예시를 따라가려면 "상자형 노드" 모양이 필요해요.
4. **그림자 = 같은 도형을 (+4, +4) 옮긴 #E8E8E8 단색**(흐림 없음). 모서리 반경 = `min(12, 0.15 × 높이)`.
5. **다크 모드 없음.** `colorScheme: dark` 로 열어도 데이터 `theme: "light"` 그대로, 색이 바뀌지 않아요 (7개 모두 `theme: light`).

## 1. 예시별 요약

| slug | 제목(데이터) | 뷰 | 필터 | 흐름(재생) | 성격 |
|---|---|---|---|---|---|
| c4-model-food-delivery | Forkway · C4 model | 4 (Context → Containers → Order/Dispatch service) | Team, Technology | 뷰마다 1개, 4~7단계 | C4 드릴다운 |
| c4-model-monolith-to-services | Pagewright · Monolith to services | 4 (2024 → 2025 → 2026, 모듈) | Phase, Team | 3개 | 같은 배치에서 시점별 변화 |
| c4-model-four-levels | Gridline · C4 model, four levels | 4 (L1~L4) | Level, Language | 3개 | L1→L4 드릴다운, L4는 클래스 상자 |
| architecture-review-health-plan | Bramblewood Health · Prior-auth API review | 4 (제안 → 패턴 대조 → 지적 → 승인) | Change, Severity, Review domain | 3개 (`shake` 효과 포함) | 같은 배치 + 배지/주석 덧칠 |
| business-capability-map-utility | Larkhill Energy · Business capability map | 4 (역량, 성숙도, 지출, 자산관리) | Owner, Strategic importance | 3개 (`pulse` 만) | 연결선 없는 격자 |
| enterprise-reference-architecture-airport | Gorsemoor Airports · reference architecture | 4 (참조, 갭, 2028 목표, 통합 허브) | Status, Layer, Hosting, Owner domain | 2개 | 계층 행 × 기둥 열 매트릭스 |
| enterprise-reference-architecture-city | City of Linnet Bay · reference architecture | 4 (참조, 주민 데이터, 운영 주체, 311 CRM) | Resident data, Run by, Department, Layer | 3개 | 공항과 같은 틀 |

공통 패턴: 뷰 4개, 같은 좌표 틀을 유지하고 색·배지·선만 바꿔 "레이어"처럼 써요(health-plan, capability-map, airport, city, monolith 2024~2026). 드릴다운 뷰(C4)는 큰 상자 클릭 → `links[].kind = "fade"` 로 하위 뷰가 열려요.

## 2. 배치 측정 (최빈값, 저작 좌표 기준, 단위 px)

측정은 `layout.json` 의 `hGap`/`vGap`(같은 부모 안에서 겹치는 행/열의 가장 가까운 이웃까지 거리), `groupPad_LTRB`(그룹 경계 ~ 자식 bbox), `rel.*`(연결선)에서 왔어요.

### 2.1 노드 크기 — 고정 폭, 텍스트 맞춤 아님

| 예시 | 주 노드 크기 (w×h, 개수) | 비고 |
|---|---|---|
| food-delivery | 200×72 사람, 240×72 앱, 170×80 원통, 230×56 컴포넌트 ×7, 게이트웨이 1080×56 | 같은 층 노드는 같은 크기 |
| monolith | 150×44 ×9, 150×72 ×5 | 모듈 상자 150 폭 고정 |
| four-levels | 200×64 ×7, 230×64 ×8, L4 클래스 230×112 ×6 | |
| health-plan | 180×58 ×23 | 거의 전부 같은 크기 |
| capability-map | 280×52 ×28 | 100% 같은 크기 |
| airport | 150×60 ×63, 160×60 ×8 (왼쪽 역량 열), 넓은 상자 311/488/674×60 | 넓은 상자 = 열 n칸 + 간격 |
| city | 160×54 ×32, 150×54 ×13 | |

규칙: **한 뷰에 노드 크기 1~3종**, 층/그룹마다 폭 통일. 긴 상자는 여러 칸을 합친 폭(airport API gateway 674 = 150×4 + 24×3 + α). 좌표는 대부분 2의 배수, food-delivery·four-levels는 10의 배수, monolith는 4의 배수.

### 2.2 간격

| 예시 | 가로 간격 (최빈) | 세로 간격 (최빈) | 그룹 패딩 L,T,R,B | 그룹 간 간격 |
|---|---|---|---|---|
| food-delivery (containers) | 40, 110, 80 | 54, 40, 64 | 40,60,40,44 (C4 경계) / 20,46,20,28 (컴포넌트 뷰) | — |
| monolith | 14 | 44~48 | 16,60,16,16 (모놀리스 안 모듈) | — |
| four-levels | 40 | 60 | 20,44,20,30 | — |
| health-plan | 16 | 72 (행 사이), 4 (배지↔노드) | 16,76,16,46 | 52, 40 |
| capability-map | **16** | **12** (그룹 사이) | **16,40,16,12** (7개 모두 동일) | 12 |
| airport | 24, 14 | 12, 52 | 14,34,14,8 (계층) / 8,28,8,8 (도메인) | 10~16 (계층 행 사이) |
| city | 16, 26 | 12, 52 | 14,34,14,8 / 8,28,8,8 | 10 |

요약 규칙 (우리 기본값 후보):
- 그룹 패딩: **좌우 = 하단 근처 8~16, 상단 = 제목 높이 + 8~20** (제목 줄 26~34 + 여백). C4 경계 같은 큰 그룹은 40/60/40/44.
- 형제 노드 간격: 촘촘한 격자는 **12~16**, 연결선이 지나가는 층 사이는 **40~64**(라벨이 들어가면 54~72).
- capability-map: 그룹 폭이 자식 개수에 맞춰 줄어요(5개 1496, 4개 1200, 3개 904 = 16+n×296−16+16). 모든 그룹 왼쪽 정렬, 높이 104 고정.
- airport/city: **열이 계층을 가로질러 정렬**(x = 384, 570, 744, 908, 1082, 1256, 1430이 모든 계층에서 반복). 오른쪽에 세로 기둥(Security, Operations), 아래에 가로 띠(Governance), 왼쪽에 역량 열, 그 바깥에 외부 행위자. 범례(Key) 그룹은 오른쪽 위 바깥(y = −72).

### 2.3 정렬

- 같은 행 노드는 **위쪽 정렬 = 가운데 정렬**(높이가 같아서). 측정: rowsSameTop == rowsSameCenter 가 거의 모든 뷰.
- 큰 부모 하나 + 주변 위성 배치(C4 context): 위에 사람 3명(y=0), 가운데 큰 시스템 상자(900×400), 양옆에 외부 시스템, 연결선은 모두 **곧은 수직/수평 1구간**.

### 2.4 연결선 경로

| 항목 | 측정 |
|---|---|
| 직교 여부 | 7개 × 4뷰 전부 100% 직교 |
| 꺾임 수 | 대부분 0 (직선). 꺾이면 1~2번 (monolith 모듈 뷰만 2번이 다수) |
| 끝점 위치 | 변의 **정중앙(0.5)** 이 최빈 (food 23/36, four-levels L2 30/38). 한 변에 여러 선이면 0.12/0.35/0.85 같은 비대칭 위치로 벌어짐 |
| 나가는 변 | 위→아래 흐름은 T/B, 매트릭스(health-plan)는 L/R |
| 라벨 위치 | **가장 긴 구간의 중점에 라벨 중심** (오프셋 0,0)이 최빈. 두 번째는 세로선에서 위로 22~26 이동 (라벨이 끝 노드 가까이 붙음) |
| 라벨 상자 | 높이 21 (저작), 폭 = 글자 폭 + ~8 |
| 라벨 처리 | 배경 없음. 라벨 bbox + 1px 여유 크기로 **선을 마스크로 잘라냄**(cutout 114×23 for 112×21) |
| 양방향 | airport/city는 `arrow->arrow` 가 30% 이상 |

### 2.5 범례·제목

- 제목/설명은 다이어그램 안이 아니라 **화면 왼쪽 위 오버레이**(뷰 이름 16px 700, 설명 13px #666).
- 범례: C4는 **왼쪽 아래** 가로 한 줄(제목 "Legend" 11.3px #98A2B3, 150×40 견본 상자, 간격 12). four-levels는 **오른쪽 세로 한 줄**(200×34, 간격 10). airport/city는 **오른쪽 위 Key 그룹**(640×62, 견본 150×30). capability-map 성숙도 뷰는 오른쪽 위 가로 5칸(104×32, 간격 8).

## 3. 스타일 측정 (computed style, 화면 배율 0.87 적용 후 값)

| 요소 | 값 |
|---|---|
| 글꼴 | `"Inter var", Inter, system-ui, ...`, 기본 14px(저작) → 12.18px, line-height 1.25 |
| 노드 제목 | 13.05px (저작 15) 400, 색 #242424 또는 노드 강조색 |
| 노드 부제(종류/기술) | 10.44px (저작 12), #6B7280 |
| 큰 시스템 상자 제목 | 26.1px #1849A9 + 부제 13.92px #3E63DD |
| 노드 테두리 | 1.2px, 실선. 외부 시스템은 `8px 8.75px` 점선 #98A2B3, 채움 #FFFFFF, 그림자 없음 (`styleMode: plain`) |
| 모서리 반경 | `min(12, 0.15·h)` — 72→10.8, 40→6, 400→12 |
| 그림자 (`shadow` 모드) | 같은 경로 (+4,+4), #E8E8E8, 흐림 없음 |
| 색(C4) | 사람 #F2F4F7/#475467, 컨테이너 #E0EAFF/#2866DF (일부 채움 없음), 데이터 저장소 #F5F8FF/#2866DF 원통, 외부 #FFFFFF/#98A2B3 점선 |
| 원통 | 위아래 타원 반지름 ry = 0.11·h (48→5.28) |
| 아이콘 | lucide 계열 선 아이콘, 18×18(화면), stroke 1.75, 노드 왼쪽 안쪽 ~12, 색 = 테두리색 계열(#344054, #2866DF, #667085) |
| 연결선 | 1.3px, 기본 #667085 (airport/city 흐름선 #1570EF, 비활성 #98A2B3), linecap butt |
| 화살촉 | 열린 V, 12×11 userSpace, 선과 같은 굵기. 다른 종류로 triangle(채움), bar, dot, crowFoot 지원 |
| 점선 연결 | `lineStyle: dashed` (L4 상속선, health-plan 지적선 #DC6803/#D92D20) |
| 연결 라벨 | 12.18px 400, #667085, 배경 없음, 선 끊김 |
| 그룹 | 채움 반투명 (`rgba(242,244,247,0.5)`, 역량 열 `rgba(238,244,255,0.6)`), 테두리 1px #D0D5DD, rx 5.5. 제목은 **왼쪽 위 안쪽**, 14px(저작) + 앞 아이콘, 색 #344054 또는 강조색 #3538CD. 하위 도메인 그룹은 제목 13 #667085, 채움 `rgba(255,255,255,0.55)`, 테두리 #EAECF0 |
| C4 경계 그룹 | 파란 점선 경계, 제목 가운데 위 ("🍴 Forkway · software system") |
| 배경 | #FFFFFF, 격자 없음 |

## 4. 우리 렌더러와 비교 (develop `1f3bb6c`, `shared/render`, ELK)

대표 4개를 우리 DSL로 다시 써서 렌더했어요: food-delivery(Containers), four-levels(L1), capability-map, airport. 결과 `ours.png` / `ours.svg`.

### 4.1 배치 차이 (먼저)

1. **food-delivery**: Eraser는 3단(사람 → 앱 → 게이트웨이 → 서비스 4개 한 줄 → 저장소 한 줄 → 이벤트 버스) 대칭 격자. 우리는 ELK가 서비스들을 층을 다르게 쌓아(Order → Payments → Event bus → Dispatch) **세로로 길어지고**(647×1193 vs 가로형), 외부 시스템이 그룹 아래로 떨어지면서 긴 연결선이 그룹을 관통해요. 게이트웨이 같은 **넓은 상자(여러 열을 덮는 노드)** 개념이 없어요.
2. **four-levels L1**: Eraser는 큰 시스템 상자(960×420) 하나를 가운데 두고 위·옆·아래에 위성을 곧은 선 1구간으로 붙여요. 우리는 중앙 노드가 작은 아이콘이라 한 점에서 선 9개가 몰려 나가고, **라벨이 겹쳐요**("Builds on the API" / "Operates", "Sends messages" / "Delivery webhooks").
3. **capability-map**: Eraser는 그룹 7개가 세로로 쌓이고 그룹 안은 가로 한 줄(간격 16). 우리는 연결선이 없으니 ELK가 **그룹을 한 열로 세우고 그룹 안도 세로**로 놓아 269×2374의 막대가 돼요. 연결 없는 그룹 = "행 격자로 흘려 배치" 규칙이 필요해요.
4. **airport**: Eraser는 계층 × 열 매트릭스(열 x좌표가 계층 사이 공유). ELK layered 로는 열 공유가 안 되고 1982×2752로 흩어져요. 이름 중복("Baggage" 역량 vs 도메인)도 DSL 오류가 나요 — Eraser 예시는 id와 표시 이름이 따로라 가능.
5. 끝점: Eraser는 변 정중앙에서 곧게, 우리는 ELK 포트 분산으로 같은 변에서 12px 간격으로 벌어져 작은 꺾임(지그재그)이 많이 생겨요.

### 4.2 스타일 차이 (다음)

| 항목 | Eraser | 우리 (1f3bb6c) |
|---|---|---|
| 노드 모양 | 상자 + 왼쪽 아이콘 + 2줄 글 | 아키텍처: 아이콘 위 + 글 아래 (상자 없음) |
| 부제(2번째 줄) | 있음 (종류·기술, 작고 회색) | 없음 |
| 테두리 | 1.2px | 1.5px 계열 |
| 반경 | min(12, 0.15h) | node 8 / group 12 고정 |
| 그림자 | (+4,+4) #E8E8E8 단색 | (+2,+3) rgba(15,23,42,0.10) |
| 연결선 | 1.3px #667085 | 1.5px #7b828d |
| 화살촉 | 열린 V 12×11 | 채운 삼각형 |
| 라벨 | 배경 없음 + 선 끊김 | 흰 알약 배경 + 테두리 |
| 그룹 제목 | 14 regular + 아이콘, 강조색 | 굵게, 검정 |
| 외부 시스템 점선 | 8 / 8.75 | 6 / 4 |
| 아이콘 | chef-hat, bike, waypoints, utensils, radio 등 lucide 이름 다수 | 없는 이름은 점선 자리표시 아이콘 |

## 5. 기능 관찰 (짧게, '진행판'과 겹치는 부분 위주)

- **흐름 재생 (진행판과 가장 가까움)**: 뷰마다 `flows[]`. 각 흐름 = 단계 목록(`label`, `description`), 단계마다 `animation.effects[]` = `{ref, start, stop(ms), type, easing}`. 효과 종류: `travel-line`(선을 따라 점이 이동, 800ms), `pulse`(노드 깜빡임, 700ms), `shake`(지적 사항). 화면: 왼쪽 위 "▷ 흐름 이름" 버튼 → 아래 막대(이전/재생/다음/집중, 점 표시, 단계 설명). 노드 위 번호 콜아웃(`mf-callout`)과 재생 트리거 아이콘(`mf-at`)이 노드 위쪽 24×24로 붙어요. → 우리 파이프라인 진행판에서 "단계 = 노드 강조 + 간선 이동 애니메이션 + 설명 한 줄" 구조를 그대로 쓸 수 있어요.
- **같은 틀 위의 레이어 뷰**: 좌표는 그대로 두고 색·배지·점선만 바꿔 상태(갭, 지적, 승인, 시점)를 보여 줘요. 진행판의 "대기/진행/완료" 색 전환과 같은 방식.
- 뷰 전환: 제목 드롭다운("4 views", 검색 가능). 드릴다운: 상자 왼쪽 위 레이어 버튼(`Expand`) → fade 전환, 경로 표시("System context / Containers").
- 필터: 왼쪽 아래 버튼(Team, Technology …), 안 맞는 요소를 흐리게.
- 줌: 오른쪽 위 "90% ▾" → 입력칸 ±, Zoom to fit (⇧1), Zoom to 100% (Ctrl 0).
- 노드 클릭 → 레코드(이름, 종류, 필드) 카드.

## 6. 우리 DSL 코드 (비교에 쓴 것)

food-delivery (Containers 뷰 근사):

```eraser
direction down
typeface clean
Restaurant staff [icon: chef-hat, color: gray]
Diner [icon: user, color: gray]
Courier [icon: bike, color: gray]
Restaurant POS [icon: monitor, styleMode: plain]
Payment gateway [icon: landmark, styleMode: plain]
Maps and routing [icon: map, styleMode: plain]
Forkway [icon: utensils, color: blue] {
  Restaurant app [icon: tablet, color: blue]
  Diner app [icon: smartphone, color: blue]
  Courier app [icon: bike, color: blue]
  API gateway [icon: waypoints, color: blue]
  Menu service [icon: book-open, color: blue]
  Order service [icon: shopping-bag, color: blue]
  Payments service [icon: credit-card, color: blue]
  Dispatch service [icon: waypoints, color: blue]
  Menu DB [shape: cylinder, color: blue]
  Orders DB [shape: cylinder, color: blue]
  Payments ledger [shape: cylinder, color: blue]
  Location store [shape: cylinder, color: blue]
  Event bus [icon: radio, color: blue]
}
Restaurant staff > Restaurant app: Prepares orders
Diner > Diner app: Orders food
Courier > Courier app: Delivers
Restaurant app > API gateway
Diner app > API gateway
Courier app > API gateway
API gateway > Menu service
API gateway > Order service
API gateway > Dispatch service
Restaurant POS > Menu service
Order service > Payments service
Payments service > Payment gateway: Charges
Dispatch service > Maps and routing: ETAs
Menu service > Menu DB
Order service > Orders DB
Payments service > Payments ledger
Dispatch service > Location store
Order service > Event bus: OrderPlaced
Event bus > Dispatch service: Events
```

four-levels L1:

```eraser
direction down
typeface clean
Customer developer [icon: user, color: gray]
Customer app [icon: smartphone, styleMode: plain]
On-call engineer [icon: user, color: gray]
Gridline [icon: radio, color: blue]
Billing [icon: credit-card, styleMode: plain]
Status page [icon: activity, styleMode: plain]
Mobile carriers [icon: radio, styleMode: plain]
Email provider [icon: mail, styleMode: plain]
"APNs / FCM" [icon: bell, styleMode: plain]
Customer developer > Gridline: Builds on the API
Customer app > Gridline: Sends messages
Gridline > Customer app: Delivery webhooks
On-call engineer > Gridline: Operates
Gridline > Billing: Usage
Gridline > Status page: Health
Gridline > Mobile carriers: SMS
Gridline > Email provider: Email
Gridline > "APNs / FCM": Push
```

capability-map (앞 두 그룹만, 나머지 5개 같은 꼴):

```eraser
direction right
typeface clean
styleMode plain
"Asset management" [color: blue] {
  "Asset registry"
  "Maintenance planning"
  "Inspection & condition"
  "Capital planning"
  "Vegetation management"
}
"Grid operations" [color: blue] {
  "Grid monitoring & control"
  "Outage management"
  "Switching & dispatch"
  "DER integration"
}
```

airport 전체 DSL은 길어서 `/home/bgk/personal/eraser-ref/_A/dsl/enterprise-reference-architecture-airport.eraser` 에 있어요 (계층 그룹 7개 + 기둥 2개 + 띠 1개 + 외부 행위자 4개 + 연결 24개).

## 7. 남은 일

- 캡처 완료: food-delivery (page, embed, view-1~4, zoom, 다크, UI 메뉴, `styles.json`). monolith 는 캡처 PNG만 있고 필터 메뉴 단계에서 멈춰 `styles.json` 없음. 나머지 5개는 `layout.json`(데이터 측정)만 있고 PNG·computed style 미수집. 스타일 값은 food-delivery 실측 + 나머지 예시의 데이터 값(색, 글자 크기, 선 스타일)으로 채웠어요.
- `ours.png` 는 4개(food-delivery, four-levels, capability-map, airport). health-plan, city, monolith 는 비교 렌더 없음.
- 캡처 스크립트: `/home/bgk/personal/eraser-ref/_A/capture.cjs` — 필터 버튼 클릭 단계에 타임아웃을 넣고 다시 돌리면 돼요.
