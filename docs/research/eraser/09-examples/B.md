# Eraser 예시 조사 — 그룹 B

대상 7개: `merger-application-rationalization-credit-unions`, `integration-landscape-distributor`, `data-lineage-hotel-group`, `it-ot-architecture-food-plant`, `ai-governance-map-telecom`, `vdi-architecture-hospital`, `mainframe-modernization-pensions`.

- 조사일: 2026-11-13. 캡처·측정 파일은 저장소 밖 `eraser-ref/<slug>/`에 있어요 (`page.png`, `embed.png`, `embed-100.png`, `crop-*.png`, `view-*.png`, `ui-*.png`, `layout.json`, `styles.json`, `styles-data.json`, `ours.*`, `compare.png`).
- 우리 쪽 비교 기준: develop `1f3bb6c`의 `shared/render`.
- Eraser 파일(JS·CSS·폰트·아이콘)은 가져오지 않았어요. 숫자와 캡처만 써요.

## 0. 핵심 발견

1. **배치는 자동 배치가 아니에요.** 임베드 페이지 안의 데이터(`script#map-present-data`)에 모든 요소의 `x, y, width, height`와 선의 꺾임점이 정수로 들어 있어요. 지도는 사람(또는 AI)이 좌표를 정해 둔 결과예요. ELK 결과와 똑같이 맞추려 하기보다 "이런 규칙을 지키는 배치"를 목표로 잡아야 해요.
2. **노드는 고정 폭 열이에요.** 같은 열의 노드는 폭이 같고(예: 168×52, 214×56, 260×56) 왼쪽 x가 같아요(같은 x를 공유하는 노드 비율 0.82~1.0). 우리는 글자에 맞춘 폭이라 열마다 폭이 들쭉날쭉해요.
3. **간격이 더 촘촘해요.** 그룹 안 세로 간격 최빈값 12px, 그룹 안쪽 여백 좌우 12~20 / 위 40 / 아래 12~14. 우리는 20 / 40 / 20, 노드 간 20.
4. **선 끝은 변의 가운데, 여러 개면 균등 분할이에요.** 끝점 위치 최빈값은 `left:0.5`, `right:0.5`. 한 변에 2~4개가 붙으면 0.25/0.75, 0.33/0.67처럼 고르게 나눠요. 꺾이는 선의 모서리는 반지름 6px 원호예요.
5. **'진행판'에 바로 쓸 만한 것은 Flow 재생이에요.** 단계마다 `travel-line`(선 따라 이동, 800ms, ease-in-out)과 `pulse`(노드 깜박임, 700ms)를 시간표로 겹쳐 재생하고, 나머지 요소는 흐리게 해요. 아래 4절에 정리했어요.

## 1. 예시별 요약

| slug | 제목(view 0) | 보기 수 | 요소 수(전체 보기 합) | 흐름 | 필터 | 구조 |
|---|---|---|---|---|---|---|
| merger-application-rationalization-credit-unions | Two estates | 5 | Shape 244, Group 95, Rel 56 | 3 | Disposition, Credit union | 역량(capability) 격자 × 두 조합 열. view 0에는 선이 없어요 |
| integration-landscape-distributor | The landscape | 5 | Shape 237, Group 30, Rel 200, Divider 7 | 3 | Domain, At the cutover | 가운데 큰 허브 3개(세로로 쌓음) + 둘레에 도메인 그룹, 범례·야간 배치 표 |
| data-lineage-hotel-group | The platform | 5 | Shape 245, Group 39, Rel 207 | 3 | Layer, Classification, Domain | 왼→오 7열(Sources→Ingestion→Bronze→Silver→Gold→Semantic→Reports), 행 라벨 왼쪽 |
| it-ot-architecture-food-plant | L4–5 Enterprise | 4 | Shape 123, Group 41, Rel 59 | 3 | Purdue level, Vendor | 위→아래 계층(Purdue 레벨) 띠, 레벨 사이 세로 선 |
| ai-governance-map-telecom | AI landscape | 5 | Shape 137, Group 27, Rel 112, Icon 7 | 4 | Model provider, Approval status | 왼→오 4열(사람 → 에이전트 → 도구 → 시스템), 오른쪽 Models/Oversight |
| vdi-architecture-hospital | Two pods | 5 | Icon 188, Group 68, Rel 95, Shape 16 | 4 | Pod, Role | 큰 아이콘(48px)+글자 노드, 두 Pod 대칭 배치 |
| mainframe-modernization-pensions | Today | 5 | Shape 187, Group 18, Rel 82 | 4 | Runs on, Moved in | 보기마다 같은 배치에서 상태만 바뀌는 단계 비교(Today→Target) |

공통 화면 구성: 왼쪽 위 제목(16px 700) + 보기 이동 `‹ ›` + 설명(13px #666), 오른쪽 위 줌 `90%`, 왼쪽 아래 필터 버튼, 흐름이 있으면 제목 아래 `▷ <흐름 이름>` 버튼. 처음 열면 화면에 맞춰 0.9배(`--dc-k: 0.9`)로 보여요.

## 2. 배치 측정 (view 0, 데이터 좌표 기준)

측정은 데이터의 요소 좌표로 했어요 (`layout.json`). "행" = 같은 부모·같은 y, "열" = 같은 부모·같은 x.

| slug | 노드 크기 최빈값 | 같은 행 가로 간격 | 같은 열 세로 간격 | 그룹끼리 간격 (가로/세로) | 그룹 안쪽 여백 L/T/R/B | 4px 격자 비율 |
|---|---|---|---|---|---|---|
| merger | 214×56 (34) | 44, 10 | – | 20 / 14 | 14 / 40 / 14 / 14 | 0.41 |
| integration | 168×52 (14), 222×32 (14) | 6, 40 | 2(표 행), 24, 20, 28 | – | 12 / 40 / 12 / 12 | 0.76 |
| data-lineage | 148×52 (24), 176×52 | – | **12** (19), 44 (14) | 32 / – | 12 / 64 / 12 / 20 | 0.68 |
| it-ot | 154×56 (15) | 24 | 12 | 20 / 10 | 192(레벨 라벨 자리) / 14 / 24 / 14 | 0.66 |
| ai-governance | 260×56 (19), 300×64 | – | 12 (16), 36 | 80 / 42 | 20 / 44 / 20 / 24 | 0.53 |
| vdi | 아이콘 48px + 글자 | 128 | 52, 86 | 16 / 20 | 46 / 40 / 46 / 52 | 0.72 |
| mainframe | 180×56, 200×56 | 20, 8 | 72 (17) | – / 8 | 14 / 40 / 14 / 12 | 0.56 |

읽는 법과 규칙:

- **그룹 제목 띠 = 위 여백 40px.** 제목은 그룹 왼쪽 위에서 (7.6, 7.7) 떨어져 있고 높이 20.8px이에요. 첫 노드는 그룹 top + 40에서 시작해요 (data-lineage는 행 라벨 맞춤 때문에 64).
- **노드 높이는 52 또는 56이 거의 전부예요** (전체 1189개 중 56: 499, 52: 335). 작은 칩·표 행은 30~34. 폭은 열마다 하나로 고정해요(텍스트 맞춤 아님). 글자가 넘치면 3줄까지 감싸요(`data-text-max-lines="3"`).
- **격자는 엄격하지 않아요.** 4로 나뉘는 좌표가 41~76%. 2px 단위로 맞춘 값이 많아요.
- **방향**: 계보·흐름은 왼→오, 계층(Purdue)은 위→아래. 허브형(integration)은 허브를 가운데 세로로 쌓고 도메인 그룹을 양옆에 둬요.
- **선 경로**:
  - 직교 선 비율 1.0 (ai-governance만 0.5 — `connectorStyle: straight` 대각선 99개를 섞어 써요).
  - 꺾임점 수: 대부분 2점(일직선). 꺾이면 4점(Z자). Z자에서 꺾이는 위치는 0.3~0.7 사이로 고정값이 아니라 다른 선과 겹치지 않는 자리예요.
  - 같은 변에서 여러 선이 나가면 꺾이는 x를 **5px씩 엇갈려요** (vdi: 204 / 209 / 214 / 224). 한 노드에서 여러 노드로 갈라지면 **같은 줄기(같은 x)를 공유**하다가 갈라져요 (ai-governance: 세 선이 모두 x=278에서 꺾임).
  - 끝점: 변 가운데(0.5)가 기본, 한 변에 여러 개면 0.25/0.5/0.75 등 균등 분할.
  - 꺾임 모서리: 반지름 6px 원호 (`A6 6`).
- **라벨**: 25개뿐이에요. 위치는 선 시작점 기준 `{x: n, y: -10}` — 선 바로 위에 붙어요(선 가운데 아님).
- **범례·제목**: 범례는 오른쪽 위의 일반 노드 3개 + `Legend` 글자(11.31px #98A2B3). 지도 제목·요약 숫자는 텍스트박스(오른쪽 정렬 26 / 왼쪽 10 / 가운데 5).

## 3. 스타일 측정 (렌더된 DOM, `getComputedStyle` 기준, 화면 배율 1)

c4-model-food-delivery 값과 같으면 "= C4"로 적었어요.

### 글꼴

| 항목 | 값 |
|---|---|
| 글꼴 | `Inter var` (100–900), 전 요소 weight 400 (= C4) |
| 크기 체계 | 데이터 크기 × 0.87: 15→13.05, 14→12.18, 13→11.31, 12→10.44, 11→9.57 |
| 자간 | 글자 크기의 −1% (11.31px → −0.1131px) |
| 줄 높이 | 1.25 (노드 글자), 1.4 (그룹 제목) |
| 노드 제목 / 부제 | 11.31~13.05px #101828(또는 #242424) / 9.57~10.44px #667085, 가운데 정렬 |

### 노드

| 항목 | 값 |
|---|---|
| 테두리 | 1.2px (= C4). 기본 #D0D5DD 또는 #EAECF0 |
| 채움 | 기본 #FFFFFF. 색 노드는 연한 채움 + 진한 테두리 (예: #EFF8FF/#84CAFF, #F9F8FF/#7A5AF8, #FFFAEB/#FDB022) |
| 모서리 | 짧은 변의 15%, 최대 12px (52px 높이 → 7.8px) |
| 그림자 | `styleMode: shadow`일 때 같은 모양을 (+4, +4) 옮겨 #E8E8E8로 칠함, 흐림 없음, 본체 밖만 보임 (= C4). `plain`은 그림자 없음 (683 plain / 506 shadow) |
| 점선 | dashed `8 8.75`, dotted `1.5 6.75` — 외부 시스템, 은퇴 예정 등 |
| 아이콘 | 18px, 노드 왼쪽에서 15~23px, 색 #475467 (상태색이면 그 색). 글자는 아이콘 오른쪽 남은 폭에서 가운데 |
| 배지 | 노드 오른쪽 위 모서리에 걸침, 9.57px 흰 글자, 채움(#DC6803 주황, #079455 초록, #444CE7 남색, #D92D20 빨강), 반경 5px, 안쪽 4px |
| 원통 | `cylinder` 24개, 위 뚜껑 타원 높이 6.16 |

### 그룹

| 항목 | 값 |
|---|---|
| 채움 | 반투명 회색 `rgba(242,244,247,0.5~0.6)` 또는 `rgba(249,250,251,0.6)`, 색 그룹은 같은 색 0.2~0.55 |
| 테두리 | 1px #EAECF0 / #E4E7EC, 반경 6px. 점선 그룹(37개)은 SVG rect 점선 `8 8.75`, rx 5.5 |
| 제목 | 왼쪽 위, 12.18px(10.44~13.05) 400, #475467, 아이콘 13.5px + 간격 5px, 배경·테두리 없음. 오른쪽 정렬 제목도 있음 |
| 큰 묶음 | Lakehouse처럼 그룹을 감싸는 상위 그룹은 채움 없이 점선만 |

### 연결선

| 항목 | 값 |
|---|---|
| 굵기 | **1.3px** (C4는 1.75). 강조선 3.5 / 5.25 |
| 색 | 회색 계열 #98A2B3, #A3ABB8, #AEB5C0, #667085. 흐린 배경선 #EEF0F3 / #EAECF0. 상태색 #F79009, #1570EF |
| 꺾임 | 직교, 모서리 반지름 6px 원호 |
| 화살촉 | 열린 V, 12×11 (사용자 좌표), 선 색 따라감 (= C4). 양방향 48개 |
| 점선 | dashed 70, dotted 17 |
| 라벨 | 12.18px, 선 색과 같거나 #667085, 배경 없음, 선 위쪽 10px |

### 다크 모드

없어요. 데이터에 `theme: "light"`가 고정이고 `prefers-color-scheme: dark`로 바꿔도 배경 #FFFFFF 그대로예요 (`embed-dark.png`).

## 4. 기능 관찰

- **보기(View) 전환** — 제목 드롭다운(`5 views`, 검색 가능) + `‹ ›`. 보기는 같은 좌표계라 바뀐 부분만 바뀌어 보여요(mainframe: Today → Target).
- **하위 보기 열기** — 노드 위에 작은 '레이어' 아이콘(겹친 사각형)이 붙으면 클릭해서 다른 보기로 이동(`links: {from, viewId, kind: "fade"}`).
- **필터** — 왼쪽 아래 버튼. 값을 고르면 나머지 요소를 흐리게 해요.
- **줌** — 오른쪽 위 `90%` 드롭다운: 직접 입력, Zoom to fit(⇧1), Zoom to 100%(Ctrl 0).
- **노드 클릭** — 레코드(설명·필드 7개)를 보여줘요.

### Flow 재생 (진행판과 겹치는 부분, 자세히)

데이터 구조:

```json
{ "id": "dispute", "name": "A customer disputes a bill", "description": "...",
  "steps": [
    { "label": "The customer asks about the bill", "description": "...",
      "animation": { "effects": [
        { "ref": "<line id>", "type": "travel-line", "start": 0,   "stop": 800,  "easing": "ease-in-out" },
        { "ref": "<node id>", "type": "pulse",       "start": 700, "stop": 1400 } ] } } ] }
```

- 효과는 두 가지: `travel-line`(선을 따라 파란 선이 그려짐) 800ms, `pulse`(노드 테두리 강조) 700ms. 다음 효과는 앞 효과가 끝나기 100~200ms 전에 시작해 이어져 보여요 (0–800 선 → 700–1400 노드 → 600–1300 다음 선 …).
- 재생 중 화면 (`ai-governance-map-telecom/flow-step1-end.png`):
  - 이번 단계와 관련 없는 요소는 약 20~25% 불투명도로 흐려져요. 이전 단계에서 지난 요소는 진하게 남아요.
  - 지나간 선은 파랑(#2866DF 계열)으로 굵어지고, 현재 노드는 파란 이중 테두리 + 왼쪽 위 파란 동그라미 번호(①).
  - 현재 노드 옆에 검은 말풍선: 번호 + 단계 제목(굵게) + 설명.
  - 아래 가운데 재생 막대: 흐름 이름, `1 / 5`, 점 5개, 이전·일시정지·다음, 화면 맞춤 버튼, 아래에 진행 막대.
  - 제목 아래 `▷ 흐름 이름` 버튼이 `‖`로 바뀌어요.
- 진행판에 쓸 점: 단계 = (선 이동 + 노드 강조) 묶음, 시간표는 겹쳐서 이어짐, 나머지는 흐리게, 번호·말풍선·하단 막대. 우리 Pipeline 실행 상태(대기/진행/완료)를 "흐림/파랑 진행/진하게 남음"에 대응시키면 돼요.

## 5. 우리와의 차이 (develop `1f3bb6c`, 대표 4개)

비교 파일: `<slug>/ours.eraser`(아래 코드), `ours.svg/png`(flowchart), `ours-cloud.svg/png`(cloud-architecture), `compare.png`(왼쪽 Eraser, 오른쪽 우리).

`cloud-architecture`로 그리면 아이콘 노드가 상자 없이 아이콘+글자로 나와요. Eraser 지도의 노드는 "상자 + 왼쪽 아이콘"이라 `flowchart` 쪽이 더 가까워 그쪽으로 쟀어요.

### 배치 차이 (먼저)

| 항목 | Eraser | 우리 (ELK) |
|---|---|---|
| 노드 크기 | 열마다 고정 폭, 높이 52/56 | 글자에 맞춘 폭 96~184, 높이 44 → 같은 열이 들쭉날쭉 |
| 같은 열 세로 간격 | 12 | 20 |
| 그룹 안쪽 여백 L/T/R/B | 12~20 / 40 / 12~20 / 12~14 | 20 / 40 / 20 / 20 (it-ot는 아래 43~82로 남는 공간) |
| 그룹끼리 간격 | 20~80 (열 사이 32·80) | 레이어 간격 64 고정 + 선 라우팅 공간 |
| 전체 비율 | 넓은 가로(약 1600×900), 화면 채움 | data-lineage 1556×444, ai-governance 1248×528 — 납작하고 넓거나(왼→오) 길쭉함(it-ot 731×1000) |
| 열 정렬 | 같은 역할은 같은 열·같은 x | ELK 레이어가 그룹 경계를 넘나들어 그룹 안 노드가 여러 레이어로 흩어짐 |
| 선 끝점 | 변 가운데, 여러 개면 균등 분할 | ELK 포트 위치(균등이지만 간격 다름) |
| 꺾임 | 2점 직선 위주, 꺾이면 Z 한 번 | 4~6점 꺾임이 많음 (ai-governance 최대 9점) |
| 갈라지는 선 | 같은 줄기 공유 후 갈라짐 | 각자 따로 감 |

### 스타일 차이 (다음)

| 항목 | Eraser | 우리 |
|---|---|---|
| 노드 테두리 | 1.2px #D0D5DD | 1.5px |
| 노드 모서리 | 짧은 변 15%, 최대 12 (52px → 7.8) | rx 8 고정 (그룹 12) |
| 그룹 모서리 | 6px, 테두리 1px | rx 12 |
| 선 굵기 | 1.3px | 1.92px |
| 글자 | 11.31 / 9.57px, 400, 자간 −1% | 13px |
| 그림자 | (+4,+4) #E8E8E8 단색 | 반투명 그림자 (`rgba(15,23,42,0.10)`) |
| 다크 모드 | 없음 | 있음 |

### 우리 DSL 코드

`ai-governance-map-telecom` (나머지 3개는 `eraser-ref/<slug>/ours.eraser`):

```
title AI governance map
direction right

Customers [icon: users]
Care reps [icon: users]
AI agents [icon: bot, color: blue] {
  Care assistant [icon: bot, color: blue]
  Billing-dispute agent [icon: file-text, color: blue]
  Refund agent [icon: wallet, color: blue]
  Care-rep copilot [icon: sparkles, color: blue]
}
Tools and MCP servers [icon: settings] {
  Knowledge search [icon: book]
  Billing MCP [icon: file-text]
  Payments MCP [icon: credit-card]
  Approval queue [icon: user]
  Case notes MCP [icon: inbox]
}
Systems and data [icon: database] {
  Knowledge base [icon: book]
  Billing system [icon: file-text]
  Payment vault [icon: lock]
  Case notes [icon: archive]
}
Oversight [icon: shield] {
  Care supervisors [icon: user]
}

Customers > Care assistant
Care reps > Care-rep copilot
Care assistant > Billing-dispute agent
Care assistant > Refund agent
Care assistant > Knowledge search
Billing-dispute agent > Billing MCP
Billing-dispute agent > Approval queue
Refund agent > Payments MCP
Refund agent > Approval queue
Care-rep copilot > Knowledge search
Care-rep copilot > Case notes MCP
Knowledge search > Knowledge base
Billing MCP > Billing system
Payments MCP > Payment vault
Case notes MCP > Case notes
Approval queue > Care supervisors
```

## 6. 렌더러에 줄 제안 (우선순위 순)

1. 그룹(열) 안 노드 폭을 그룹 안 최댓값으로 통일하고 높이 52를 기본으로.
2. 그룹 안 세로 간격 12, 여백 12~20/40/12~14로 줄이기.
3. 선 굵기 1.3, 노드 테두리 1.2, 모서리 = min(12, 짧은 변 × 0.15), 꺾임 반지름 6.
4. 선 끝점을 변 가운데 기준 균등 분할, 같은 출발점의 선은 줄기 공유.
5. 그림자를 (+4,+4) #E8E8E8 단색 오프셋으로.

## 7. 남은 일

- `merger`, `vdi`, `mainframe` 3개는 측정·캡처만 했고 우리 DSL 비교는 안 했어요.
- `compare.png` 4장은 만들었지만 눈으로 하나씩 대조한 메모는 아직 없어요.
