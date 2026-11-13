# 09-examples · 그룹 D: 네트워크·인프라 예시 7개

조사일 2026-11-13. 대상은 eraser.io/examples의 공개 예시 7개예요. 숫자는 embed(`/embeds/maps/<slug>/`)에서 직접 읽었어요. 캡처와 원자료(`data.json`, `layout.json`, `styles.json`, `compare.png`)는 저장소 밖 `/home/bgk/personal/eraser-ref/<slug>/`에 있어요. Eraser 파일(JS·CSS·폰트·아이콘)은 저장소에 넣지 않았고, 숫자만 옮겼어요.

| slug | 뷰 | 흐름(재생, 뷰별 합계) | 필터 | 깊이 비교 |
|---|---|---|---|---|
| campus-network-university | 4 | 2 | Vendor, Firmware status | ✅ |
| data-center-fabric-spine-leaf | 4 | 4 | Row, Hardware generation | ✅ |
| network-weathermap-isp | 5 | 4 | Ring, Role | ✅ |
| data-center-to-aws-migration | 4 | 4 | Strategy, Wave, Criticality | ✅ |
| layered-network-osi | 5 | 6 | Building, Device role | 측정만 |
| azure-landing-zone-mining | 5 | 3 | Business unit, Deployed by | 측정만 |
| multi-tenant-saas-oci | 5 | 3 | Tier, Data stored | 측정만 |

## 0. 가장 중요한 발견

1. **Eraser 예시는 자동 배치가 아니에요.** embed 안 `<script id="map-present-data">` JSON에 모든 요소의 절대 좌표(`x, y, width, height`)와 선의 꺾임점(`points`)이 저장돼 있어요. 렌더러는 이 좌표를 `transform: translate()`로 그대로 놓기만 해요. 그래서 "ELK 결과를 Eraser처럼"이라는 목표는 **사람이 손으로 정리한 배치 규칙을 ELK 후처리로 흉내 내는 일**이에요(아래 §3 규칙).
2. **글자 크기는 작성값 × 0.87로 렌더돼요.** 15→13.05, 14→12.18, 13→11.31, 12→10.44, 11→9.57, 26→22.62. 선 굵기는 `lineWidth` × 1.75예요(1→1.75, 2→3.5, 3→5.25, 5→8.75). 기본값은 1.3px이에요.
3. **노드 모서리 반경은 `min(12, 0.15 × 높이)`예요.** 높이 40→6, 48→7.2, 52→7.8, 56→8.4, 60→9, 64→9.6, 72→10.8, 80 이상→12. 그룹은 6px 고정이에요.
4. **같은 변에서 여러 선이 나가면 포트를 균등 분할해요.** 대부분 `(i+0.5)/n`이고(2개→0.25/0.75, 4개→.125/.375/.625/.875, 5개→.1…​.9), 풀메시(spine-leaf)는 `i/(n+1)`이에요(10개→0.09…​0.91). 선이 1개면 변의 정중앙(0.5)이에요.
5. **다크 모드가 없어요.** embed는 `prefers-color-scheme: dark`를 무시하고, 7개 모두 `theme: "light"`예요. `embed-dark.png`도 흰 배경이에요.

## 1. 예시별 요약

### campus-network-university: 위→아래 트리, 건물 5열
- 맨 위 ISP 2개, 그 아래 방화벽·리서치 경계, 다시 아래 코어가 와요. 코어에서 건물 그룹 5개(각 280×442, 가로 간격 30)로 버스형 선이 내려가요.
- 건물 안: 분배 스위치 → 액세스 스위치가 세로 1열(200×56, 세로 간격 36)이에요. 말단 3개(176×56)는 **40px 들여쓰기**한 세로 목록이고, 간격은 6이에요. 말단은 부모 왼쪽 변 8% 지점에서 내려오는 **왼쪽 레일**(`firstSeg` 24)로 묶여요. 트리 리스트 같은 모양이에요.
- 데이터센터 그룹: 넓은 스위치(532×56) 아래 소형 4개(124×64, 간격 12)가 한 줄로 서고, 각각 위로 0-bend 직선이 올라가요.
- 범례는 맨 아래 칩 8개예요(176×56, 간격 16, Textbox 제목 "Network segments").
- 선 두 계층: 백본 `#667085` 3.5px, 액세스 `#98A2B3` 1.3px. 화살촉 없음.

### data-center-fabric-spine-leaf: 3단 밴드 + 풀메시
- 가로 밴드 그룹 3개(Spines / Leaves / Rows)가 세로로 쌓여요. Leaves 안에는 쌍(pair) 그룹 5개(300×100, 간격 24)가 있고, 각 쌍에 130×56 노드 2개(간격 12)가 들어가요.
- 랙은 60×150 세로 막대, 간격 10, **모서리 0**이에요(랙 느낌).
- spine↔leaf 40개 선은 `connectorStyle: straight`로 **대각선 직선**이에요. 꺾지 않아요. 색 `#C5CBD3`(옅게) 1.3px.
- 장애 뷰(`leaf-c1-fails`): 끊긴 선 `#F04438` 점선, 우회 경로 `#1D4ED8`, 노드에 빨간 "Down" 배지(top-right).

### network-weathermap-isp: 링 3개 + 굵기로 용량 표현
- 노드는 박스 없는 48px 아이콘(`Icon` 요소)과 그 아래 라벨 2줄이에요.
- 링 그룹 3개는 1080×150 같은 크기로 세로로 쌓이고(간격 30), 허브는 같은 x열에 정렬돼요(가로 중심 일치율 100%). 그룹 제목은 **오른쪽 정렬**이에요.
- 코어→링 선은 그룹 바깥을 도는 **평행 레인**(약 20px 간격, 꺾임 반경 6)이에요. 굵기 1.75/3.5/5.25/8.75로 용량을 나타내요.
- 선 라벨 "100G"는 **선 위 가운데에 놓이고, 그 자리에서 선이 끊겨요**(SVG mask). 배경 상자는 없고 글자색은 선 색과 같아요.
- peak/caches/cut 뷰는 선 색만 바꿔요(초록 `#17B26A` / 노랑 `#EAAA08` / 빨강 `#D92D20`). 같은 배치에 상태를 덧칠하는 방식이에요.
- 범례: 선 굵기를 그대로 테두리 굵기로 쓴 칩 4개(228×40, 간격 12)예요.

### data-center-to-aws-migration: 격자 카드 + 웨이브 배지
- 큰 그룹 2개(712×512, 간격 56)가 좌우로 놓여요. 안쪽은 **3열 × 4행 격자**(208×60, 가로 24 / 세로 36)예요.
- 그룹 하단에 Divider("Platform", 1.3px `#98A2B3`, 라벨이 선 가운데를 끊음)가 있고, 그 아래 160×40 소형 칩 4개(간격 8)가 와요.
- 노드 오른쪽 위 모서리에 걸친 배지("Wave 1", 9.57px, `#1849A9` / `#E0EAFF`, 반경 5, 패딩 4).
- 선: `#1c1c1c` 1.3px, 끝에 열린 화살촉(12×11, userSpaceOnUse).
- 뷰 전환(current → wave-1 → target)으로 노드가 왼쪽 그룹에서 오른쪽 그룹으로 옮겨가요. 단계별 상태 표시로 쓸 수 있어요.

### layered-network-osi (측정만)
- 레이어 뷰 5개(L1…L4, dig)가 **같은 좌표**를 써요. 그 레이어에 속하지 않는 요소는 옅게(faded) 처리돼요. 범례는 "This layer / On the path / Not at this layer"예요.
- 좌표는 10의 배수 비율이 67%로 가장 높아요. 노드 200×60, 세로 간격 40~54예요.
- 강조 선은 주황 `#DC6803` 3.5px, 라벨도 주황이에요. 세로 Divider는 점선이에요(1.3px `#D0D5DD`).

### azure-landing-zone-mining (측정만)
- 관리 그룹 트리예요. 루트 2개(위)에서 버스가 수평으로 갈라져 그룹 4개로 내려가요. 그룹 안은 160×72 카드 격자(가로 20 / 세로 40)예요.
- 그룹마다 색 테마가 있어요(파랑 `#A4BCFD`, 청록 `#99F6E0`, 노랑 점선 `#FEC84B`, 회색 점선). 제목 아래 설명 Textbox(11.31px `#667085`)가 와요.
- 그룹 패딩은 L14 / T53(제목+설명) / R14 / B14로 일정해요.

### multi-tenant-saas-oci (측정만)
- 왼→오 흐름이에요. 그룹 16개가 중첩되고 점선 그룹이 많아요(`#D9B69C` dashed). 노드 170~180×52, 가로 간격 14/36, 세로 8/10으로 촘촘해요.
- 선은 모두 화살촉 있음, 색은 티어별(초록 `#16B364`, 보라 `#7A5AF8`, 파랑 `#2E90FA`)이에요.
- 노드 반경 7.8(높이 52 × 0.15). 1줄 11.31px, 2줄 9.57px로 다른 예시보다 한 단계 작아요.

## 2. 배치 측정표

값은 첫 뷰 기준 최빈값이고, 괄호 안은 횟수예요. 원자료는 `layout.json`에 있어요.

| 예시 | 노드 크기 | 가로 간격 | 세로 간격 | 같은 top 비율 | 그룹 패딩 L/T/R/B | 꺾임 수 | 직선 비율 |
|---|---|---|---|---|---|---|---|
| campus | 176×56 (23), 200×56 (10), 124×64 | 16 (7), 30, 12 | 6 (10), 44, 36, 32 | 0.94 | 40/66/24/16 (트리 들여쓰기 포함) | 1 (17), 0 (13), 2 | 0.37 |
| spine-leaf | 60×150 (16), 130×56 (14), 190×56 | 10, 12, 24, 80 | 64, 88, 44 | 0.96 | 14/32/14/12, 16/40/14/22 | 0 (52) | 1.0 |
| weathermap | 48×48 아이콘, 228×40 칩 | 362, 212 (허브) | 30 (링), 12 (칩) | 0.77 | 106/52/106/50 | 0, 2, 1 | 0.48 |
| aws-migration | 208×60 (13), 160×40 | 24 (9), 8 | 36 (9), 40 | 0.90 | 20/44/20/20 | 0, 2 | 0.63 |
| osi | 200×60, 180×56 | 40, 16 | 44, 40, 50 | 0.62 | 제각각 | 0, 2 | 0.63 |
| azure | 160×72 (17) | 20 (13) | 40 (6) | 0.89 | 14/53/14/14 (6) | 2, 4 | — |
| oci | 170×52, 172×52 | 14, 36 | 8, 10 | 0.58 | 12/34/12/12 | 0 (20), 2 | 0.74 |

공통 규칙:

| 항목 | 값 |
|---|---|
| 좌표 격자 | 2px 격자 100%. 4px 격자는 30~88%로 예시마다 달라서 엄격한 스냅은 없어요. |
| 행 정렬 | 같은 컨테이너 안 노드의 top이 같은 비율 0.6~0.96. **행 단위 정렬**이 기본이에요. |
| 노드 크기 | 텍스트 맞춤이 아니라 **행·열마다 고정 폭**이에요. 한 다이어그램에 크기 종류가 2~4개뿐이에요. 높이는 56/60이 기본이고 소형 칩은 32/40이에요. |
| 그룹 제목 영역 | 제목 위치 (8~9, 8~9), 패딩 3px 5px. 첫 자식 top까지 32~44(제목만) 또는 53~66(제목+설명). |
| 그룹 사이 간격 | 24~30(같은 줄), 30~56(큰 블록 사이). |
| 선 시작 스텁 | 꺾이는 선의 첫 구간은 18~40(campus 24, azure 38, osi 40). 꺾임은 **간격 가운데가 아니라 출발 노드 가까이**에 생겨요. |
| 선 끝점 | 노드 변 위(박스 노드). 아이콘 노드(weathermap)는 아이콘 중심으로 모여요. |
| 다중 포트 | `(i+0.5)/n` 균등 분할. 풀메시는 `i/(n+1)`. |
| 꺾임 모양 | `cornerStyle: elbow`, 모서리 호 반경 6(SVG `A 6 6`). |
| 설명 텍스트 | 오른쪽 위 Textbox(11.31px `#98A2B3`, 오른쪽 정렬, 폭 400~560). 범례는 왼쪽 아래예요. |

## 3. 스타일 측정표

`styles.json`의 computed style 값이에요.

| 요소 | 값 |
|---|---|
| 글꼴 | `Inter var`. 자간 -1%(-0.01em). 줄높이 1.25배(노드), 1.4배(그룹 제목). |
| 노드 1줄 | 13.05px 400 `#242424`(작은 노드 11.31px). |
| 노드 2줄(부제) | 10.44px 400 `#6B7280` 또는 `#667085`(작은 노드 9.57px). |
| 노드 테두리 | 1.2px. shadow 스타일은 `#242424`, plain 스타일은 `#D0D5DD`. 색 강조는 `#2E90FA`, `#16B364` 등. |
| 노드 채움 | 투명 또는 `#FFFFFF`. 강조는 연한 틴트(`#EFF4FF` / `#1D4ED8`, `#FEF3F2` / `#D92D20`). |
| 노드 그림자 | 블러 없음. `#E8E8E8` 같은 모양을 (+4, +4) 밀어 놓고 본체 바깥만 남게 clip(evenodd)해요. |
| 노드 반경 | `min(12, 0.15·h)`. |
| 노드 아이콘 | 20px(lucide, stroke 1.5), 왼쪽 정렬, 텍스트는 남은 영역 가운데. 색 `#242424` 또는 `#667085`. |
| 아이콘 노드 | 48px 아이콘 + 아래 라벨 13.05px `#1D2939`, 부제 10.44px. |
| 그룹 | 테두리 1px solid, 반경 6. 배경은 반투명 틴트(`rgba(242,244,247,0.55)` 등). 점선은 `8 8.75`, 도트는 `1.5 6.75`. |
| 그룹 제목 | 12.18~13.05px 400 `#475467`, 아이콘 15px. 굵게 쓰지 않아요. 배경 없음. 정렬은 왼쪽(기본) 또는 오른쪽. |
| 그룹 shadow 스타일 | `box-shadow: #E8E8E8 4px 4px 0 0`. |
| 연결선 | 기본 1.3px. 색 `#98A2B3`(보조), `#667085`(주), `#1c1c1c`(흐름). linecap butt. |
| 화살촉 | 열린 V `M0,0 L12,5.5 L0,11`, userSpaceOnUse 12×11. |
| 선 라벨 | 12.18px, 색은 선 색과 같음, 배경 없음. 라벨 자리에서 선이 mask로 끊겨요. 위치는 `labelPlacement {x, y}`(시작점 기준 오프셋). |
| 배지 | 9.57px, 반경 5, 패딩 4, 노드 오른쪽 위에 걸쳐요(`placement: top-right`). |
| Divider | 1.3px, 라벨이 가운데에서 선을 끊어요(12.18px). |
| 캔버스 | 흰 배경, 점 격자 없음. 기본 줌 80~100%(fit). |

## 4. 우리 렌더러와의 차이

기준은 develop `1f3bb6c`의 `shared/render`(ELK layered)예요. 나란히 놓은 이미지는 `eraser-ref/<slug>/compare.png`이고, 우리 쪽 측정값은 `ours-layout.json`이에요.

### 4.1 배치 차이(우선)

1. **트리 방향이 뒤집혀요.** campus에서 `Access - Distribution`, `Distribution - Core`처럼 자식→부모로 쓰면, ELK는 선 방향대로 층을 나눠서 말단이 위, 코어가 아래로 가요. Eraser는 위계 순서(ISP → 코어 → 건물 → 말단)예요. → 무방향 선 `-`은 층 배정에 쓰지 말고, 그룹 위계나 정의 순서로 층을 정해야 해요.
2. **형제 순서가 섞여요.** spine-leaf에서 `Spine 1..4`가 `3,1,2,4`로, 랙 `A01..A03`이 `A03,A01,A02`로 나와요. Eraser는 항상 작성 순서 그대로예요. → 같은 층 안에서는 모델 순서를 강제해야 해요(`considerModelOrder`만으로는 부족해요).
3. **연결 없는 노드가 아무 데나 쌓여요.** aws-migration에서 Eraser는 그룹 안을 **3열 격자**(가로 24 / 세로 36)로 채워요. ELK는 선이 있는 노드만 층을 나누고, 나머지는 첫 층에 세로로 쌓아요. → 선이 적은 그룹은 격자 배치(packing)로 따로 처리해야 해요.
4. **풀메시가 스파게티가 돼요.** spine-leaf 40개 선을 ELK가 직교로 꺾어서 평행선 다발이 그룹 전체를 덮어요. Eraser는 대각선 직선 + 옅은 색이에요. → `connectorStyle: straight`(또는 선이 많을 때 자동으로)는 꺾지 말고 변 균등 포트에서 직선으로 그려야 해요.
5. **같은 레벨 그룹을 한 줄로 못 세워요.** campus 건물 5개는 Eraser에서 같은 top, 같은 크기(280×442)로 한 줄이에요. 우리는 내용에 따라 크기와 높이가 달라요. weathermap 링 3개도 Eraser는 같은 폭으로 세로로 쌓는데, 우리는 나란히 놓거나 좁게 접어요. → 형제 그룹의 폭·높이 맞추기(equalize) 옵션이 필요해요.
6. **간격이 한 가지예요.** 우리는 노드 간 20/40, 그룹 패딩 20/40/20/20으로 고정이에요. Eraser는 형제 노드 간 6~16(목록), 24(격자), 30~56(그룹 사이)으로 계층별로 달라요.
7. **꺾임 위치.** ELK는 층 사이 가운데에서 꺾어요. Eraser는 출발 노드에서 18~40px 나간 뒤 꺾어서 버스(공용 수평선)를 만들어요. 한 부모로 모이는 선은 같은 y에서 합쳐져요.

### 4.2 스타일 차이

| 항목 | Eraser | 우리 (`1f3bb6c`) |
|---|---|---|
| 노드 모양 | 테두리 카드(아이콘 왼쪽 20px + 제목/부제 2줄) | 박스 없는 아이콘(위) + 라벨(아래), 63px 높이 |
| 노드 테두리 | 1.2px, 반경 `min(12, .15h)` | 1.5px, 반경 8 고정 |
| 그림자 | `#E8E8E8` (+4, +4) 단색, 블러 없음 | `rgba(15,23,42,.10)` (+2, +3) |
| 그룹 제목 | 13px **400** `#475467`, 아이콘 15px | 13px **600**, 아이콘 18px |
| 그룹 반경·테두리 | 6px, 1px | 12px, 1.25px |
| 선 굵기 | 1.3px(기본), lineWidth × 1.75 | 1.5px 고정 |
| 선 꺾임 반경 | 6 | 8 |
| 화살촉 | 열린 V 12×11 | 채운 삼각형 |
| 선 라벨 | 배경 없음, 선 끊김, 선 색 | 흰 plate + 테두리 |
| 글자 | Inter var, 자간 -1%, 0.87 배율 | Inter, 자간 0 |
| 부제(2줄 텍스트) | 있음(`texts[1]`, 10.44px 회색) | 없음 |
| 배지 | 오른쪽 위 9.57px 칩 | 없음 |

## 5. 기능 메모

- **흐름(단계 재생)**: 진행판과 가장 많이 겹쳐요. 뷰마다 `flows[]`가 있고, 각 흐름은 `steps[]`(label, description, animation)로 이뤄져요. effect는 세 종류예요.
  - `pulse`: 노드 강조.
  - `travel-line`: 선을 따라 점이 이동, `ease-in-out`.
  - `shake`: 장애 표시.
  - 각 effect에 `start` / `stop`(ms)이 있어서 한 단계 안에서 순서대로 겹쳐 재생돼요(예: 선 0–800, 다음 선 600–1300, 노드 1200–1900).
  - 하단 바(`mf-bar`): 이름, n/총 단계, 점 표시, 이전/재생/다음/포커스 버튼, 단계 설명. 진행판의 "단계 → 노드·선 효과 타임라인" 데이터 모델로 거의 그대로 쓸 수 있어요.
- **뷰 전환**: 제목 드롭다운("4 views", 이름 검색)과 `<` `>` 버튼. 뷰끼리 좌표를 공유해서 상태만 바꾸는 방식(weathermap 색, osi 페이드)과 하위 뷰(`links[]`, `kind: "fade"`, 노드 위 "Expand" 버튼)가 있어요.
- **필터**: 왼쪽 아래 드롭다운(예: Vendor, Firmware status). 노드마다 `facets`를 갖고, 고르면 해당 노드만 강조돼요.
- **줌**: 오른쪽 위 "90%" 드롭다운. 입력칸, ±, "Zoom to fit ⇧1", "Zoom to 100% Ctrl 0".
- **노드 클릭**: 레코드 패널(`fields[]`: label/value/isWide)을 열어요.

## 6. 우리 DSL 코드 (비교에 쓴 것)

`eraser-ref/_D/dsl/*.eraser`에 같은 내용이 있어요. 렌더는 `node eraser-ref/_D/ours.mts <worktree> <file> <outDir>`로 해요.

<details><summary>campus-network-university</summary>

```
title Campus network
direction down
styleMode shadow

ISP [icon: globe, label: "Commercial ISP"]
REN [icon: globe, label: "Cascade Research Net"]
Firewall [icon: shield, label: "Edge firewalls"]
Research [icon: router, label: "Research border"]
Core [icon: network, label: "Campus core"]

Data center [icon: server] {
  DC switches [icon: network]
  WLC [icon: wifi]
  RADIUS [icon: key]
  DHCP [icon: tag]
  DNS [icon: globe]
}
Residence halls [icon: home] {
  Res dist [icon: network, label: Distribution]
  Res access [icon: network, label: "Access switches"]
  Res APs [icon: wifi, label: "Access points"]
  Res ports [icon: monitor, label: "Student ports"]
  Res cameras [icon: camera, label: "Cameras & doors"]
}
Library [icon: book] {
  Lib dist [icon: network, label: Distribution]
  Lib access [icon: network, label: "Access switches"]
  Lib APs [icon: wifi, label: "Access points"]
  Lib PCs [icon: monitor, label: "Public PCs"]
  Lib staff [icon: laptop, label: "Staff PCs"]
}
Science building [icon: flask] {
  Sci dist [icon: network, label: Distribution]
  Sci access [icon: network, label: "Access switches"]
  Sci lab [icon: monitor, label: "Lab devices"]
  Sci APs [icon: wifi, label: "Access points"]
  Sci cameras [icon: camera, label: "Cameras & doors"]
}

Firewall - ISP
Firewall - REN
Research - REN
Core - Firewall
Core - Research
DC switches - Core
WLC - DC switches
RADIUS - DC switches
DHCP - DC switches
DNS - DC switches
Res dist - Core
Res access - Res dist
Res APs - Res access
Res ports - Res access
Res cameras - Res access
Lib dist - Core
Lib access - Lib dist
Lib APs - Lib access
Lib PCs - Lib access
Lib staff - Lib access
Sci dist - Core
Sci access - Sci dist
Sci lab - Sci access
Sci APs - Sci access
Sci cameras - Sci access
```
</details>

<details><summary>data-center-fabric-spine-leaf</summary>

```
title Spine-leaf fabric
direction down

Spines [icon: network] {
  Spine 1 [icon: network]
  Spine 2 [icon: network]
  Spine 3 [icon: network]
  Spine 4 [icon: network]
}
Leaves [icon: network] {
  Row A pair {
    Leaf A1 [icon: network]
    Leaf A2 [icon: network]
  }
  Row B pair {
    Leaf B1 [icon: network]
    Leaf B2 [icon: network]
  }
  Border pair {
    Border 1 [icon: router]
    Border 2 [icon: router]
  }
}
Rows {
  Row A {
    A01
    A02
    A03
  }
  Row B {
    B01
    B02
    B03
  }
}
WAN edge [icon: globe] {
  Firewall 1 [icon: shield]
  Firewall 2 [icon: shield]
}

Spine 1, Spine 2, Spine 3, Spine 4 - Leaf A1, Leaf A2, Leaf B1, Leaf B2, Border 1, Border 2
Leaf A1 - Row A
Leaf A2 - Row A
Leaf B1 - Row B
Leaf B2 - Row B
Border 1 - Firewall 1
Border 2 - Firewall 2
```
</details>

<details><summary>network-weathermap-isp</summary>

```
title ISP weathermap
direction down

Where the traffic comes from [icon: globe] {
  Transit A [icon: cloud]
  Video caches [icon: server]
  Internet exchange [icon: network]
  Transit B [icon: cloud]
}
Core 1 [icon: router]
Core 2 [icon: router]
North ring {
  N1 [icon: network]
  N2 [icon: network]
  N3 [icon: network]
}
West ring {
  W1 [icon: network]
  W2 [icon: network]
  W3 [icon: network]
}

Transit A > Core 1: 2 × 100G
Video caches > Core 1: 1 × 100G
Internet exchange > Core 2: 2 × 100G
Transit B > Core 2: 1 × 100G
Core 1 - Core 2: 2 × 400G [color: green]
Core 1 - N1: 2 × 100G [color: green]
N1 - N2: 100G [color: orange]
Core 2 - N3: 2 × 100G
N3 - N2: 100G [color: red]
Core 1 - W1: 2 × 100G
W1 - W2: 100G
Core 2 - W3: 2 × 100G
W3 - W2: 100G
```
</details>

<details><summary>data-center-to-aws-migration</summary>

```
title Data center to AWS
direction right

Shoppers [icon: users]
CDN and WAF [icon: cloud]
Denver data center [icon: server] {
  Storefront [icon: server]
  Product search [icon: search]
  Content CMS [icon: file]
  Order management [icon: server]
  Loyalty [icon: server]
  Supplier portal [icon: users]
  Commerce DB [icon: database]
  Integration bus [icon: share]
  ERP [icon: database]
  Data warehouse [icon: database]
}
AWS us-west-2 [icon: aws] {
  Landing zone [icon: aws-control-tower]
  Direct Connect [icon: aws-direct-connect]
}
SaaS [icon: cloud] {
  HR and payroll [icon: users]
  Email marketing [icon: mail]
}

Shoppers > CDN and WAF
CDN and WAF > Storefront
Storefront > Product search
Storefront > Order management
Order management > Commerce DB
Order management > Integration bus
Integration bus > ERP
Integration bus > Data warehouse
```
</details>

## 7. 다시 재는 법

스크립트는 저장소 밖 `eraser-ref/_D/`에 있어요.

- `data.cjs <slug> <out>`: embed의 `#map-present-data` JSON을 저장해요.
- `cap.cjs <slug> <dir>`: 예시 페이지·embed·뷰별 캡처, 100% 확대 캡처, 다크 캡처를 찍고 `styles.json`을 저장해요(헤드리스, 2배율).
- `layout.py <data.json> <layout.json>`: 크기·간격·패딩·포트·꺾임 최빈값을 계산해요.
- `ours.mts` · `ours_layout.py` · `shot.cjs`: 우리 렌더 SVG/PNG, 같은 통계, `compare.png`를 만들어요.
