# 09-examples / C — 보안·네트워크 지도 7개

대상: `threat-model-payroll` `azure-security-remediation` `attack-path-map-biotech` `pci-scope-map-cinemas` `fedramp-authorization-boundary` `identity-blast-radius-saas` `wan-modernization-restaurants`

- 측정일 2026-11-13. 공개 페이지 `https://www.eraser.io/examples/<slug>` 와 그 안의 iframe `https://www.eraser.io/embeds/maps/<slug>/`.
- 캡처·측정 원본은 저장소 밖 `eraser-ref/<slug>/` 에만 있어요: `page.png` `embed.png`(80% 맞춤) `embed-100.png` `embed-view<N>.png` `embed-dark.png` `zoom-*.png` `layout.json` `styles.json` `dark.json`, 깊게 본 4개는 `ours.svg` `ours.png` `ours-scene.json`. 스크립트는 `eraser-ref/_C/`.
- Eraser 파일(JS·CSS·폰트·아이콘)은 가져오지 않았어요. 숫자와 캡처만 써요.

## 핵심 발견 (먼저 읽기)

1. **이 7개는 자동 배치가 아니에요.** iframe 안 `#map-present-data` JSON에 모든 요소의 `x, y, width, height`와 선의 꺾임점 `points`가 저장돼 있어요. 사람이(또는 에이전트가) 좌표를 직접 찍은 "지도"예요. 좌표는 20px 격자에 50~66%, 10px 격자에 60~73% 맞아요. 그래서 ELK 결과를 "똑같이" 만들 수는 없고, 따라 할 것은 **간격·크기 규칙**이에요(아래 표).
2. **노드는 "상자 + 왼쪽 아이콘 + 가운데 2줄 텍스트"가 기본**이에요. 우리 렌더러는 아이콘 위·이름 아래(상자 없음)로 그려서 첫인상이 가장 많이 달라요.
3. **모서리 반경 = min(w,h) × 0.15** (64→9.6, 60→9, 40→6). 그림자는 같은 도형을 (4,4) 밀어 `#E8E8E8`로 채운 것(블러 없음). 테두리 1.2px.
4. **연결선은 직교, 꺾임 반경 6px, 화살촉은 열린 V(12×11, 1.3px), 선 1.3px.** 라벨은 배경 없이 선을 끊고(mask) 선 위 가운데(along≈0.5)에 앉아요. 글자 12.18px.
5. **글자 크기는 저장값 × 0.87**로 그려요(14→12.18, 15→13.05, 12→10.44, 13→11.31, 11→9.57). 다크 모드는 없어요(`theme: "light"`, `prefers-color-scheme: dark`에도 흰 배경 그대로).

## 예시별 요약

| slug | 뷰(단계) | 요소 수(첫 뷰) | 성격 | 특이 |
|---|---|---|---|---|
| threat-model-payroll | Data flows → Threats → Mitigations, + Pay-run engine(하위) | Group 3, Shape 25, Rel 19 | DFD + STRIDE | 노드 위 `Expand` 버튼으로 하위 뷰 열기(`links.kind: fade`), cylinder 데이터 저장소 |
| azure-security-remediation | As built → First 30 days → Remediated | Group 1, Shape 16, Rel 15, Icon 3, Divider 1 | 전/후 상태 | 위협은 빨간 점선 노드, 단계마다 같은 자리에서 통제로 바뀜 |
| attack-path-map-biotech | All paths → Shortest path → After fixes | Group 4, Shape 22, Rel 12 | 공격 경로 | 4개 세로 존(열), 경로는 연빨강 `#FDA29B` 점선 |
| pci-scope-map-cinemas | In scope today → After segmentation → After tokenization | Group 5, Shape 29, Rel 4, Textbox 5 | 범위 지도 | 152×52 작은 카드를 3열 격자(간격 10/26)로 촘촘히 |
| fedramp-authorization-boundary | Boundary → Data flows → Interconnections → Controls → ConMon (5) | Group 5, Shape 42, Rel 5 | 경계도 | 뷰마다 선 수가 0~20으로 바뀜, `dotted` 선 |
| identity-blast-radius-saas | Access map → Laptop → CI token → Contractor | Group 10, Shape 38, Rel 39 | 권한 그래프 | **선이 직선 대각선**(꺾임 0이 152/156), 3열 고정 레이아웃 |
| wan-modernization-restaurants | Today → Pilot → Target | Group 7, Shape 21, Rel 8, Divider 3 | 현재/미래 | 지역 그룹 4개 2×2, 회색 주석 텍스트박스 |

## 배치 측정표 (`layout.json`, 모든 뷰 합산, 값×횟수 최빈값)

| slug | 노드 크기 | 같은 행 가로 간격 | 같은 열 세로 간격 | 그룹 안 패딩 L/T/R/B | 그룹 간 간격 | 선 꺾임 수 |
|---|---|---|---|---|---|---|
| threat-model-payroll | 180×64, 200×80(cyl), 200×64, 범례 100×34 | 30, 10(범례), 40 | 12, 8, 76 | 15–30 / 46–50 / 15–30 / 20–35 | 50 | 0×51, 2×27, 1×6 |
| azure-security-remediation | 200×64, 232×56 | 40, 16 | 76 | 40 / 80 / 40 / 24 | – | 0×33, 2×12 |
| attack-path-map-biotech | 190×60, 150×52(칩), 320×60 | 25, 20 | 60, 80, 70 | 20 / 58 / 20 / 8 | 30, 40 | 2×18, 0×6, 4×6 |
| pci-scope-map-cinemas | 152×52 (69개) | 10 | 26, 50 | 14 / 44–76 / 14 / 14 | 36, 40, 44 | 0×7, 3×4 |
| fedramp-authorization-boundary | 200×60 (90개), 180×52 | 40 | 76 | 10–30 / 38–56 / 10–30 / 16–28 | 40 | 0×21, 1×6 |
| identity-blast-radius-saas | 260×40, 240×40, 260×56 | 300(열 사이) | 8 | 20 / 40 / 20 / 12 | 12(세로), 260(가로) | 0×152 (직선) |
| wan-modernization-restaurants | 200×60, 180×40 | 20 | 16, 8 | 20 / 52 / 20 / 32 | 80, 120 | 0×14, 1×7, 3×4 |

규칙으로 정리하면:

- **노드 크기는 고정 폭.** 텍스트에 맞추지 않아요. 한 지도 안에서 1~3가지 크기만 써요(주 노드 180~260 × 52~64, 작은 칩·범례 100~152 × 32~52). 텍스트는 `data-text-max-lines=3`, `balanced` 줄바꿈.
- **간격 최빈값**: 가로 40(이웃 노드), 세로 76(층 사이), 같은 목록 안 세로 8~16. 촘촘한 목록형은 세로 8, 가로 10~12.
- **그룹 패딩**: 좌우 20, 위 40~56(제목 줄 포함), 아래 12~32. 제목 줄 높이 ≈ 23px(12.18px 글자 + 3px/5px 패딩) + 여백.
- **행·열 정렬**: 같은 층의 노드는 중심 y가 정확히 같고, 열은 중심 x가 같아요(예: payroll 행 y=322에 5개, fedramp 열 x=115에 7개).
- **포트 간격**: 한 변에 선 n개가 붙으면 변 길이를 n+1로 나눈 자리에 놓여요(40px 변에 3개 → 10,20,30 / 56px 변에 4개 → 11,22,34,45). 2개는 1/4·3/4(64px → 16,48)도 자주 써요.
- **라벨**: 라벨 상자 중심이 선 위(거리 0~1px), 선 길이의 0.5 지점(일부 0.4/0.58로 수동 이동). 라벨 높이 21, 폭은 글자+약 12.
- **범례**: 왼쪽 아래, 회색 `Legend` 텍스트(13→11.31px, `#98A2B3`) 밑에 100×34 또는 130×32 칩을 2열 격자(가로 10~12, 세로 8)로.
- **제목·설명**: 다이어그램 안이 아니라 지도 UI 왼쪽 위 바(`mp-bar`)에 있어요(16px 700 제목 + 14px 설명 1줄).

## 스타일 측정표 (`styles.json`, 100% 줌 getComputedStyle)

| 항목 | 값 |
|---|---|
| 글꼴 | `"Inter var", Inter, system-ui` (지도 UI는 system-ui) |
| 노드 제목 / 부제 | 13.05px 400 `#242424` / 10.44px 400 `#6B7280`, 줄높이 ×1.25, 가운데 정렬 |
| 노드 테두리 | 1.2px, 반경 min(w,h)×0.15, 실선 또는 점선 `8 8.75` |
| 노드 그림자 | 같은 path를 (+4,+4) 이동, 채움 `#E8E8E8`, 블러 없음 (`styleMode: shadow`). 범례 칩·위협 칩은 `plain`(그림자 없음) |
| 노드 색 (파랑) | 채움 `#F5F8FF` / 테두리 `#2866DF` (process), 데이터 저장소 `#EEF4FF` / `#444CE7` |
| 노드 색 (기타) | 외부 `#FFFFFF`/`#475467`, 위협 `#FEF3F2`/`#D92D20` 점선 + 글자 `#B42318`, 통제 `#ECFDF3`/`#079455` + 글자 `#085D3A`, 보라 `#F9F5FF`/`#7F56D9`, 기본(색 없음) 채움 투명 + 테두리 `#242424` |
| 아이콘 | Lucide 계열, 20×20, stroke 1.5, 노드 왼쪽에서 20px, 세로 가운데, 색 = 테두리 색 |
| cylinder | 위·아래 타원 높이 8.8(=h×0.11), 뚜껑 선 따로 |
| 연결선 | 1.3px, 기본 `#667085`(권한 그래프는 연한 `#C4CAD4`), 꺾임 반경 6 (`A6 6`), `stroke-linejoin: miter` |
| 화살촉 | 열린 V `M0,0 L12,5.5 L0,11`, userSpaceOnUse 12×11, 선 색 따라감. 양방향은 시작에도 같은 것 |
| 선 점선 | `8 8.75` (dashed), dotted는 `1.5 6.75` |
| 선 라벨 | 12.18px 400, 색 = 선 색, 배경 없음, 라벨 자리(라벨+2px)에서 선을 mask로 끊음 |
| 그룹 상자 | 반경 6, 테두리 1px(실선은 사실상 border 없음+배경만, 점선 `8 8.75`), 배경은 옅은 알파(예: `rgba(224,234,255,0.18)`) |
| 그룹 제목 | 12.18px 400(굵지 않음), 색 = 그룹 진한 색(`#1849A9`, `#B42318`, `#475467`, `#667085`), 왼쪽 위 또는 오른쪽 위(`title.hAlign`), 패딩 3/5, 아이콘 15×15 간격 5 |
| 캔버스 | 흰 배경, 점 격자 없음 |
| 다크 모드 | 없음(색 체계 dark로 열어도 같음) |

## 우리(develop `1f3bb6c`, `shared/render` + ELK)와의 차이

비교 그림: `eraser-ref/<slug>/ours.png` vs `embed-100.png` (threat-model, attack-path, identity, WAN 4개).

### 배치 차이 (먼저)

1. **방향과 층**: Eraser payroll은 "외부(왼쪽 열) → 처리(가운데 행) → 데이터 저장소(아래 한 줄)"로 3단 띠를 만들어요. ELK `direction right`는 저장소를 오른쪽 세로 목록으로 보내고, 외부 노드를 위·아래에 흩어요. 데이터 저장소처럼 "한 그룹 안 같은 종류"는 한 줄로 나란히 놓는 규칙이 필요해요.
2. **같은 층 정렬**: Eraser는 같은 층 노드 중심이 정확히 같은 y예요. ELK 결과는 층 안에서 노드마다 y가 조금씩 어긋나 선에 작은 계단(2~10px 꺾임)이 많이 생겨요(identity 그림의 Maya→Engineering 등).
3. **간격**: Eraser는 이웃 가로 40, 층 사이 세로 76, 목록 세로 8~16. 우리는 노드가 아이콘+라벨이라 세로 간격이 훨씬 넓고(목록 한 칸 ≈ 165px), 그룹이 길쭉해져요.
4. **그룹 배치**: identity는 Eraser가 "주체 열 | 그룹·역할 열 | 자원 열" 3열에 그룹을 세로로 쌓아요(그룹 간 12). ELK는 그룹을 2단으로 나누고 선이 긴 우회로를 만들어요(Maya → AWS admin 이 지도 아래로 돌아감).
5. **선 경로**: Eraser는 대부분 꺾임 0(곧은 선)이고, 꺾이면 2번(Z자). 권한 그래프는 아예 직선 대각선(`connectorStyle`)이에요. 우리는 직교 고정이라 선이 많은 그래프에서 꺾임이 3~4번까지 늘어요. 포트도 Eraser는 변을 n+1 등분, 우리는 선이 노드 가운데 근처에 몰려요.
6. **라벨 자리**: Eraser는 선 길이 0.5 지점, 우리도 가운데지만 긴 우회선에서 라벨이 다른 선 위에 겹쳐요(payroll "Finalized runs").

### 스타일 차이 (다음)

1. 노드: 우리 = 상자 없는 아이콘 위·라벨 아래. Eraser = 1.2px 테두리 상자 + 왼쪽 20px 아이콘 + 가운데 제목/부제 2줄 + (4,4) `#E8E8E8` 그림자. 부제(설명 줄) 개념이 우리 DSL에 없어요.
2. 그룹 제목: 우리 = 굵게, 큰 글자. Eraser = 12.18px 보통 굵기, 그룹 진한 색, 15px 아이콘. 오른쪽 위 정렬 옵션도 있어요.
3. 그룹 상자: 우리 = 진한 실선 테두리. Eraser = 옅은 배경(알파 0.14~0.5) + 1px 점선 또는 테두리 거의 없음.
4. 선 라벨: 우리 = 흰 알약 배경 + 테두리. Eraser = 배경 없음, 선을 끊고 글자색 = 선 색.
5. 화살촉: 우리 = 채운 삼각형. Eraser = 열린 V 12×11.
6. 아이콘: 우리 `key` 아이콘이 깨져 보여요(Stripe admin/AWS admin, Identity provider 그림). 따로 확인이 필요해요.

## 우리 DSL 코드 (비교에 쓴 것)

`eraser-ref/_C/dsl/*.eraser` 와 같아요. 대표로 payroll만 싣고 나머지 3개는 그 폴더에 있어요.

```
title Copperline Payroll data flows
direction right

Employee [icon: user]
Employer admin [icon: user]
HRIS provider [icon: link]
Support agent [icon: user]

Copperline production [icon: cloud, color: blue] {
  Identity provider [icon: key, color: blue]
  Web app [icon: monitor, color: blue]
  Payroll API [icon: server, color: blue]
  Pay-run engine [icon: settings, color: blue]
  Support console [icon: search, color: blue]
  Webhook receiver [icon: webhook, color: blue]
  Bank-file service [icon: lock, color: blue]
  Tax e-file service [icon: file-text, color: blue]
  Restricted data [icon: lock, color: red] {
    Audit log [icon: database]
    Employee records [icon: database]
    Pay stubs [icon: database]
    Pay-run ledger [icon: database]
    Secrets vault [icon: database]
  }
}
Partner networks [icon: building] {
  Partner bank [icon: building]
  Tax agencies [icon: building]
}

Employee > Web app
Employer admin > Web app
HRIS provider > Payroll API: Hires, hours
Support agent > Support console
Web app <> Identity provider: Sign-in
Web app > Payroll API
Payroll API > Pay-run engine: Pay runs
Payroll API > Employee records: Employee data
Pay-run engine > Bank-file service: Net pay
Pay-run engine > Tax e-file service: Withholding
Pay-run engine > Pay stubs: Stubs
Pay-run engine > Pay-run ledger: Finalized runs
Webhook receiver > Pay-run engine: Payment status
Partner bank > Webhook receiver: Returns, status
Bank-file service > Partner bank
Tax e-file service > Tax agencies
Secrets vault > Tax e-file service: Credentials
Support console > Audit log
Support console > Employee records: Lookups
```

## 기능 관찰 (짧게, 진행판과 겹치는 것 위주)

- **단계(뷰) 전환**: 제목 옆 `‹ ›` 버튼과 `▾` 메뉴("4 views", 이름 검색). 같은 좌표계에서 노드를 바꿔 끼워 "전 → 후"를 보여줘요. 진행판의 "단계별 상태"와 바로 겹쳐요: 같은 배치를 두고 단계마다 노드 색·존재만 바꾸는 모델.
- **흐름 재생(Flows to play)**: 흐름 = 단계 목록, 단계마다 `animation.effects` 배열 `{ref, start, stop(ms), type, easing}`. type은 `travel-line`(선을 따라 점이 이동), `pulse`(노드 깜빡), `shake`(공격 실패 표현). 하단 바에 이전/재생/다음/포커스 버튼, 단계 번호 콜아웃(`mf-callout`). 진행판의 "실행 중 경로 표시"에 그대로 쓸 수 있는 모델이에요.
- **필터**: 왼쪽 아래 드롭다운 2~3개(STRIDE·Risk, Severity·Control family 등). 값을 고르면 나머지가 흐려져요(facets: 레코드별 필드값).
- **하위 다이어그램**: 노드 위 작은 `Expand` 버튼 → 다른 뷰로 fade 전환(payroll의 Pay-run engine).
- **줌**: 오른쪽 위 `80% ▾`, 메뉴에 −/입력/+, "Zoom to fit ⇧1", "Zoom to 100% Ctrl 0". 노드 클릭 시 레코드 카드(설명·필드) 표시.

## 남은 일

- 나머지 3개(azure, pci, fedramp)는 측정만 했어요. `ours.png` 비교는 없어요.
- 우리 `key` 아이콘 깨짐 확인.
