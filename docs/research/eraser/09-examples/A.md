# 09-examples / A: C4 · 아키텍처 리뷰 · 역량 맵 · 참조 아키텍처

대상 7개: `c4-model-food-delivery`, `c4-model-monolith-to-services`, `c4-model-four-levels`, `architecture-review-health-plan`, `business-capability-map-utility`, `enterprise-reference-architecture-airport`, `enterprise-reference-architecture-city`.

조사일 2026-11-13. 출처는 `https://www.eraser.io/examples/<slug>` 와 그 안의 `https://www.eraser.io/embeds/maps/<slug>/`. 캡처와 측정 JSON은 저장소 밖 `/home/bgk/personal/eraser-ref/<slug>/` 에 있어요 (`layout.json`, `styles.json`, `embed.png`, `view-N.png`, `zoom-*.png`, `ours.png`). Eraser 파일은 저장소에 넣지 않았고, 숫자만 옮겼어요.

## 0. 가장 중요한 발견

1. **이 예시들은 자동 배치가 아니에요.** embed 페이지의 `script#map-present-data` 에 모든 요소의 `x, y, width, height` 가 저작 값으로 들어 있고, 연결선도 `points` 배열(꺾임점)과 `labelPlacement` 를 직접 가져요. 즉 "Eraser 지도(map)" 예시는 사람이(또는 생성기가) 좌표를 정한 결과예요. ELK로 같은 그림을 얻으려면 배치 규칙을 흉내 내는 게 아니라 **격자·행 정렬 제약**을 넣어야 해요.
2. **화면 배율 0.87.** 저작 글자 크기 14 → 실제 12.18px, 30 → 26.1px, 12 → 10.44px. 선 굵기도 같은 계열(노드 테두리 1.2px, 연결선 1.3px). 초기 줌은 90% (`scale(0.9)`).
3. **노드 = 상자 + 왼쪽 아이콘 + 가운데 2줄 글(이름/종류).** 우리 cloud-architecture 노드(아이콘 위, 글 아래)와 생김새가 달라요. C4 예시를 따라가려면 "상자형 노드" 모양이 필요해요.
4. **그림자 = 같은 도형을 (+4, +4) 옮긴 #E8E8E8 단색**(흐림 없음). 모서리 반경 = `min(12, 0.15 × 높이)`.
5. **다크 모드 없음.** `colorScheme: dark` 로 열어도 색이 바뀌지 않아요 (캡처한 5개에서 확인, 데이터도 7개 모두 `theme: "light"`).

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

## 3. 스타일 측정 (실측, computed style)

5개(food-delivery, monolith, four-levels, health-plan, capability-map)를 headless로 열어 `getComputedStyle`·SVG 속성·bbox로 쟀어요. 값은 world 좌표 기준(화면 배율 0.87 적용 후, 초기 줌 0.9 적용 전). airport·city는 다른 세션이 캡처 중이라 이 표에 넣지 않았어요(그 칸의 색은 저작 데이터 값).

### 3.1 글자

저작 크기 × 0.87 = 실제 px. 5개 모두 같아요.

| 쓰임 | 저작 | 실측 px | 굵기 | 색 (실측) |
|---|---|---|---|---|
| 기본 글꼴 | — | `"Inter var", Inter, system-ui, -apple-system, "Segoe UI", sans-serif` | | |
| 큰 시스템 상자 제목 (C4) | 30 | 26.1 | 400 | #1849A9 |
| 큰 상자 부제 | 16 | 13.92 | 400 | #3E63DD |
| 패널 제목 (health-plan) | 22 | 19.14 | 400 | #344054 |
| 노드 제목 (C4) | 15 | 13.05 | 400 | #242424 (외부 시스템 #475467) |
| 노드 제목 (모듈·역량) | 14 | 12.18 | 400 | #242424 / #101828 |
| 노드 부제 (종류·기술) | 12 | 10.44 | 400 | #6B7280 |
| 노드 부제 (역량·리뷰) | 11 | 9.57 | 400 | #667085 / 상태색 #067647 |
| 연결 라벨 | 14 | 12.18 | 400 | #667085, 배경 투명 |
| 그룹 제목 | 14 / 15 | 12.18 / 13.05 | 400 | #475467, #344054, C4 경계는 #1849A9 |
| 범례 제목·주석 텍스트 | 13 | 11.31 | 400 | #98A2B3 (주석 #667085), letter-spacing −0.01em |
| 범례 견본 글 | 12 | 10.44 | 400 | #242424 |

굵게(700)는 다이어그램 안에서 한 번도 안 써요. 위계는 크기·색으로만 나눠요.

### 3.2 노드

| 항목 | 실측 |
|---|---|
| 테두리 | 1.2px, 실선, linejoin round (5개 모두) |
| 점선 테두리 | `8px 8.75px` (외부 시스템, 리뷰 "삭제 예정" 노드) |
| 모서리 반경 | **`min(12, 0.15·h)`**: h=400→12, 140→12, 80→12, 72→10.8, 64→9.6, 58→8.7, 52→7.8, 44→6.6, 40→6, 34→5.1, 32→4.8 (예외 없음) |
| 그림자 (`shadow`) | 같은 경로를 (+4,+4) 옮김, 채움 #E8E8E8, 흐림·투명도 없음, 테두리 없음. `plain` 노드는 그림자 없음 |
| 원통 | 타원 ry = 0.11·h (48→5.28, 80→8.8), rx = w/2 |
| 안쪽 배치 | 아이콘이 있으면 왼쪽 18×18, 글은 아이콘 오른쪽 남은 폭에서 **가운데 정렬** 2줄. 아이콘 없으면 상자 전체 가운데 |
| 아이콘 | 선 아이콘, 18×18(world), stroke 1.75, 색 = 노드 색 계열 (#344054, #2866DF, #667085) |
| C4 색 | 사람 #F2F4F7/#475467 shadow · 컨테이너 #E0EAFF/#2866DF shadow (범례는 채움 없음) · 저장소 #F5F8FF/#2866DF 원통 · 외부 #FFFFFF/#98A2B3 점선 plain |
| 역량 맵 | 채움 #FFFFFF, shadow, 테두리 연회색 |
| 리뷰 배지 줄(208×32) | plain, 채움 #ECFDF3(신규), #FFFAEB(변경), #FEF3F2 + 점선(삭제), #FFFFFF(그대로) |

### 3.3 연결선

| 항목 | 실측 |
|---|---|
| 굵기 | 1.3px (5개 모두), linecap butt, linejoin miter |
| 색 | 기본 #667085. 강조: 빨강 #D92D20 (monolith 엉킨 의존), 주황 #DC6803 / 빨강 #D92D20 (리뷰 지적), 초록 #079455 (승인), 보라 #7A5AF8 (L4 상속), 연한 #98A2B3·#84ADFF (역량 맵 자산관리) |
| 점선 | `8px 8.75px` (노드 점선과 같음) |
| 화살촉 | 열린 V, 12×11 (userSpace, 선 굵기와 무관), 선과 같은 색·굵기. 그 밖에 triangle(채움, 5.71×5.14 × 선 굵기), bar, dot, crowFoot 정의가 있음 |
| 라벨 | 12.18px #667085, 배경 없음. 라벨 bbox보다 사방 1px 큰 상자를 마스크로 뚫어 선을 끊음 (예: 112×21 → 114×23, 117×21 → 119×23) |

### 3.4 그룹

| 항목 | 실측 |
|---|---|
| 테두리 | 1px, rx 5.5, `vector-effect: non-scaling-stroke`. 점선이면 `8 8.75` |
| 채움 | 반투명: `rgba(242,244,247,0.6)` 역량 영역, `rgba(249,250,251,0.6~0.7)` 리뷰 패널, `rgba(242,244,247,0.35)` 리뷰 레인(점선), `rgba(224,234,255,0.22)` C4 경계(파란 점선 #2866DF), `rgba(209,224,255,0.4)` 모놀리스 상자 |
| 제목 위치 | 기본은 **왼쪽 위 안쪽 (7~8, 7~8)**, 높이 20.8~21.8, padding 3px 5px, 앞에 13.5px 아이콘. C4 경계·모놀리스는 **위 가운데**, 역량 맵은 **오른쪽 위** (`data-title-align`) |
| 제목 글 | 12.18 또는 13.05px, 400, 그룹 강조색 |

### 3.5 화면

| 항목 | 실측 |
|---|---|
| 배경 | #FFFFFF, 격자·점 없음 |
| 초기 줌 | 90% (`scale(0.9)`), 5개 모두 |
| 다크 모드 | 없음. `prefers-color-scheme: dark` 로 열어도 배경·노드 색이 light와 같음 (5개 모두 확인) |
| 뷰 제목 | 16px 700 #171717, 설명 13px #666666 (다이어그램 밖 오버레이) |
| 컨트롤 | 줌 버튼 11px, 필터 버튼 12.5px, 흰 바탕 + 1px #ECECEC 테두리, 반경 6 (줌 4) |

## 4. 우리 렌더러와 비교 (develop `1f3bb6c`, `shared/render`, ELK)

7개 모두 첫 뷰를 우리 DSL로 다시 써서 렌더했어요. food-delivery·four-levels·capability-map은 손으로 썼고, 나머지 4개(monolith, health-plan, airport, city)는 저작 데이터에서 자동 변환했어요(`_A/todsl.py`: id를 이름으로, 표시 글을 `label`로, 범례 제외). 결과는 각 폴더의 `ours.png` / `ours.svg`이고, 7개 모두 진단 오류가 없어요.

| slug | Eraser 첫 뷰 bounds | 우리 결과 크기 | 한 줄 요약 |
|---|---|---|---|
| food-delivery | 1670×876 | 647×1193 | 가로형이 세로형으로 바뀜 |
| monolith | 1606×868 | 1001×1079 | 위 행위자 8명 한 줄 → 층이 나뉨 |
| four-levels | 1305×944 | 736×563 | 중앙 상자가 점이 되고 라벨 겹침 |
| health-plan | 1576×968 | 2357×1039 | 레인 5개(왼→오)는 비슷, 패널이 왼쪽 아래로 |
| capability-map | 1496×930 | 269×2374 | 행 격자가 한 줄 막대로 |
| airport | 1954×1038 | 1995×3336 | 계층 행 × 열 매트릭스가 무너짐 |
| city | 1640×812 | 2012×2031 | 계층 행이 열로, 기둥 3개가 왼쪽 세로 더미로 |

### 4.1 배치 차이 (먼저)

1. **food-delivery**: Eraser는 3단(사람 → 앱 → 게이트웨이 → 서비스 4개 한 줄 → 저장소 한 줄 → 이벤트 버스) 대칭 격자. 우리는 ELK가 서비스들을 층을 다르게 쌓아(Order → Payments → Event bus → Dispatch) **세로로 길어지고**(647×1193 vs 가로형), 외부 시스템이 그룹 아래로 떨어지면서 긴 연결선이 그룹을 관통해요. 게이트웨이 같은 **넓은 상자(여러 열을 덮는 노드)** 개념이 없어요.
2. **four-levels L1**: Eraser는 큰 시스템 상자(960×420) 하나를 가운데 두고 위·옆·아래에 위성을 곧은 선 1구간으로 붙여요. 우리는 중앙 노드가 작은 아이콘이라 한 점에서 선 9개가 몰려 나가고, **라벨이 겹쳐요**("Builds on the API" / "Operates", "Sends messages" / "Delivery webhooks").
3. **capability-map**: Eraser는 그룹 7개가 세로로 쌓이고 그룹 안은 가로 한 줄(간격 16). 우리는 연결선이 없으니 ELK가 **그룹을 한 열로 세우고 그룹 안도 세로**로 놓아 269×2374의 막대가 돼요. 연결 없는 그룹 = "행 격자로 흘려 배치" 규칙이 필요해요.
4. **airport**: Eraser는 계층 × 열 매트릭스(열 x좌표가 계층 사이 공유). ELK layered 로는 열 공유가 안 되고 1995×3336으로 흩어져요. 표시 이름이 겹치는 노드("Baggage" 역량 vs 도메인)는 이름으로 쓰면 중복 오류가 나서, id를 이름으로 쓰고 `label`로 표시 글을 줬어요.
5. **monolith**: Eraser는 외부 행위자 8개를 맨 위 한 줄(y=0, 간격 14)에 두고 그 아래 큰 경계 상자(1606×656) 안에 모놀리스(1494×120)를 가로 띠로 놓아요. 우리는 행위자들이 연결 대상에 따라 층이 갈려 한 줄이 깨져요.
6. **health-plan**: Eraser는 위에 패널(696×192, 오른쪽 위), 아래에 레인 5개를 같은 높이 760으로 왼→오 나란히(간격 16). 우리는 레인 순서는 비슷하게 나오지만 높이가 제각각이고, 연결 없는 패널이 왼쪽 아래 별도 열로 가요. 패널 안 배지 순서도 원본과 달라져요(모델 순서가 안 지켜짐).
7. **city**: Eraser는 계층 6개를 가로 띠로 쌓고(폭 1088 고정, 간격 10), 오른쪽에 기둥 2개(166×740), 왼쪽 바깥에 행위자 3명. 우리는 `direction right` 때문에 띠가 열이 되고, 연결 없는 Infrastructure/Operations/Security 그룹이 왼쪽 세로 더미로 몰려요. ELK는 "연결 없는 그룹 = 격자 흘림", "같은 높이·같은 폭 띠", "열 정렬 공유"를 하지 않는다는 점이 airport와 같아요.
8. 끝점: Eraser는 변 정중앙에서 곧게, 우리는 ELK 포트 분산으로 같은 변에서 12px 간격으로 벌어져 작은 꺾임(지그재그)이 많이 생겨요.

### 4.2 스타일 차이 (다음)

| 항목 | Eraser | 우리 (1f3bb6c) |
|---|---|---|
| 노드 모양 | 상자 + 왼쪽 아이콘 + 2줄 글 | 아키텍처: 아이콘 위 + 글 아래 (상자 없음) |
| 부제(2번째 줄) | 있음 (종류·기술, 작고 회색) | 없음 |
| 테두리 | 1.2px | 1.5px 계열 |
| 노드 글자 | 13.05 / 12.18px, 400 | 노드 이름이 더 크고, 그룹 제목은 굵게 |
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

monolith, health-plan, airport, city DSL은 데이터에서 자동 변환해서 길어요(43~136줄). `/home/bgk/personal/eraser-ref/_A/dsl/<slug>.eraser` 에 있어요. 모양 예 (health-plan 앞부분):

```eraser
direction right
typeface clean
"lane-providers" [label: "Providers and payers", icon: hospital, styleMode: plain, color: gray] {
  "provider-ehrs" [label: "Provider EHRs", icon: hospital, styleMode: plain, color: gray]
  "provider-portal" [label: "Provider portal", icon: app-window, styleMode: plain]
}
"lane-front" [label: "Front door", icon: door-open, styleMode: plain] {
  "api-gateway" [label: "API gateway", icon: aws-api-gateway, styleMode: plain]
}
"provider-ehrs" > "api-gateway"
"api-gateway" > "provider-ehrs"
```

## 7. 남은 일

| slug | layout.json | 캡처·styles.json | ours.png |
|---|---|---|---|
| c4-model-food-delivery | 완료 | 완료 | 완료 |
| c4-model-monolith-to-services | 완료 | 완료 | 완료 |
| c4-model-four-levels | 완료 | 완료 | 완료 |
| architecture-review-health-plan | 완료 | 완료 | 완료 |
| business-capability-map-utility | 완료 | 완료 | 완료 |
| enterprise-reference-architecture-airport | 완료 | **다른 세션이 캡처 중** | 완료 |
| enterprise-reference-architecture-city | 완료 | **다른 세션이 캡처 중** | 완료 |

- 캡처 묶음: `page.png`, `embed.png`, `embed-dark.png`, `view-1~4.png`, `zoom-node/node-dashed/label/group.png`, `ui-zoom-menu.png`, `ui-filter.png`.
- 교차 확인: 저작 좌표(`layout.json`)와 화면(`view-1.png`)을 대조했어요. 역량 맵 그룹 폭이 자식 수에 맞게 줄고 왼쪽 정렬되는 것, C4 행 정렬, 범례 위치가 화면과 일치해요.
- 스크립트: `_A/capture.cjs` (클릭마다 4초 타임아웃, 전체 240초 제한. 저장 뒤 브라우저 종료가 멈추는 경우가 있어 "hard timeout" 로그가 찍혀도 결과 파일은 정상), `_A/analyze.py`, `_A/todsl.py`, `_A/ours.mts`, `_A/styletab.py`.
