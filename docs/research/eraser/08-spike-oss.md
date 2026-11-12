# 08. OSS 스파이크: Excalidraw · tldraw · DSL+ELK.js · Yjs

> 범위: 직접 설치·빌드·실행해서 크기와 마찰을 잰 결과. 코드는 `research/spikes/`. 환경: Node v24.22.1, npm 11.19.1, Vite 6, React 19 (2026-11-12 측정).
> 표기: (미확인) = 확인 못 함, (추정) = 추론. 브라우저는 열지 않았고, 빌드/Node 실행까지만 검증했어요.

## 0. 한눈에 보기

| 항목 | 설치(node_modules) | 번들(JS 합계) | 라이선스 | 결론 |
|---|---|---|---|---|
| Excalidraw 0.18.1 | 280 MB, 설치 8.3s | dist 8.2 MB / 126 파일, JS 합계 7.9 MB (gzip 2.6 MB) | MIT | 임베드 쉬움, 무겁고 "손그림" 스타일 고정 |
| tldraw 5.6.0 | 111 MB, 설치 5.9s | dist 2.1 MB / 파일 2개, JS 2.06 MB (gzip 626 KB) | 자체 라이선스(프로덕션은 키 필요) | 기능 좋지만 라이선스가 걸림돌 |
| elkjs 0.12.1 | 8 MB | (Node 실행) | EPL-2.0 OR GPL-3.0+ | 레이아웃 용도로 적합 |
| yjs 13.6.33 | 8 MB (3 패키지) | (Node 실행) | MIT | 동기화 코어로 충분 |

## 1. (a) Excalidraw 임베드 — `spikes/excalidraw`

- 코드: `<Excalidraw initialData=…/>` 한 줄 + `index.css` import. 빌드 성공 (6.6s).
- 라이선스: npm `license: MIT` (`npm view @excalidraw/excalidraw license`). 워터마크·키 요구 없음. (추정: 공식 문서가 plus.excalidraw.com/docs/sdk 로 리다이렉트되는 점에서 상용 지원 SDK 쪽으로 무게가 옮겨가는 중이지만 라이브러리 자체는 MIT 유지 — 정책 변경 여부는 (미확인).) https://plus.excalidraw.com/docs/sdk/excalidraw/installation
- 마찰:
  1. Vite에서 `define: {'process.env.IS_PREACT': '"false"'}` 가 없으면 `process` 참조 문제 가능 — 넣어서 해결했어요.
  2. 번들이 큼. 의존성에 mermaid 계열(swimlanes, sequenceDiagram, architectureDiagram, cynefin, cytoscape, katex 등)이 코드 분할 청크로 딸려와 dist가 126파일/8.2 MB. 메인 청크 1.37 MB(gzip 443 KB) + 글꼴 서브셋 청크 1.82 MB(gzip 737 KB, 지연 로딩 (추정)).
  3. 컨테이너에 명시적 높이 필요(`height:100vh`).
- 시사점: Eraser의 "diagram-as-code로 만든 깔끔한 그림"과 스타일이 다름(손그림 + roughjs). 캔버스 모드(자유 드로잉) 용도로만 쓰는 게 맞아요. (추정)
- 로컬 전용 도구라 번들 크기(8 MB)는 실질 문제 아님. 네트워크 로드 아님.

## 2. (b) tldraw 임베드 — `spikes/tldraw`

- 코드: `<Tldraw persistenceKey="spike"/>` + `tldraw.css`. 빌드 성공 (3.3s), 단일 JS 2.06 MB (gzip 626 KB) + CSS 80 KB. 설정 마찰은 가장 적었어요(Vite 설정 무변경).
- **라이선스 (중요)**: npm 필드가 `SEE LICENSE IN LICENSE.md` 이고 MIT/Apache가 아님.
  - "Not to use the Software in Production Environments" — 기본 라이선스는 개발 환경(최종 사용자 접근 불가)에서만 허용. 프로덕션은 트라이얼 또는 상용 계약 + License Key 필요. https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md
  - License Key 집행을 끄거나 변경 금지. 소프트웨어가 라이선스 준수를 위해 사용 데이터를 tldraw에 전송할 수 있다고 명시. 같은 LICENSE.md
  - 옵션: 100일 무료 트라이얼, 상용(가치 기반 가격, 영업 문의), 무료 hobby 라이선스, 스타트업 할인. https://tldraw.dev/pricing
  - hobby: 비상업·재량 발급이며 캔버스에 "made with tldraw" 워터마크를 반드시 표시. 프로덕션에서는 유효한 키가 있어야 동작, 키는 클라이언트에서 오프라인 검증 가능. https://tldraw.dev/community/license
- 이 스파이크는 키 없이 빌드만 했고 **브라우저 런타임 동작(워터마크 표시/개발 모드 거동)은 (미확인)**.
- 시사점: "로컬 셀프호스트, 개인 사용"이면 hobby 키로 가능해 보이나 재량 발급이고 워터마크 의무가 있음. 오픈소스로 배포하거나 팀/상용으로 쓰면 유료 협의. 프로젝트 라이선스 정책과 충돌 위험이 커서 기본 선택지로는 비추. (추정)
- 라이선스 문구는 AI 요약(WebFetch)을 거쳤으므로 최종 결정 전 원문 직접 확인 필요.

## 3. (c) Eraser 유사 DSL + ELK.js → SVG — `spikes/dsl`

문법: `A > B: label`, 노드 `A [icon: x, color: y]`, 그룹 `G { … }` (중첩 가능), 주석 `//`.

- 파서: 줄 단위 수제 파서 약 45줄(`parser.mjs`). 에지(`>`,`<`,`<>`,`-`,`--`)·노드 속성·중첩 그룹·`}` 불일치 에러(줄 번호) 처리. 6노드/5에지 샘플 파싱 에러 0.
- 레이아웃: `elkjs/lib/elk.bundled.js`, `layered`, `direction RIGHT`, `hierarchyHandling: INCLUDE_CHILDREN`(그룹 경계를 넘는 에지 라우팅에 필요).
- 성능: 샘플 6노드 약 70 ms(첫 호출 웜업 포함), 300노드/300에지 무작위 그래프 약 135 ms (Node 24). 인터랙티브 편집 중 실시간 재레이아웃에 충분. (추정: 실제 사용 그래프는 더 구조적이라 비슷하거나 더 빠름)
- 렌더: `render.mjs`가 rect/text/polyline+marker로 SVG 생성(그룹은 점선 박스, color→파스텔 fill, icon은 현재 텍스트 `[icon]` 대체).
- **발견한 함정 (ELK)**: 에지 좌표는 root 기준이 아니라 **출발/도착 노드의 최소 공통 조상(LCA) 기준**. 그룹 내부 에지(API>Worker)를 root 기준으로 그리면 엉뚱한 위치에 그려짐 → LCA의 절대 좌표를 더해 해결(`lcaOffset`). 에지 라벨 좌표도 동일.
- 한계/마찰: 라벨 크기는 글자수×7px 추정치(실제 텍스트 측정 필요), 아이콘 세트 미구현, `<>`의 양방향 화살표는 마커 1개만 그림, 에지가 한 줄로 파싱되는 단순 정규식이라 노드 이름에 `-`/`>`/`:` 포함 시 오파싱 (추정으로 토크나이저 필요).
- 라이선스: elkjs `EPL-2.0 OR GPL-3.0-or-later`(`npm view elkjs license`). 약한 카피레프트(EPL)라 번들 사용 시 elkjs 수정분만 공개 의무 (추정, 법률 검토 아님). 
- 시각 검증: SVG 파일은 생성했지만 이미지로 렌더해 눈으로 확인하지는 않음 — 좌표는 수치로만 확인(API>Worker: 428→527, Client>API: 132→308 일치). 시각 확인은 (미확인).

## 4. (d) Yjs 동기화 — `spikes/yjs`

- 두 `Y.Doc`을 메모리에서 `update` 이벤트로 서로 릴레이(origin 태그로 에코 방지). 오프라인 구간을 큐로 흉내.
- 결과: 오프라인 중 같은 키(`nodes.A`) 동시 수정 + 같은 `Y.Text` 끝에 동시 삽입 → 재연결 후 **수렴 true**. Map은 last-writer-wins(`{x:99,y:99}`), Text는 두 삽입이 모두 보존(`A > B: x: y`). 상태 135 bytes.
- 마찰: 거의 없음. 설치 3패키지/8 MB. 주의점: (1) Map 값에 객체를 통째로 넣으면 필드 단위 병합 안 됨 → 중첩 `Y.Map` 사용 권장, (2) DSL을 `Y.Text`로 공유하면 글자 단위 병합이 되지만 동시 편집 결과가 문법적으로 깨질 수 있어 파서 에러 허용 필요. 두 항목은 설계 추정이며 이 스파이크에선 (2)만 관찰됨("`: x: y`").
- 네트워크 레이어(y-websocket, y-webrtc)와 영속화(y-indexeddb/leveldb)는 이번에 시도하지 않음 (미확인).
- 로컬 단일 사용자라면 Yjs는 과할 수 있음. 다중 에이전트/사용자 동시 편집 계획이 있을 때 가치 있음. (추정)

## 5. 권고

1. **DSL → ELK → SVG 파이프라인을 코어로**: 의존성이 작고(8 MB), 70~135 ms로 빠르고, Eraser의 핵심(diagram-as-code)과 직결. LCA 좌표 보정은 필수.
2. **자유 캔버스가 필요하면 Excalidraw(MIT)**: 라이선스 리스크 없음. 단 번들 8 MB, 스타일이 다르므로 별도 "캔버스 모드"로 격리하고 lazy-load.
3. **tldraw는 기본 선택지에서 제외**: 개발 환경 한정 라이선스 + 프로덕션 키 + 데이터 전송 조항. 개인 비상업 hobby 라이선스(워터마크 의무)로만 가능. 라이선스가 정리되기 전에는 채택 금지.
4. **Yjs는 협업 요구가 확정될 때 도입**: 문서 모델을 처음부터 Yjs 공유 타입(중첩 Y.Map + Y.Text)으로 잡아 두면 이후 전환 비용이 낮음. 지금 단계에서는 필수 아님.
5. 다음 스파이크: (a) 헤드리스 브라우저로 Excalidraw/tldraw 런타임 확인, (b) ELK 결과를 Excalidraw elements로 변환(캔버스 모드 연결), (c) 아이콘 세트와 텍스트 실측.
