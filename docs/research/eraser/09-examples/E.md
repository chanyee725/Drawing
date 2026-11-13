# 09 예시 조사 — 그룹 E

대상 slug 7개: `design-drift-travel-booking`, `cloud-network-topology-aws`, `auto-insurance-claim-process`, `procure-to-pay-process-flow`, `hospital-it-service-map`, `outage-replay-ticketing`, `disaster-recovery-airline`, 그리고 목록 페이지 `diagrams`.

- 캡처와 원자료는 저장소 밖 `/home/bgk/personal/eraser-ref/<slug>/`에 있어요: `page.png`, `embed-v<N>.png`(view마다), `embed-dark.png`, `zoom-shape.png`, `zoom-group.png`, `zoom-label.png`(있을 때), `data.json`, `layout.json`, `styles.json`, `computed.json`, `ours.png`(4개 slug). 스크립트는 `/home/bgk/personal/eraser-ref/_E/`(`analyze.py`, `shoot.cjs`, `ours.ts`, `svg2png.cjs`)에 있어요.
- 우리 쪽 렌더는 develop `1f3bb6c` 기준 `shared/render`(ELK)로 만들었어요.
- **측정 원천:** 임베드 HTML의 `<script id="map-present-data">` JSON(`views[].elements[]`)에 요소마다 저장된 `x/y/width/height`, 연결선 `points`, 스타일 props가 들어 있어요. 배치 수치는 이 좌표에서, 계산 스타일은 `getComputedStyle`로 쟀어요. 화면 bbox와 저장된 좌표는 일치해요(줌 100% 기준 오프셋만 다름).
- **다크 모드:** 없어요. `prefers-color-scheme: dark`와 `?theme=dark` 둘 다 흰 배경이었고, 데이터의 `theme`는 7개 모두 `light`예요.
- **제약:** headless 셸에는 Inter가 없어서 캡처의 글꼴은 대체 글꼴이에요. 계산값은 `"Inter var", Inter, system-ui, …`예요.

## 1. 예시별 요약

| slug | 유형 | view 수 | 요소/view | 배치 성격 |
|---|---|---|---|---|
| design-drift-travel-booking | Azure 아키텍처 비교(설계·Terraform·실제·드리프트·조정) | 5 | 48–60 | 열 기반. 같은 틀에 단계별로 노드를 더하거나 빼요 |
| cloud-network-topology-aws | AWS 네트워크 토폴로지, drill-down | 4 | 74–94 | 중첩 존(region › VPC › subnet tier › SG), 가로로 긴 TGW 바 |
| auto-insurance-claim-process | swimlane 프로세스 | 3 | 33–38 | 단계 열 × 역할 레인 격자 |
| procure-to-pay-process-flow | 플로차트 + 하위 프로세스 | 6 | 30–53 | 위: 미니 전체 흐름 바. 아래: 왼→오 플로차트. 맨 아래: divider + 칩 |
| hospital-it-service-map | 계층형 서비스 맵(CMDB) | 4 | 65 | 3단 가로 밴드(비즈니스·앱·인프라), 직선 연결선 |
| outage-replay-ticketing | 장애 타임라인 replay | 5 | 46–47 | 같은 배치에 단계별 색·배지만 바꿔요 |
| disaster-recovery-airline | DR(2개 region) | 5 | 57–86 | 좌우 두 region 열, 행 단위로 맞춘 복제 쌍 |
| diagrams(목록) | 예시 카드 53개 | — | — | 필터(Use Case·Features·Technologies) + 썸네일 카드 격자 |

공통 구조: 상단 왼쪽에 breadcrumb·제목·설명·flow 버튼, 오른쪽 위에 줌 드롭다운, 왼쪽 아래에 필터 칩, 도면 오른쪽 위에 회색 메모 Textbox(hAlign right)가 있어요. 도면은 손으로 배치한 절대 좌표예요(자동 레이아웃의 흔적이 없음).

## 2. 배치 측정표 (view 전체 합산, 최빈값)

| slug | 노드 크기 상위 | 가로 간격 | 세로 간격 | 그룹 패딩 L,T,R,B | 연결선 |
|---|---|---|---|---|---|
| design-drift | 188×56 (96), 188×52, 170×64, 128×32 | 40, 8 | **50**, 8, 14 | 10,44,10,16 / 16,38,16,16 | 52개 전부 직선(꺾임 0), L↔R |
| cloud-aws | 170×52, 106×60, 160×56, 170×32 | 30, 11, 15 | 8, 38, 116 | 15,62,15,106 / 20,46,15,18 / 20,50,20,30 | 103개 직교, 꺾임 0이 88. 주로 T↔B. 같은 변 포트 간격 117·230 |
| auto-insurance | 216×64(단계), 200×50(활동) | **28**(단계 사이), 44 | 8(레인 사이) | 16,44,16,18 / 레인 T=36,B=16 | 직교. 꺾임 0이 21, 1이 11 |
| p2p | 152×38, 148×56, 124×48, 104×32 | 30, 58, 64 | 44, 62 | 다양(하위 프로세스 틀 T=34–98) | 99개 직교. 꺾임 0이 85, 1이 12 |
| hospital | **160×64**(앱·인프라), 220×80(비즈니스) | **24**, 30 | **100**(밴드 사이 노드 간) | 40,56,52,30 | 152개 **직선(사선)**(`connectorStyle: straight`), T↔B, 같은 변 포트 간격 54–55 |
| outage | 200×64, 156×56, 120×36 | 50, 10, 12 | 76, 66 | 20,38,20,14 / 40,40,40,26 | 77개 직교. 꺾임 0이 60 |
| disaster-recovery | **308×50**(115), 196×50, 97×56 | 10, 396(region 사이) | **8**(행), 22 | 16,80,16,16 / 14,42,16,14 | 46개 직교, 거의 직선 L↔R |

배치 규칙(7개 공통):

1. **고정 폭 격자:** 노드는 텍스트에 맞추지 않아요. 한 열이나 한 밴드 안에서는 같은 폭·높이를 써요(hospital은 18개 중 16개가 160×64). 텍스트는 `data-text-grow-policy="balanced"`, 최대 3줄로 줄바꿈해요.
2. **좌표는 2의 배수**예요. 4의 배수인 비율은 0.15–0.7이라 격자 스냅은 아니에요.
3. **간격은 두 가지만 써요:** 밀착 목록은 8–12(같은 열에 쌓기), 흐름 간격은 24–50(단계 사이). 계층 밴드 사이는 100 안팎이에요.
4. **그룹 패딩:** 좌우 10–20, 위 36–46(제목 줄 몫), 아래 12–18이에요. 제목은 왼쪽 위에 아이콘과 함께 두고 `width: snug`, 테두리는 없어요.
5. **연결선:** 대부분 **꺾임 0**이에요. 노드를 같은 행이나 열에 정렬해서 직선이 나오게 해요. 포트는 변 중앙(offset 0이 대다수)이고, 한 변에서 여러 선이 나가면 균등하게 벌려요(hospital 54px, aws 117px). 꺾을 때는 1번, 많아야 2번이에요.
6. **라벨:** 선 위 중앙(frac 0.5)이 기본이고 0.3/0.7도 써요. 높이 21. 배경 없이 라벨 자리에서 선을 끊어요(c4 측정과 같음).
7. 화면 위치: 범례는 aws에서 왼쪽 아래 열, 메모 Textbox는 오른쪽 위예요.

## 3. 스타일 측정표

| 항목 | 값 (7개 합산 최빈) |
|---|---|
| 글꼴 | `'Inter var', Inter, system-ui…`, stage 14px / lh 1.4. 실제 텍스트 크기는 저자 값 × 0.87 (13→11.31, 14→12.18, 15→13.05, 12→10.44, 11→9.57) |
| 노드 | 모서리 반경 `cornerRadius 12, cornerRadiusPercent 15`. 200×50 박스의 실제 path는 r=7.5(= 짧은 변의 15%) |
| 노드 테두리 | 계산값 1.2px. 강조할 때만 `borderWidth 2`. 점선 노드 108개(외부·계획 항목) |
| 노드 채움/테두리 | 흰색 `#FFFFFF`/`#D0D5DD`(최다), 파랑 `#EFF8FF`/`#2E90FA`, 회색 `#F2F4F7`/`#98A2B3`, 빨강 `#FEF3F2`/`#D92D20`, 보라 `#F4F3FF`/`#6938EF`, 초록 `#ECFDF3` |
| 그림자 | `styleMode shadow`일 때 `#E8E8E8` 채움 도형을 오프셋해서 깔아요(blur 없음). plain 592개 : shadow 317개 |
| 노드 텍스트 | 본문 `#242424`, 보조 줄(subtitle) `#98A2B3`/`#475467`, 크기 10.44–13.05 |
| 아이콘 | lucide 선 아이콘, stroke-width 1.5, 노드 왼쪽 안쪽, `data-icon-size sm`. 색은 `#242424`, 흐리게는 `#C4C9D2`/`#98A2B3`, 강조는 `#1570EF` |
| 연결선 | 1.3px. 색 `#667085`(최다), `#98A2B3`, `#1c1c1c`, 흐림 `#EEF0F3`, 오류 `#F04438`. `cornerStyle: elbow`(둥글지 않은 직각). 점선은 12개뿐 |
| 화살촉 | `arrow` = 열린 V. path `M0,0 L12,5.5 L0,11`, userSpace 12×11, 선 굵기를 따라가요. 시작 화살촉은 거의 없어요(16/562). 그 밖의 marker: triangle, bar, dot, crowFoot |
| 라벨 | 12.18px, 배경 없음, 선이 끊김 |
| 그룹 | 채움은 반투명(`rgba(249,250,251,.6)`, `rgba(242,244,247,.45)`, 보라 `rgba(140,79,255,.05)`). 테두리 `#EAECF0`(최다)·`#D0D5DD`, 색 존은 `#8C4FFF`/`#00A4A6`/`#2E90FA`. 반경 6px, 점선 49개(`8 8.75`, dotted `1.5 6.75`) |
| 그룹 제목 | 12.18px, 굵기 400, 색 `#475467`(또는 존 색: `#6B2FD9`, `#00777A`). 아이콘 + 텍스트, 오른쪽 정렬 23개 |
| 배지 | 오른쪽 위 사각 칩(`AI`: `#6938EF` 바탕에 흰 글씨 8.7px). 아래쪽 `+` 배지는 하위 다이어그램이 있다는 표시 |
| Divider | `#EAECF0` 1.3px 가로선. 아래에 칩 행(p2p의 Runs on / Controls / Documents) |

## 4. 우리와의 차이 (develop 1f3bb6c, ELK)

비교 대상은 4개예요: p2p(`requisition`), auto-insurance(`lifecycle`), cloud-aws(`use1`을 단순화), hospital(`services`). 그림은 `ours.png`와 `embed-v*.png`를 나란히 보면 돼요.

### 배치 (먼저)

1. **swimlane 격자가 무너져요(auto-insurance):** 선이 없는 그룹을 ELK가 세로로 쌓고, 그룹 안 노드도 세로로 쌓아요. 작성 순서도 지켜지지 않아요("Uploads photos"가 첫 줄로 감). Eraser는 단계 열(피치 305) × 역할 레인이에요. → 레인과 단계 열 정렬(행·열 제약)이 필요해요.
2. **노드 폭이 텍스트에 맞춰져요.** 우리는 118–182로 제각각이고, Eraser는 열마다 고정 폭이에요(160×64, 200×50). → 같은 rank나 그룹 안에서 폭을 통일해야 해요.
3. **연결선 꺾임이 많아요.** 우리 p2p는 14개 중 7개가 꺾이고(최대 4번), Eraser는 99개 중 85개가 직선이에요. ELK가 노드를 rank 중앙에 두지 않아 생기는 1–2px 어긋남 꺾임도 보여요. → 꺾임을 줄이도록 노드를 같은 행에 정렬해야 해요(직선 우선).
4. **hospital:** 우리는 계층 그룹 폭이 제각각이고, 선이 그룹 제목을 덮고 다른 그룹을 관통해요(PACS → storage). Eraser는 같은 폭의 가로 밴드 3개, 밴드 사이 노드 간격 100, 직선 사선 연결선이에요. → 밴드 폭 통일, 제목 영역 회피, `connectorStyle straight` 옵션이 필요해요.
5. **간격:** 우리 rank 간격은 64, 그룹 패딩은 20,40,20,20이에요. Eraser는 단계 사이 28–50, 목록 간격 8, 패딩 16,44,16,18이에요. 패딩은 거의 같고, 노드 간격은 Eraser 쪽이 더 촘촘해요.

### 스타일 (다음)

1. **cloud 노드:** 우리는 아이콘만 크게 그리고 아래에 텍스트를 둬요. Eraser는 카드형 박스 안 왼쪽에 아이콘, 오른쪽에 제목과 보조 줄을 둬요. 우리 `aws-*` 아이콘 일부는 지구본이나 점선 placeholder로 대체됐어요(calculator, banknote, flask 포함).
2. **연결선:** 우리는 둥근 꺾임 + 채운 삼각 화살촉 + 회색 `#7b8394` 계열이에요. Eraser는 직각(elbow) + 열린 V(12×11) + 1.3px `#667085`/`#98A2B3`예요.
3. **라벨:** 우리는 작은 회색 + 배경 판, Eraser는 배경 없이 선을 끊어요.
4. **노드 테두리:** 우리는 회색이고 그림자가 흐려요. Eraser 기본은 `#D0D5DD` 1.2px(흰 노드)이고, shadow 모드는 `#E8E8E8` 오프셋 도형이에요.
5. **제목:** 우리는 굵은 18px 제목을 도면 안에 넣어요. Eraser는 도면 밖 UI 바에 두고, 그룹 제목은 12.18px 400 회색이에요(우리 그룹 제목은 굵게).

## 5. 기능 관찰 (짧게)

- **view 전환 = 레이어 + drill-down:** 제목 드롭다운에 "N views"가 있고, breadcrumb `‹ ›`로 이전·다음 view로 가요. 노드에 붙은 `+`/레이어 배지나 `Expand` 버튼을 누르면 하위 view가 열려요(`links[]: from, viewId, kind: fade`).
- **flow 재생(진행판과 겹치는 부분):** `flows[].steps[]`마다 `label`, `description`, `animation.effects[]`가 있어요. effect 종류는 `pulse`(노드 ref 배열, start/stop ms)와 `travel-line`(관계선 ref, ease-in-out, 800ms)이에요. 단계 n은 직전 선을 따라 이동(0–800ms)한 뒤 다음 노드를 pulse(700–1400ms)해요. 하단 바(`mf-bar`)에 이름, n/총수, 점, 이전/재생/다음/포커스 버튼이 있고, 도면 위 `mf-callout`에 번호·라벨·설명이 떠요. outage와 disaster-recovery는 같은 배치를 view(시각)마다 색과 배지만 바꿔 "상태 진행"을 보여 줘요. **진행판에 그대로 쓸 수 있는 모델이에요:** 같은 노드 id + 단계별 스타일 덮어쓰기 + 경로 애니메이션.
- **필터:** 왼쪽 아래 칩(Team, Automation, Path, Tier …)이에요. 값을 고르면 나머지가 흐려져요. `filters.facets[recordId][fieldId]`로 노드와 레코드를 연결해요.
- **레코드 패널:** 노드마다 `modelRef.globalId`가 있고, 레코드(name, type, icon, fields[])가 클릭하면 열리는 패널 내용이에요.
- **줌:** 오른쪽 위 `100%▾` 메뉴에 ±, 입력, Zoom to fit(⇧1), Zoom to 100%(Ctrl 0)가 있어요.

## 6. 우리 DSL 코드 (비교에 쓴 것)

```text
title Raise a requisition
direction right

Need identified [shape: oval, color: green]
Fill in the request
In the catalog? [shape: diamond, color: purple]
Buyer classifies it
Check the budget [color: purple]
Over 5000? [shape: diamond, color: purple]
Manager approves
Over 50000? [shape: diamond, color: purple]
Director approves
Approved [shape: oval]
Declined [shape: oval, color: red]

Need identified > Fill in the request > In the catalog?
In the catalog? > Check the budget: Yes
In the catalog? > Buyer classifies it: No
Buyer classifies it > Check the budget
Check the budget > Over 5000?
Over 5000? > Approved: No
Over 5000? > Manager approves: Yes
Manager approves > Over 50000?
Manager approves > Declined: Rejects
Over 50000? > Approved: No
Over 50000? > Director approves: Yes
Director approves > Approved
Director approves > Declined: Rejects
```

나머지 세 개(`claim.txt`, `aws.txt`, `hospital.txt`)는 `/home/bgk/personal/eraser-ref/_E/`에 있어요. 구조는 다음과 같아요.
- claim: `Stages{5}` + 역할 그룹 4개 안에 활동 노드
- aws: `us-east-1 { Edge{CloudFront}, Inspection VPC{Firewall, NAT}, TGW, VPC 4개 }`
- hospital: `direction down`, 그룹 3개(Business services / Applications / Infrastructure)와 14개 선

## 7. 남은 것

- 7개 slug 모두 캡처·측정을 마쳤어요.
- design-drift, outage, disaster-recovery는 우리 렌더 비교(`ours.png`)를 하지 않았어요.
