# 08. OSS 스파이크: Excalidraw · tldraw · DSL+ELK.js · Yjs

> 범위: 직접 설치·빌드·실행해서 크기와 마찰을 잰 결과. 코드는 `research/spikes/`. 환경: Node v24.22.1, npm 11.19.1, Vite 6, React 19 (2026-11-12 측정).
> 표기: (미확인) = 확인 못 함, (추정) = 추론. 브라우저 확인은 헤드리스로만 했어요(§6).

## 0. 한눈에 보기

| 항목 | 설치(node_modules) | 번들(JS 합계) | 라이선스 | 결론 |
|---|---|---|---|---|
| Excalidraw 0.18.1 | 280 MB, 설치 8.3s | dist 8.2 MB / 126 파일, JS 합계 7.9 MB (gzip 2.6 MB) | MIT | 임베드 쉬움, 무겁고 "손그림" 스타일 고정. 헤드리스에서 렌더·도형 그리기 정상, 외부 요청 0건 |
| tldraw 5.6.0 | 111 MB, 설치 5.9s | dist 2.1 MB / 파일 2개, JS 2.06 MB (gzip 626 KB) | tldraw license (소스 공개, 오픈소스 아님. 기본 조건은 개발 환경 한정) | 렌더는 정상. 라이선스·CDN 요청이 걸림돌 |
| elkjs 0.12.1 | 8 MB | (Node 실행) | EPL-2.0 OR GPL-3.0+ | 레이아웃 용도로 적합. SVG 결과도 눈으로 확인 |
| yjs 13.6.33 | 8 MB (3 패키지) | (Node 실행) | MIT | 동기화 코어로 충분 |

## 1. (a) Excalidraw 임베드 — `spikes/excalidraw`

- 코드: `<Excalidraw initialData=…/>` 한 줄 + `index.css` import. 빌드 성공 (6.6s).
- 라이선스: npm `license: MIT` (`npm view @excalidraw/excalidraw license`). 워터마크·키 요구 없음. (추정: 공식 문서가 plus.excalidraw.com/docs/sdk 로 리다이렉트되는 점에서 상용 지원 SDK 쪽으로 무게가 옮겨가는 중이지만 라이브러리 자체는 MIT 유지 — 정책 변경 여부는 (미확인).) https://plus.excalidraw.com/docs/sdk/excalidraw/installation
- 마찰:
  1. Vite에서 `define: {'process.env.IS_PREACT': '"false"'}` 가 없으면 `process` 참조 문제 가능 — 넣어서 해결했어요.
  2. 번들이 큼. 의존성에 mermaid 계열(swimlanes, sequenceDiagram, architectureDiagram, cynefin, cytoscape, katex 등)이 코드 분할 청크로 딸려와 dist가 126파일/8.2 MB. 메인 청크 1.37 MB(gzip 443 KB) + 글꼴 서브셋 청크 1.82 MB(gzip 737 KB, 지연 로딩 (추정)).
  3. 컨테이너에 명시적 높이 필요(`height:100vh`).
- 런타임(헤드리스, §6): 툴바·속성 패널·줌 컨트롤이 모두 그려지고, `r` 키 + 드래그로 사각형이 손그림 선으로 그려졌어요. 콘솔 메시지 0건, 페이지 에러 0건, 실패 요청 0건. **127.0.0.1 밖으로 나간 요청 0건**(글꼴도 번들에서 로드).
- 시사점: Eraser의 "diagram-as-code로 만든 깔끔한 그림"과 스타일이 다름(손그림 + roughjs). 캔버스 모드(자유 드로잉) 용도로만 쓰는 게 맞아요. (추정)
- 로컬 전용 도구라 번들 크기(8 MB)는 실질 문제 아님. 네트워크 로드 아님.

## 2. (b) tldraw 임베드 — `spikes/tldraw`

- 코드: `<Tldraw persistenceKey="spike"/>` + `tldraw.css`. 빌드 성공 (3.3s), 단일 JS 2.06 MB (gzip 626 KB) + CSS 80 KB. 설정 마찰은 가장 적었어요(Vite 설정 무변경).
- 런타임(헤드리스, §6): 캔버스·툴바·스타일 패널이 그려지고 사각형 그리기 정상(`.tl-shape` 1개). 콘솔 메시지 0건, 페이지 에러 0건.
  - **워터마크**: 키 없이 `vite preview`(프로덕션 빌드)를 `http://127.0.0.1`로 열었더니 오른쪽 아래에 "Get a license for production" 문구가 보였어요(DOM 클래스 `tl-watermark_SEE-LICENSE`). "made with tldraw" 문구는 이 상태에선 안 나왔어요. 콘솔 라이선스 경고도 없었어요.
  - **외부 요청**: `cdn.tldraw.com/5.6.0/` 으로 35건(글꼴 woff2 16개, 아이콘 스프라이트, 임베드 아이콘 png들). 오프라인이나 외부 통신 금지 환경에서는 자산을 직접 호스팅해야 해요. 자산 경로를 바꾸는 방법은 이번에 시험 안 함 (미확인).
- **라이선스 (원문 직접 확인, 2026-11-12)**: `curl`로 원문을 받아 읽었어요. 설치된 `node_modules/tldraw/LICENSE.md`는 GitHub 원문을 가리키는 한 줄짜리라, 원문 = GitHub `main`의 LICENSE.md 로 봤어요.
  - 기본 조건: "Not to use the Software in Production Environments." 허용은 "Use the Software in Development Environments", 수정, 번들, 기여예요. https://github.com/tldraw/tldraw/blob/main/LICENSE.md
  - Development Environment 정의: "internal hosting or deployment … for development, testing, or staging purposes … not accessible to end users". Production은 "used to provide functionality to end users"를 포함해요. 같은 LICENSE.md
  - 키: "Not to disable, change, or interfere with the Software's License Key enforcement." 같은 LICENSE.md
  - 트라이얼 기간: LICENSE.md에는 **"for the specified period"** 라고만 있고 일수가 없어요. **100일은 tldraw.dev 문서·가격 페이지의 문구**예요("free 100-day trial license"). 상업 단위당 1회. https://tldraw.dev/community/license , https://tldraw.dev/pricing
  - hobby·워터마크: LICENSE.md 본문에는 hobby 라이선스가 없어요("Alternative licenses are available … for commercial and non-commercial use"만 있음). hobby는 tldraw.dev 문서에 있어요: 비상업용·재량 발급, 쓸 때 "the "made with tldraw" watermark must be shown on the canvas". https://tldraw.dev/community/license
  - 데이터 전송: LICENSE.md는 "may collect and transmit usage data to tldraw for license compliance purposes" 라고만 해요. tldraw.dev 문서는 더 구체적이에요: commercial·hobby는 "no information is sent", 프로덕션 trial은 라이선스 키 해시를 보내고 "No user data, canvas contents, or … (PII) is sent". https://tldraw.dev/community/license
  - 코드 확인(5.6.0, `@tldraw/editor/dist-esm/lib/license/LicenseManager.mjs`): 개발 판별은 `protocol === "http:"` 이거나 https+루프백이거나 `NODE_ENV !== "production"` 이면 개발로 봐요. 개발로 판별되면 추적 요청이 없어요. 그 밖에는 키 상태에 따라 `cdn.tldraw.com/.../watermark-track.svg` 로 `license_type`·`license_id`·현재 페이지 `url` 을 붙여 요청해요. 이 유형에 `with_watermark`(hobby로 보임)와 `unlicensed`(키 없는 프로덕션)도 있어서, 문서의 "hobby는 아무것도 안 보냄"과 다르게 읽혀요. 런타임에서 이 요청을 직접 본 건 아니에요(이번 실행은 http라 개발 판별) (미확인).
  - 가격: 가격 페이지는 "Value-based pricing", "Talk to sales", 스타트업 할인, 무료 hobby 신청만 있고 금액은 없어요. https://tldraw.dev/pricing
- 이전 판의 정정: "라이선스 문구는 AI 요약(WebFetch)을 거쳤으므로 원문 확인 필요"라고 했던 부분을 원문 기준으로 바꿨어요. 바뀐 점은 (1) 100일은 LICENSE가 아니라 tldraw.dev 문구, (2) hobby·워터마크 의무도 LICENSE가 아니라 tldraw.dev 문구, (3) 데이터 전송은 라이선스 종류별로 다르게 문서화돼 있고 코드와 문서가 어긋나 보임, (4) "키는 클라이언트에서 오프라인 검증 가능"은 문서 원문("validated on the client. You can use them offline")과 일치.
- 시사점: 이 도구는 판매·배포 없이 회사 안에서만 써요(전제, §7). 그래도 tldraw는 "배포"가 아니라 "프로덕션 사용"을 막는 라이선스라서 내부 전용이어도 걸려요. 판정은 §7. 코드는 http면 무조건 개발로 판별해서 기술적으로는 키 없이 돌아가지만, 그게 라이선스상 허용이라는 뜻은 아니에요.

## 3. (c) Eraser 유사 DSL + ELK.js → SVG — `spikes/dsl`

문법: `A > B: label`, 노드 `A [icon: x, color: y]`, 그룹 `G { … }` (중첩 가능), 주석 `//`.

- 파서: 줄 단위 수제 파서 약 45줄(`parser.mjs`). 에지(`>`,`<`,`<>`,`-`,`--`)·노드 속성·중첩 그룹·`}` 불일치 에러(줄 번호) 처리. 6노드/5에지 샘플 파싱 에러 0.
- 레이아웃: `elkjs/lib/elk.bundled.js`, `layered`, `direction RIGHT`, `hierarchyHandling: INCLUDE_CHILDREN`(그룹 경계를 넘는 에지 라우팅에 필요).
- 성능: 샘플 6노드 약 70 ms(첫 호출 웜업 포함), 300노드/300에지 무작위 그래프 약 135 ms (Node 24). 2026-11-12 재실행에서 68 ms / 141 ms로 비슷했어요. 인터랙티브 편집 중 실시간 재레이아웃에 충분. (추정: 실제 사용 그래프는 더 구조적이라 비슷하거나 더 빠름)
- 렌더: `render.mjs`가 rect/text/polyline+marker로 SVG 생성(그룹은 점선 박스, color→파스텔 fill, icon은 현재 텍스트 `[icon]` 대체).
- **발견한 함정 (ELK)**: 에지 좌표는 root 기준이 아니라 **출발/도착 노드의 최소 공통 조상(LCA) 기준**. 그룹 내부 에지(API>Worker)를 root 기준으로 그리면 엉뚱한 위치에 그려짐 → LCA의 절대 좌표를 더해 해결(`lcaOffset`). 에지 라벨 좌표도 동일.
- 한계/마찰: 라벨 크기는 글자수×7px 추정치(실제 텍스트 측정 필요), 아이콘 세트 미구현, `<>`의 양방향 화살표는 마커 1개만 그림, 에지가 한 줄로 파싱되는 단순 정규식이라 노드 이름에 `-`/`>`/`:` 포함 시 오파싱 (추정으로 토크나이저 필요).
- 라이선스: elkjs `EPL-2.0 OR GPL-3.0-or-later`(`npm view elkjs license`). 약한 카피레프트(EPL)라 번들해서 배포할 때만 elkjs 수정분 공개 의무 (추정, 법률 검토 아님).
- **시각 검증(헤드리스 스크린샷을 눈으로 확인)**: 1184×200 SVG가 말이 되게 그려져요.
  - 맞는 것: Client(파랑) → 점선 `Backend` 그룹 안의 API(초록) → Worker → DB(주황) 순서로 왼쪽→오른쪽 배치. 그룹 안 에지(enqueue, write, query)가 그룹 박스 안에 들어가고 박스 위치와 맞아요(LCA 보정이 제대로 먹음). 화살촉이 대상 노드 테두리에 닿아요. 글자가 박스를 넘치지 않아요.
  - 어색한 것: (1) `API <> Cache` 는 Cache 쪽 화살촉만 있어요(알려진 한계). (2) Cache 가 그룹 밖 오른쪽 끝(x≈1032)에 떨어져 있어 `get/set` 에지가 그룹 아래쪽을 가로질러 길게 가요. 라벨 `get/set` 도 Cache 근처에 붙어 출발점과 멀어요. (3) `query` 와 `get/set` 에지가 약 10px 간격으로 나란히 달려 구분이 어려워요. (4) 에지 라벨이 선 위가 아니라 선 아래에 떠 있어요(`HTTPS`). 실사용 전에 라벨 배치와 에지 간격 옵션 조정이 필요해요 (추정: ELK `spacing.edgeEdge`, 라벨 배치 옵션으로 개선 가능).

## 4. (d) Yjs 동기화 — `spikes/yjs`

- 두 `Y.Doc`을 메모리에서 `update` 이벤트로 서로 릴레이(origin 태그로 에코 방지). 오프라인 구간을 큐로 흉내.
- 결과: 오프라인 중 같은 키(`nodes.A`) 동시 수정 + 같은 `Y.Text` 끝에 동시 삽입 → 재연결 후 **수렴 true**. Map은 last-writer-wins(`{x:99,y:99}`), Text는 두 삽입이 모두 보존(`A > B: x: y`). 상태 135 bytes.
- 마찰: 거의 없음. 설치 3패키지/8 MB. 주의점: (1) Map 값에 객체를 통째로 넣으면 필드 단위 병합 안 됨 → 중첩 `Y.Map` 사용 권장, (2) DSL을 `Y.Text`로 공유하면 글자 단위 병합이 되지만 동시 편집 결과가 문법적으로 깨질 수 있어 파서 에러 허용 필요. 두 항목은 설계 추정이며 이 스파이크에선 (2)만 관찰됨("`: x: y`").
- 네트워크 레이어(y-websocket, y-webrtc)와 영속화(y-indexeddb/leveldb)는 이번에 시도하지 않음 (미확인).
- 로컬 단일 사용자라면 Yjs는 과할 수 있음. 다중 에이전트/사용자 동시 편집 계획이 있을 때 가치 있음. (추정)

## 5. 권고

1. **DSL → ELK → SVG 파이프라인을 코어로**: 의존성이 작고(8 MB), 70~140 ms로 빠르고, Eraser의 핵심(diagram-as-code)과 직결. LCA 좌표 보정은 필수. 결과 SVG도 눈으로 확인해서 쓸 만했어요. 라벨 위치·에지 간격은 다듬어야 해요.
2. **자유 캔버스가 필요하면 Excalidraw(MIT)**: 라이선스 리스크 없고, 헤드리스 확인에서 외부 요청이 0건이라 로컬 전용 원칙에도 맞아요. 단 번들 8 MB, 스타일이 다르므로 별도 "캔버스 모드"로 격리하고 lazy-load.
3. **tldraw는 기본 선택지에서 제외 (내부 전용 전제에서도 유지)**: 원문 LICENSE.md는 배포가 아니라 프로덕션 사용 자체를 막고, 사내 업무 사용을 개발 환경으로 볼 근거가 원문에 없어요(§7). 쓰려면 commercial 계약을 하거나, tldraw에 사내 사용이 개발 환경에 드는지 서면으로 확인받아야 해요. 키 없이도 CDN에 35건 요청이 나가요.
4. **Yjs는 협업 요구가 확정될 때 도입**: 문서 모델을 처음부터 Yjs 공유 타입(중첩 Y.Map + Y.Text)으로 잡아 두면 이후 전환 비용이 낮음. 지금 단계에서는 필수 아님.
5. 다음 스파이크: (a) ELK 결과를 Excalidraw elements로 변환(캔버스 모드 연결), (b) 아이콘 세트와 텍스트 실측, (c) ELK 라벨 배치·에지 간격 옵션 조정.

## 6. 헤드리스 확인 방법 (2026-11-12)

- 서빙: 각 스파이크를 `vite build` 후 `vite preview --host 127.0.0.1 --port 4781x --strictPort` 로 띄웠어요. 확인 뒤 두 서버 모두 종료.
- 브라우저: `playwright-core` 1.65(저장소 밖 임시 폴더에 설치)로 이미 받아 둔 `chromium_headless_shell-1243` 을 `headless: true` 로 실행. 보이는 창은 열지 않았어요. 처음엔 playwright-core 기본 브라우저 버전(1254)이 없어 실패해서 `executablePath` 로 기존 headless shell을 지정했어요.
- 절차: 1280×800 뷰포트로 열고 networkidle + 2.5초 대기 → 빈 화면 스크린샷 → `r` 키, 드래그로 사각형 그리기 → 스크린샷. 콘솔 메시지, `pageerror`, 실패 요청, 127.0.0.1 밖 요청을 모았어요. 첫 화면까지 약 3.2~3.4초(대기 포함).
- SVG: `out.svg` 를 HTML 안에 넣어 1220×220 뷰포트로 스크린샷. `file://` 로 SVG를 직접 열고 `fullPage` 스크린샷을 찍으면 30초 타임아웃이 나서 이렇게 바꿨어요.
- 스크린샷은 용량 때문에 저장소에 넣지 않았어요. 위 결과는 스크린샷을 눈으로 보고 적은 거예요.

## 7. 라이선스 판정: 내부 전용·비배포 시나리오 (2026-11-12)

> 전제(사용자 확정): 판매·배포하지 않고 회사 안에서만 써요. 외부(고객·공개 인터넷)에 노출하지 않아요.
> 근거는 아래 원문을 `curl`로 받아 직접 읽은 것만 썼어요. 법률 검토가 아니라서 "원문에 근거 없음"은 단정하지 않고 (미확인)으로 둬요.

### 7.1 의무가 언제 생기나 (원문 기준)

| 라이선스 | 의무가 생기는 계기 (원문) | 사내 전용·비배포일 때 | 출처 |
|---|---|---|---|
| MIT (Excalidraw, Yjs) | 복사본에 "The above copyright notice and this permission notice shall be included in all copies" | 사용 제한 없음. 코드를 복사해 넣으면 저작권 고지만 유지 | <https://github.com/excalidraw/excalidraw/blob/master/LICENSE> |
| Apache-2.0 | §4 "Redistribution" 때 고지·라이선스 동봉 | 재배포가 없으면 §4 조건이 걸릴 일 없음 | <https://www.apache.org/licenses/LICENSE-2.0.txt> |
| EPL-2.0 (elkjs) | §3.1 "If a Contributor Distributes the Program in any form" → 소스 제공. "Distribute"는 "making available in any manner that enables the transfer of a copy" | 사외 배포가 없으면 소스 제공 의무 없음. 사내 다른 PC에 복사하거나 사내 웹으로 JS를 내려주는 게 EPL의 "Distribute"인지는 원문에 사내 예외가 없어 (미확인). 걸려도 elkjs를 고치지 않으면 "elkjs 원본 소스 위치 안내" 정도라 부담 작음 (추정) | <https://github.com/kieler/elkjs/blob/master/LICENSE.md> |
| GPL-3.0 (elkjs의 선택지) | "To "convey" a work means any kind of propagation that enables other parties to make or receive copies." §2 "You may make, run and propagate covered works that you do not convey, without conditions" | 사외로 넘기지 않으면 조건 없음. FSF FAQ: 사내 복사는 "the organization is just making the copies for itself". 단 외부 계약자에게 주면 배포 | <https://www.gnu.org/licenses/gpl-3.0.txt>, <https://www.gnu.org/licenses/gpl-faq.html#InternalDistribution> |
| AGPL-3.0 (현재 후보 부품엔 없음) | §13 "if you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network … the Corresponding Source" | 고쳐서 사내 네트워크로 동료에게 제공하면, 그 동료들에게 소스를 제공해야 할 수 있음(동료도 "users interacting … remotely"로 읽힘 (추정)). 고치지 않거나 127.0.0.1에서 본인만 쓰면 해당 없음 | <https://www.gnu.org/licenses/agpl-3.0.txt> |
| MPL-2.0 | §3.1·§3.2 "Distribution of Source/Executable Form" 때만 | 배포가 없으면 의무 없음 | <https://www.mozilla.org/media/MPL/2.0/index.txt> |
| tldraw license | 배포가 아니라 **사용 환경**으로 갈려요: "Not to use the Software in Production Environments" | 아래 7.2 | <https://github.com/tldraw/tldraw/blob/main/LICENSE.md> |

요약: 오픈소스 라이선스(MIT·Apache·MPL·EPL·GPL)는 의무가 "배포/전달"에 걸려 있어서, 사내 전용이면 사실상 고지 유지 정도만 남아요. AGPL만 "네트워크로 제공 + 수정"에 걸려요. tldraw는 성격이 달라요.

### 7.2 tldraw: 회사 내부 사용은 production인가

- 원문 정의:
  - Production Environment: "any production deployment … or where the software is used to provide functionality to end users, customers, or the public. Production Environment excludes internal development."
  - Development Environment: "any internal hosting or deployment … for development, testing, or staging purposes, operated by your organization and not accessible to end users, customers, or the public."
- 판정:
  1. 원문의 예외는 "internal **development**"이지 "internal use"가 아니에요. Development Environment도 "개발·테스트·스테이징 목적"으로 한정돼요. 회사 직원이 실제 업무에 쓰는 것은 이 목적에 안 들어맞아요. → **사내 업무 사용을 Development로 볼 근거는 원문에 없어요.**
  2. "end users"가 회사 직원을 포함하는지는 원문에 정의가 없어요. 직원이 이 도구의 최종 사용자라면 Production 정의("used to provide functionality to end users")에 들어가요. → **Production일 가능성이 높다 (추정). 단정은 못 해요 (미확인: "end users" 정의 없음, tldraw 서면 확인 필요).**
  3. Production이면 키가 필요해요. LICENSE.md는 trial("for the specified period")과 commercial(별도 계약)만 말해요. hobby는 tldraw.dev 문서에만 있고 "non-commercial projects" 대상이에요. 회사 업무용 도구가 "non-commercial"인지는 원문·문서에 정의가 없어요 (미확인). 회사 업무라 hobby 대상이 아닐 가능성이 높아요 (추정).
  4. 워터마크: LICENSE.md 본문은 워터마크 의무를 직접 두지 않고 "ensure proper watermark display"라는 기술적 집행만 언급해요. 워터마크 의무가 문서로 확인되는 건 hobby뿐이에요(tldraw.dev). commercial 키에 워터마크가 붙는지는 공개 문서에 없어요 (미확인). 키 없이 http로 연 이번 실행에서는 "Get a license for production" 문구가 화면에 떴어요(§2).
  5. 배포 관련 조건(독립 제품 배포 금지, 라이선스 동봉)은 배포를 안 하므로 해당 없음.
- 결론: 내부 전용 전제로 바꿔도 **tldraw 제외 결론은 유지**해요. 이유가 "배포하면 문제"에서 "사내 업무 사용도 production일 수 있음"으로 바뀌었을 뿐이에요. 쓰려면 (a) commercial 계약, 또는 (b) tldraw에 "사내 비공개 업무 도구가 Development Environment인지" 서면 확인이 먼저예요.

### 7.3 Eraser 쪽 자산과의 관계

- 오픈소스 부품 라이선스와 별개로, Eraser의 실제 자산 파일(아이콘·일러스트·폰트 파일·코드)을 복제하는 건 사내 전용이어도 저작권 문제예요. 복제는 배포 여부와 관계없이 그 자체로 권리자 허락이 필요한 행위라서요 (추정, 법률 검토 아님). 자세한 구분은 [00](00-summary.md) §1 전제와 [04](04-visual-design.md) 참고. 코드 복제 금지의 예외: Eraser가 MIT로 공개한 eraser-diagrams 코드는 MIT 조건대로 쓸 수 있어요.
