# P0-3 설계: 블록 안 노드 드래그 편집 + Reset Layout

상태: 설계안 (코드 변경 없음). 기준 커밋: `develop` 1d4e31b.
근거: `docs/research/eraser/01` §2·§3.2, `02` §4, `05` §5·§14 (P0 "diagram 클릭 → 요소 클릭 2단계 선택, 드래그 이동/리사이즈, Reset Layout").

## 0. 한눈에

- 위치 오버라이드는 **블록마다 `layout` 필드**로 `.dpx.json`에 저장해요. 코드(`code`)는 그대로 두고, 레이아웃만 별도 레이어예요.
- `FORMAT_VERSION`을 **2 → 3**으로 올려요. 마이그레이션은 필요 없어요(`layout`이 없으면 자동 배치). 올리는 이유는 옛 서버가 `layout`을 조용히 지우지 않게 하려는 거예요(옛 서버는 v3 파일을 읽기 전용으로 봐요).
- 렌더는 **ELK 한 번(캐시) + 오버라이드 합성(동기, 빠름)** 두 단계로 나눠요. 옮긴 노드는 저장된 위치, 나머지는 ELK 위치. 그룹 상자는 자식 기준으로 다시 맞추고, 끝점이 움직인 엣지만 간단한 직교 라우터로 다시 그어요.
- 키는 **노드 이름(= AST `id`)** 이에요. 이름이 바뀌거나 지워지면 그 노드 오버라이드는 버려요. 구조가 크게 바뀌면(방향·종류 변경, 절반 이상 소실) 전체 리셋해요.
- 캔버스는 블록 선택 상태에서 노드를 한 번 더 누르면 **레이아웃 편집 모드**에 들어가요. 오버레이가 이미지 위에 떠서 선택·드래그·스냅을 하고, 아래 배너에 `레이아웃 초기화`와 `완료`가 있어요.
- 범위: **architecture·flowchart(그래프)만**. 시퀀스·ERD는 이번에 안 해요.

## 1. 지금 구조 (설계에 영향을 주는 사실)

| 위치 | 사실 | 영향 |
|---|---|---|
| `shared/dsl/graph.ts` | 노드·그룹 `id` = 이름(`ep.name`). 중복 이름은 에러, 첫 정의가 이겨요. 엣지 `id`는 `e1, e2…` 순번 | 노드·그룹 id는 안정적인 키로 써요. 엣지 id는 위치가 바뀌면 달라지므로 엣지에는 오버라이드를 걸지 않아요 |
| `shared/render/layout-graph.ts` | ELK(layered, ORTHOGONAL) 한 번 → `rects`(절대 좌표) → 상자·텍스트·엣지 아이템 생성. 직선/arc 엣지는 이미 `rects`로 다시 계산 | 오버라이드는 `rects`를 바꾸고 나머지 그리기를 재사용하면 돼요 |
| `shared/render/common.ts` `finishScene` | 범례·제목을 붙이고 전체를 `PAD - b.x0`만큼 평행이동 | 저장 좌표는 평행이동 **전** 좌표계(ELK 루트, 이하 "레이아웃 좌표")여야 해요. Scene이 이 이동량(`origin`)을 알려줘야 해요 |
| `shared/render/scene.ts` | icon-only 노드는 `id` 달린 `box`가 없어요 | 히트 테스트용 사각형 목록(`handles`)을 Scene에 따로 넣어요 |
| `web/src/canvas/render.ts` / `sync.ts` | 블록 = Excalidraw image 한 장, `fileIdFor`가 `type+code+theme` 해시. 캐시 키도 code 기준 | 캐시 키·fileId에 `layout` 해시를 넣어야 해요 |
| `web/src/canvas/ExcalidrawCanvas.tsx` | 블록 위치·삭제·복제·undo를 image 요소 변화에서 역산(`splitScene`/`applyScene`/graveyard). 더블클릭·Enter = 코드 패널 | 레이아웃도 image 요소의 `customData`로 흘려 Excalidraw undo를 그대로 써요 (§5.6) |
| `server/workspace/model.js` `normalizeBlock` | 블록 필드를 `id,type,code,x,y,w,h`만 남기고 **나머지는 버려요** | 서버가 `layout`을 알아야 저장돼요. 버전 올림이 필요한 이유 |
| `server/workspace/store.js` | `version > FORMAT_VERSION`이면 읽기 전용, 쓰기는 422 | v3 파일을 옛 서버가 덮어쓰지 않아요 |
| `web/src/App.tsx:151` | 422 판단에 `DOC_FORMAT_VERSION`(=2)을 씀 | 파일 형식 버전과 문서 마이그레이션 버전을 나눠야 해요 |
| 웹 | SSE(`/api/events`)를 아직 구독하지 않아요 | 동기화 쪽 새 작업은 없어요 (§6) |

## 2. 파일 형식

### 2.1 블록에 `layout` 추가

```jsonc
{
  "id": "b_k3j9x0aa",
  "type": "architecture",
  "code": "VPC { API [icon: server] }\nDB [icon: database]\nAPI > DB",
  "x": 120, "y": 80, "w": 640, "h": 410,
  "layout": {
    "v": 1,
    "basis": { "type": "architecture", "direction": "right", "count": 3 },
    "items": {
      "API": { "cx": 212.5, "cy": 96, "parent": "VPC" },
      "DB":  { "cx": 540,   "cy": 180, "parent": "" }
    }
  }
}
```

- `layout`은 선택 필드예요. 없거나 `items`가 비면 자동 배치와 똑같이 그려요.
- `items` 키 = 노드 이름(또는 **빈 그룹** 이름, §3.3). 값:
  - `cx`, `cy`: 레이아웃 좌표계의 **중심점**. 라벨을 바꿔 크기가 변해도 중심이 고정돼 눈에 덜 튀어요.
  - `parent`: 오버라이드를 만들 때의 부모 그룹 이름, 루트는 `""`. 코드에서 그룹을 옮기면 이 노드만 버리는 데 써요(§4).
  - 크기(`w`,`h`)는 이번 범위 밖이에요. 리사이즈를 나중에 넣을 때 같은 객체에 선택 필드로 추가해요(`v`는 그대로).
- `basis`: 마지막으로 저장했을 때의 구조 요약. "크게 바뀌었는지" 판단에 써요(§4.2).
  - `count` = 그때의 노드+그룹 수.
- `v`: 이 하위 형식 버전. 모르는 `v`를 만난 웹은 오버라이드를 무시하고 자동 배치로 그리되, **저장할 때 지우지 않아요**(읽기 전용 취급).

### 2.2 서버 검증 (`normalizeBlock`)

- `layout`이 있으면 객체여야 하고, 다음을 확인해요. 어기면 400.
  - `v`: 1 이상 정수.
  - `items`: 객체, 키 1~200자, 항목 최대 2000개, `cx`·`cy`는 유한수, `parent`는 문자열.
  - `basis`: 객체(`type` 문자열, `direction` 문자열, `count` 0 이상 정수).
- 알려진 필드만 복사해요(지금처럼 모르는 필드는 버림). 단 `v`가 서버가 아는 값보다 크면 `layout`을 **통째로 그대로** 보존해요(내용 검증 없이 JSON 객체인지만).
- 서버는 DSL을 파싱하지 않아요. 오버라이드 정리(prune)는 웹이 해요.

### 2.3 `FORMAT_VERSION` 2 → 3

- `server/workspace/model.js`: `FORMAT_VERSION = 3`, 주석에 "3: blocks may carry `layout`" 추가.
- 마이그레이션: **없음**. v1·v2 파일은 그대로 읽고, 다음 저장에 v3로 기록돼요. `layout`이 없으면 기존과 같은 그림이에요.
- 왜 올리나: v2 서버는 `normalizeBlock`에서 `layout`을 잘라요. 버전을 올리면 v2 서버는 v3 파일을 읽기 전용으로 보고 422를 내서, 사용자가 옮긴 배치가 사라지지 않아요(기존 장치 재사용).
- 웹:
  - `web/src/api.ts` `Block`에 `layout?: BlockLayout` 추가.
  - 새 상수 `FILE_FORMAT_VERSION = 3`(예: `web/src/api.ts`)을 두고 `App.tsx:151`의 422 판단을 이걸로 바꿔요. `DOC_FORMAT_VERSION = 2`는 문서 마이그레이션 전용으로 남겨요(`migrateDocument`는 `>= 2`라 v3에서도 그대로 동작).
  - `test/workspace.test.js:499`의 `FORMAT_VERSION === 2` 단언을 3으로 바꿔요.

## 3. 렌더: ELK 결과와 합치기

### 3.1 두 단계로 나누기 (`shared/render/layout-graph.ts`)

```ts
// shared/render/layout-graph.ts
export interface GraphBase { /* ELK 결과: 노드·그룹 rect(레이아웃 좌표), 엣지 section, 측정값 */ }
export async function graphBase(d: GraphDiagram): Promise<GraphBase>;          // ELK, 느림, 캐시 대상
export function composeGraph(d: GraphDiagram, base: GraphBase, layout?: BlockLayout): Scene; // 동기, 빠름

// layoutGraph(d) = composeGraph(d, await graphBase(d)) — 기존 호출부는 그대로
```

- `layoutDiagram(diagram, { layout })`, `renderDiagram(code, { type, theme, layout })`에 선택 인자로 받아요. 시퀀스·ERD는 `layout`을 무시해요.
- `BlockLayout` 타입과 순수 함수(`reconcileLayout`, `structureOf`)는 `shared/render/overrides.ts`에 둬요(웹·테스트가 같이 씀).
- 결정성: 같은 `code + layout` → 같은 SVG. 오버라이드 좌표는 저장 시 0.5 단위로 반올림해요.
- 드래그 중 미리보기는 `composeGraph`만 다시 불러요(ELK 재실행 없음). 목표: 노드 100개에서 compose+SVG < 16 ms.

### 3.2 합성 순서 (`composeGraph`)

1. ELK `rects`를 복사해요.
2. **노드**: `items`에 있고 현재 AST에서 유효한(§4) 노드는 rect 중심을 `(cx, cy)`로 옮겨요. 크기는 현재 측정값 그대로.
3. **그룹**: 자손 중 하나라도 옮겨졌으면 안쪽 그룹부터 바깥으로 rect를 다시 맞춰요.
   - rect = 자식 rect들의 bbox + 패딩(`top=header, left/right/bottom=20`, ELK 설정과 동일), 최소 `minW × (header+40)`.
   - 옮겨진 자손이 없는 그룹은 ELK rect 그대로.
   - 그룹 소속은 코드가 정해요. 노드를 그룹 밖으로 끌어도 소속은 안 바뀌고 그룹 상자가 늘어나요.
4. **엣지** (끝점 = 노드 또는 그룹):
   - 두 끝점과 엣지 컨테이너가 모두 안 움직였으면: ELK 경로 그대로.
   - 두 끝점이 같은 만큼 움직였으면(그룹째 드래그): ELK 경로를 그만큼 평행이동.
   - 그 밖: `straight`/`arc`는 지금 코드처럼 rect 중심끼리 잇고 `clipToShape`. `elbow`는 새 직교 라우터(§3.4).
   - 라벨은 지금처럼 `labelAnchor(points, route)`.
5. 아이템을 만들고 `finishScene`. `finishScene`이 쓴 평행이동량을 `scene.origin`으로 돌려줘요.

### 3.3 Scene 확장 (`shared/render/scene.ts`)

```ts
export interface SceneHandle { id: string; kind: 'node' | 'group'; parent: string; x: number; y: number; w: number; h: number; moved: boolean }
export interface Scene {
  // 기존 필드 …
  /** Translation finishScene applied: scene = layout + origin. */
  origin?: Point;
  /** Hit boxes for draggable elements (graph types only), in scene coordinates, paint order. */
  handles?: SceneHandle[];
}
```

- `handles`는 icon-only 노드도 포함해요(지금은 `box`가 없음).
- 빈 그룹(자식 0개)은 노드처럼 드래그되고 `items`에 키가 생겨요. 자식 있는 그룹을 끌면 **자손 노드 전부**의 오버라이드를 쓰고, 그룹 자체는 키를 안 가져요(늘 자식에서 계산).
- SVG에는 영향 없음(`sceneToSvg`는 `handles`·`origin`을 안 그려요). 기존 스냅샷이 그대로여야 해요.

### 3.4 직교 라우터 (끝점이 움직인 elbow 엣지만)

- 두 rect 중심의 차이 `dx, dy`로 축을 골라요. `|dx| ≥ |dy|`면 동/서 변 중앙에서 나가 `H-V-H`(가운데 x에서 꺾음), 아니면 남/북 변 중앙에서 `V-H-V`.
- 같은 쌍의 평행 엣지는 순번마다 12px씩 꺾는 지점을 비켜요.
- 자기 루프는 ELK 경로를 노드 이동량만큼 평행이동.
- 조상↔자손 엣지(그룹 → 그 안의 노드): 그룹 상자 위쪽 header 아래에서 노드 쪽으로 `V-H-V`.
- 장애물 회피는 **안 해요**(Eraser 수준을 넘는 범위, P2 waypoint와 같이 검토). 끝은 지금처럼 `snapToShape`.

## 4. 코드 편집 시 오버라이드 유지·폐기

### 4.1 노드 단위 규칙 (`reconcileLayout(ast, layout)`, 순수 함수)

| 코드 변화 | 결과 |
|---|---|
| 라벨·색·아이콘·모양 변경 | 유지. 중심 고정, 크기만 바뀜 |
| 엣지 추가·삭제·라벨 변경 | 유지. 엣지만 다시 그음 |
| 노드 추가 | 다른 오버라이드 유지. 새 노드는 ELK 위치(겹칠 수 있음, §8) |
| 노드 삭제 | 그 키 폐기 |
| 노드 이름 변경 | 옛 키 폐기(이름 = id라 추적 안 함). 새 이름은 ELK 위치 |
| 노드를 다른 그룹으로 옮김(`parent` 다름) | 그 키 폐기 |
| 중복 이름 | 파서가 에러로 처리하고 첫 정의만 남아요. 에러가 있는 동안은 아래 4.3 규칙(정리 보류, 편집 모드 막음) |
| implicit 노드(연결에서만 언급) | 이름이 id라 일반 노드와 같음 |

### 4.2 전체 리셋 ("크게 고침", Eraser의 auto reset)

다음 중 하나면 `layout`을 통째로 지워요.

1. 블록 `type`이 바뀜, 또는 `direction`이 `basis.direction`과 다름.
2. 4.1로 폐기되는 키가 **기존 키의 절반 이상**(키가 2개 이상일 때).
3. 현재 노드+그룹 수가 `basis.count`의 **±50%를 넘게** 바뀜.

상수(`RESET_DROP_RATIO = 0.5`, `RESET_COUNT_RATIO = 0.5`)는 `overrides.ts` 한 곳에 둬요. Eraser는 기준을 공개하지 않았어요(`02` §4, 미확인). 단순한 규칙으로 정하고 PR에 적어요.

### 4.3 언제 적용하나

- **렌더할 때는 비파괴**: 현재 AST에 없는 키는 그냥 무시하고, 4.2 조건이면 자동 배치로 그려요. 파일은 안 바꿔요. 타이핑 중 `api` → `ap` → `api` 같은 중간 상태 때문에 배치를 잃지 않게요.
- **파일에 반영(정리)**은 다음 때만, 그리고 파싱 에러가 0개일 때만:
  1. 코드 패널을 닫을 때.
  2. 레이아웃 편집 모드에 들어갈 때(정리된 상태에서 시작).
- 코드에 에러가 있으면(캔버스가 마지막 정상 그림을 보여줄 때) 정리 안 하고, 편집 모드도 못 들어가요.
- 미리보기에서 4.2 리셋 조건이 걸리면 코드 패널 아래에 한 줄 안내: `코드가 많이 바뀌어서 자동 배치로 그려요. 패널을 닫으면 옮긴 배치가 지워져요`.
- 외부 편집기로 코드만 바뀐 파일도 같은 규칙: 열 때는 비파괴로 그리고, 위 1·2 시점에 정리돼요.

## 5. 캔버스 UI

### 5.1 상태

`normal` → (블록 선택) → `blockSelected` → (노드 누름) → `layoutEdit(blockId, selection)` → (Esc·완료·바깥 클릭) → `blockSelected`

### 5.2 진입·종료

- 진입: 블록 하나만 선택된 상태에서 그 블록 안 노드/그룹 위를 pointerdown → 편집 모드 + 그 요소 선택 + **바로 드래그 가능**(Eraser의 2단계 선택). 블록 빈 곳을 누르면 지금처럼 블록 전체 이동.
  - 구현: `wrap`에 capture 단계 `pointerdown` 리스너(지금 `dblclick`과 같은 방식). 히트면 `stopPropagation`.
- 팔레트 명령 `레이아웃 편집`(선택된 블록이 하나일 때).
- 진입 불가: 코드 에러가 있음, 그래프 종류가 아님, image 요소가 회전됨(`angle ≠ 0`) 또는 잠김. 이때 배너에 이유를 한 줄로.
- 종료: `Esc`, 배너 `완료`, 블록 밖 클릭. 종료 시 오버레이를 없애고 image를 다시 보여요.
- 더블클릭·Enter = 코드 패널 열기는 그대로예요(편집 모드 안에서도).

### 5.3 오버레이

- 편집 모드 동안 image 요소 위에 같은 크기의 절대 위치 `<div>`를 띄우고, 안에 `composeGraph` 결과 SVG를 인라인으로 그려요. image 요소는 `opacity: 0`(Excalidraw 쪽은 `CaptureUpdateAction.NEVER`).
- 좌표 변환 (줌 `z`, 스크롤 `sx, sy`, 블록 배율 `s = block.w / scene.width`):
  - 화면 ← 월드: `(wx + sx) * z`, `(wy + sy) * z` (Excalidraw `appState`, 캔버스 offset 보정).
  - 월드 ← 레이아웃: `block.x + s * (lx + origin.x)`.
  - 줌·팬이 바뀌면(`onChange`의 appState) 오버레이 위치만 갱신.
- 다크 모드: Excalidraw가 캔버스 전체를 반전하므로 오버레이 SVG에도 같은 CSS 필터를 걸어 그림이 튀지 않게 해요.

### 5.4 선택·드래그·스냅

- 클릭 = 선택(파란 테두리, `handles` 사각형 기준). `Shift`+클릭 = 다중 선택 토글. 빈 곳 드래그 = 사각 선택(블록 안에서만).
- 드래그 = 선택된 것 모두 이동. 매 `pointermove`에서 rAF로 `composeGraph` → 오버레이 SVG 교체(엣지·그룹이 실시간으로 따라와요).
- 방향키 1px, `Shift`+방향키 10px(레이아웃 좌표).
- 스냅(레이아웃 좌표, 기본 켬, `Alt` 누르는 동안 끔):
  1. 정렬 가이드: 다른 노드의 중심·변과 화면상 6px 이내면 붙고 분홍 가이드 선을 그려요.
  2. 가이드가 없으면 8px 격자.
- 선택한 그룹(자식 있음)을 끌면 자손 전부 이동.
- 엣지 선택·드래그, 노드 리사이즈는 이번 범위 밖(§9).

### 5.5 배너와 Reset Layout

- 화면 아래 가운데 배너(지금 오류 안내는 왼쪽 아래라 안 겹쳐요).
  - 블록 선택 + `layout` 있음: `직접 옮긴 배치예요` · **[레이아웃 초기화]**
  - 편집 모드: `노드를 끌어 옮겨요 · Alt를 누르면 맞춤이 꺼져요` · **[레이아웃 초기화]** · **[완료]**
  - 진입 불가: `코드 오류를 고치면 옮길 수 있어요` 등.
- `레이아웃 초기화` = 그 블록의 `layout` 삭제 → 자동 배치로 다시 그림. 확인 대화상자 없이 실행하고 undo로 되돌려요.
- 팔레트 명령 `레이아웃 초기화`도 같은 동작.

### 5.6 저장 경로와 undo

- 드래그는 **pointerup에서 한 번만** 커밋해요(매 프레임 저장 안 함).
- 커밋 = image 요소 `customData.layout`을 새 값으로 `updateScene(..., CaptureUpdateAction.IMMEDIATELY)`. 그러면:
  - Excalidraw 히스토리에 한 단계가 쌓여 `Ctrl/Cmd+Z`가 그대로 동작해요.
  - `handleChange` → `splitScene`이 `customData.layout`도 읽어 → `applyScene`이 `block.layout`에 반영 → `onChange({ blocks })` → 기존 디바운스 자동 저장.
- `drawKey`에 `layout` 해시를 넣어, 레이아웃이 바뀌면 새 그림을 만들어 `fileId`를 바꿔요(이 교체는 `NEVER`, 지금과 같음).
- 그림 경계가 바뀌면(노드를 왼쪽 위로 끌어 bbox가 커짐) **레이아웃 원점이 화면에서 안 움직이게** 블록을 보정해요: `block.x' = block.x + s * (origin.x - origin'.x)` (y도 같음), 폭·높이는 지금처럼 배율 유지.
- 블록 복제(`findCopies`)는 블록을 통째로 복사하므로 `layout`도 같이 복사돼요.
- 문서 임베드(`DiagramView`)와 내보내기(`exportBlock`)는 `renderBlock(block)`을 쓰므로, `renderBlock`이 `layout`을 받기만 하면 같은 그림이 나와요. 임베드의 effect 의존성에 `layout` 해시를 추가해요. Markdown 내보내기는 코드만 내보내서 배치는 빠져요(의도).

## 6. 서버·동기화 영향

- `syncExternal`: 변경 없음. 해시·revision 처리는 파일 내용과 무관해요. 외부에서 고친 v3 파일도 지금처럼 revision이 올라가요.
- revision: 레이아웃 커밋은 일반 블록 수정이라 저장 1회 = revision +1. pointerup 단위라 저장 폭주는 없어요.
- 409(stale write): 파일 단위 충돌 그대로. 다른 탭에서 같은 블록을 옮겨도 지금과 같은 충돌 안내가 떠요.
- 422: v3 파일을 v2 서버가 받으면 읽기 전용(기존 장치). v3 서버는 v1·v2를 그대로 읽어요.
- SSE: 웹이 아직 구독하지 않아요. 새로 할 일 없음.
- Yjs(나중): `blocks`가 Y.Array이고 `layout`은 블록 안 Y.Map으로 옮기기 쉬워요. 키가 노드 이름이라 동시 드래그는 키 단위로 합쳐져요.
- 서버는 여전히 127.0.0.1 전용, 외부 요청 없음, 워크스페이스 안에서만 씀. 새 파일·경로 없음.

## 7. 구현 티켓

| # | 제목 | 크기 | 의존 | 모델 | 내용 |
|---|---|---|---|---|---|
| D1 | `feat(server): accept block layout, format v3` | S (반나절) | – | Sonnet | §2.2·§2.3. `normalizeBlock` 검증·통과, `FORMAT_VERSION=3`, 웹 `Block.layout` 타입, `FILE_FORMAT_VERSION`, `App.tsx` 422 판단, 테스트 |
| D2 | `feat(render): compose graph layout with overrides` | L (1.5일) | – (`BlockLayout` 타입은 이 문서대로) | **Opus** | §3 전부. `graphBase`/`composeGraph` 분리, 그룹 재계산, 엣지 재경로, `scene.origin`·`handles`, 결정성·성능 |
| D3 | `feat(render): reconcile overrides with code edits` | S (반나절) | D2와 병렬 가능 | Sonnet | §4.1·§4.2 `reconcileLayout`, `structureOf`, 상수, 표 기반 단위 테스트 |
| D4 | `feat(web): carry block layout through render and save` | M (1일) | D1, D2, D3 | Sonnet | `renderBlock`/`fileIdFor`/캐시 키에 layout, `customData.layout` ↔ `block.layout`(`splitScene`/`applyScene`), 원점 보정, 코드 패널 닫을 때 정리·리셋 안내, 임베드·내보내기 |
| D5 | `feat(canvas): layout edit mode with drag, snap and Reset Layout` | L (2일) | D4 | **Opus** | §5.2~§5.5. 진입/종료, 오버레이 좌표 변환, 선택·다중·사각 선택, 드래그 미리보기, 스냅·가이드, 방향키, 배너, 팔레트 명령, undo 확인 |
| D6 | `test(e2e): drag a node, reload, reset` + 문서 | S (반나절) | D5 | Sonnet | 헤드리스 e2e, `README.md`(한국어) 사용법 한 단락, `CHANGELOG.md` |

- 순서: (D1, D2, D3 병렬) → D4 → D5 → D6. 합계 약 6일.
- Opus 배정 이유: D2는 좌표계·ELK 결과 가공이 얽혀 틀리기 쉬워요. D5는 Excalidraw 이벤트 가로채기·히스토리와 맞물려요.
- 각 티켓은 이슈 하나(`E<n>`이 아닌 `P0-3: ...` 접두어를 쓸지 관리자 결정, §9), `feat/` 브랜치, PR에 `Closes #<issue>`.

## 8. 테스트 계획

| 층 | 파일 | 확인 |
|---|---|---|
| 서버 | `test/workspace.test.js` | `layout` 왕복 저장, 잘못된 `layout` 400(숫자 아님·항목 초과·키 길이), 모르는 `v` 보존, `FORMAT_VERSION===3`, v2 파일 읽기→저장 시 v3, v4 파일 422 |
| 렌더 | `test/render/render.test.ts` | 기존 스냅샷 **불변**(`layout` 없음), 오버라이드 픽스처 스냅샷(라이트·다크), 같은 입력 두 번 = 같은 SVG, 그룹 bbox 재계산, 그룹째 이동 시 엣지 평행이동, 한 끝 이동 시 elbow 꺾임 수 ≤ 3, 모르는 키 무시, 100노드 compose < 16 ms |
| 정리 규칙 | `test/render/overrides.test.ts`(새) | §4.1 표의 각 줄 1케이스, §4.2 세 조건, 에러 있는 AST는 정리 안 함 |
| 웹 글루 | `test/web/canvas-sync.test.ts` | `customData.layout` → `applyScene`이 `block.layout` 반영, 값 같으면 같은 배열 반환(저장 안 함), 원점 보정 계산, `fileIdFor`가 layout에 따라 바뀜 |
| 웹 렌더 | `test/web/canvas-render.test.ts` | `renderBlock` 캐시가 layout 변경을 구분, 에러 코드면 마지막 그림 유지(layout 포함) |
| e2e | `test/e2e/block-drag.test.mjs`(새, 헤드리스) | 임시 워크스페이스에 아키텍처 블록 → 블록 클릭 → 노드 드래그 → 배너 보임 → 저장 대기 → 새로고침 후 위치 유지 → `Ctrl+Z`로 되돌림 → 다시 드래그 → `레이아웃 초기화` → 자동 배치 SVG와 같음 → 노드 이름 바꾸고 패널 닫기 → 그 키 사라짐 |

- 서버 테스트는 늘 임시 디렉터리 워크스페이스로 돌려요. 브라우저는 헤드리스만.

## 9. 위험과 열린 질문

### 위험

1. **Excalidraw 포인터 가로채기**: capture 단계 `pointerdown`을 막으면 Excalidraw 내부 상태(선택 박스, 드래그 시작)가 어긋날 수 있어요. 완화: 편집 모드에서는 오버레이가 이벤트를 먼저 받고(`pointer-events: auto`), 진입 판정만 capture에서 해요. D5 초반에 스파이크 반나절.
2. **undo 단계 섞임**: 레이아웃 커밋(`IMMEDIATELY`)과 그림 교체(`NEVER`)가 한 히스토리 단계 안에서 엇갈리면 undo 한 번에 그림만 돌아갈 수 있어요. 완화: 그림 교체는 늘 `customData.layout`에서 파생되게 하고 e2e로 확인.
3. **새 노드 겹침**: 오버라이드가 있는 상태에서 노드를 추가하면 ELK 위치가 옮긴 노드와 겹칠 수 있어요. 이번엔 받아들이고, 필요하면 ELK `interactive` 옵션으로 고정 노드를 힌트로 주는 안을 나중에 검토.
4. **블록 점프**: 원점 보정(§5.6)이 빠지면 노드를 왼쪽으로 끌 때 블록 전체가 오른쪽으로 튀어요. 단위 테스트로 막아요.
5. **성능**: 큰 그래프에서 매 프레임 SVG 문자열 재생성이 느릴 수 있어요. 넘으면 드래그 중엔 옮기는 노드만 transform하고 엣지는 pointerup에 다시 그려요.

### 열린 질문 (관리자·사용자 결정 필요)

1. **ERD 포함?** 엔티티 드래그는 쉬워 보이지만 포트 기반 관계선 재경로가 따로 필요해요. 제안: 이번엔 그래프만, ERD는 P1 티켓.
2. **노드 리사이즈?** Eraser는 크기 조절도 돼요. 제안: 형식만 예약(`w`,`h`), 구현은 다음.
3. **이름 변경 추적?** CodeMirror 변경 범위로 "이름만 바뀜"을 알아내 키를 옮길 수 있어요. 제안: 안 함(규칙이 단순하고 Eraser도 리셋 쪽).
4. **리셋 기준 수치**(절반 소실, ±50% 개수)가 적당한지. 써 보고 조정.
5. **이슈 제목 접두어**: 티켓 문서는 `E<n>`. 이 작업을 `E9`로 둘지 `P0-3`으로 둘지.
6. **엣지 드래그·waypoint**: `05` §14에서 P2. 이번 범위에서 제외 맞는지.
