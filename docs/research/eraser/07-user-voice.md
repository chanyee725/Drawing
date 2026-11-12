# 07. User voice and use cases (Eraser.io)

조사일: 2026-11-12. 공개 자료만 사용. 로그인/가입 없음. 리뷰어 이름·핸들은 기록하지 않음.
표기: (미확인) = 출처로 확인 못 함, (추정) = 내 추론.

## 0. 먼저 알아둘 한계

- **직접 커뮤니티 증거가 얇아요.** Reddit은 재시도(2026-11-12)에도 403/연결 실패로 본문을 못 읽었고, 검색 요약으로만 확인했어요 (미확인 부분 많음).
- Hacker News에서 Eraser 관련 글은 있지만 **댓글이 거의 없어요.** "Eraser – Figma for Engineers" (2023-07, 3 points, 댓글 0): https://hn.algolia.com/api/v1/items/36710701 . 2026-09 "Open-Sourcing Eraser Diagrams"도 2 points, 댓글 0: https://hn.algolia.com/api/v1/search?query=eraser.io&tags=story&hitsPerPage=15
- G2의 Eraser 페이지는 재시도에도 403으로 못 열었어요. 검색에 나온 "G2 4.3 (3 reviews)"는 **다른 제품(데이터 삭제 툴)과 섞였을 가능성**이 있어요 (미확인): https://www.g2.com/products/eraser
- 아래 평가 상당수는 **비교/리뷰 사이트(제휴성 포함)** 이고 사용자 원문이 아니에요. 신뢰도 낮음으로 취급하세요.
- 무료 플랜 한도 수치는 사이트마다 달라요 (3 vs 5, 월 5 크레딧 등). 숫자는 신뢰하지 마세요.

## 1. 사람들이 Eraser를 쓰는 용도

공식 use-cases 페이지(https://www.eraser.io/use-cases)에 나열된 용도:

- Architecture Diagrams (대표), Design Docs, Documentation
- Data Flow, Sequence(Auth/API flow), State, Dependency, Data Model(ERD)
- Kubernetes Architecture, DevOps, CI/CD and SDLC, Network, Git Diagrams
- Threat Modeling, Decision Trees, Process Flow
- Whiteboard Interview, Wireframes, Brainstorming

홈페이지 현재 포지셔닝은 "AI platform for architecture"예요. 클라우드·코드·CMDB·스프레드시트에서 시스템 다이어그램을 만들고, 대상은 enterprise architects, DevOps, consultants, 엔지니어예요. "over 5,000 customers" 주장 (벤더 주장): https://www.eraser.io/

제3자가 정리한 전형적 사용 (https://toolradar.com/tools/eraser-io):

- 클라우드 아키텍처 / ERD / flowchart / sequence 다이어그램
- GitHub README에 다이어그램 임베드
- 코드베이스 시각화, 시스템 설계 문서화
- 엔지니어링 팀의 이해관계자 커뮤니케이션

요청하신 용도별로 정리하면:

| 용도 | 근거 | 비고 |
|---|---|---|
| 아키텍처 문서 | use-cases, toolradar | 가장 명확함 |
| 디자인 리뷰 / 설계 문서 | use-cases의 Design Docs | docs+diagram 한 파일 구조 |
| RFC | 직접 근거 못 찾음 | (미확인) Design Docs의 변형으로 쓰일 것 (추정) |
| 온보딩 | 직접 근거 못 찾음 | (미확인) 아키텍처 맵 공유 용도 (추정) |
| 초기 기획 | Product Hunt 리뷰: 모호한 요구사항을 시각 지도로 바꿈 | 아래 3절 |

## 2. 공식 gallery 분류

- 지금의 `/templates`는 전통적인 템플릿 갤러리가 아니라 **"map examples" 갤러리**예요 (총 34개). 분류 필터: Architecture(16), Security(12), Network(7), Cloud(9), Process(2), Operations(9). 예: C4 model, Threat model, AWS network topology, Disaster recovery map, Data center to AWS migration. 태그: Drill-down, Current vs future state, C4 model, Data flow diagram: https://www.eraser.io/templates
- use-cases 페이지의 예시: AWS Automated Data Analytics, Azure AKS baseline, Three tier web application. 무료 메이커: Architecture, Data Flow, Sequence, Network, Flowchart, ERD: https://www.eraser.io/use-cases
- 문서의 "templates"는 **AI 생성용 시작 구조(preset의 Templates 탭)** 를 뜻해요. 템플릿 = 다이어그램/문서/둘 다 가진 Eraser 파일: https://docs.eraser.io/templates
- 시사점 (추정): 제품이 개별 다이어그램 → **엔터프라이즈 아키텍처 맵** 쪽으로 이동 중이에요. 로컬 도구는 이 영역과 겹치지 않는 개인/소규모 개발 문서 쪽이 노릴 만해요.

## 3. 칭찬 (Praise)

**Product Hunt** (4.9/5, 10 reviews): https://www.producthunt.com/products/eraser-2/reviews

- 속도와 쉬운 UI: "Whiteboarding on steroids"
- AI 다이어그램: "a game-changer", 시간 단축
- 결과물 품질: "the diagrams are just beautiful"
- 초기 기획: "vague requirements"를 시각 지도로 변환
- 지원: "really excellent customer support"

**Reddit r/softwarearchitecture** "Is eraser.io any good?" (2025-05): https://redlib.ssps.io/r/softwarearchitecture/comments/1ks1sg8/is_eraserio_any_good/ (본문은 못 읽음, 검색 요약만)

- draw.io에는 깔끔한 diagram-as-code가 없다는 불만 → Eraser가 지원한다는 답글 (미확인 세부)
- (재확인 2026-11-12) 해당 가이드 원문에는 "Eraser가 draw.io보다 Git 추적에 낫다"는 문장이 **없어요**. 일반론만 있어요: diagram-as-code는 Git으로 변경 추적·diff가 가능하다 (벤더 글): https://www.eraser.io/guides/best-diagram-as-code-tools-in-2025 . 앞의 "의견이 있었다"는 전달은 근거 없음으로 낮춰요 (미확인).

**리뷰 사이트**

- diagram-as-code로 AI 결과를 사후에도 편집할 수 있음, 키보드 중심 캔버스가 빠름: https://aitoolsatlas.ai/tools/eraser/pros-cons
- 한 테스트에서 "Within 5 seconds, it created a complete flowchart": https://www.reviewmytools.com/review/eraser-io-diagramgpt-review/
- GitHub 연동, Eraserbot의 private repo 기반 자동 갱신: https://toolradar.com/tools/eraser-io

## 4. 불만 (Complaints)

| 불만 | 출처 | 신뢰도 |
|---|---|---|
| 모바일에서 추가/편집이 "nearly unusable" (보기만 가능) | Product Hunt | 사용자 원문 |
| 다이어그램 종류 부족 (mind map 등) | Product Hunt, reviewmytools (Gantt/mind map 없음) | 중간 |
| 무료 플랜이 체험판 수준, 한도가 금방 참 | toolradar, reviewmytools | 2차 출처 |
| 재생성·수정마다 AI 크레딧 소모 (한 다이어그램에 3-5 크레딧) | toolradar | 2차 출처 |
| 복잡한 프롬프트는 2-3번 재시도, 레이아웃/라벨 수동 수정 필요 ("super generic") | reviewmytools | 개인 테스트 |
| 복잡한 아키텍처에서 AI 품질 편차, 외부 임베드/발표 기능 약함 | aitoolsatlas | 2차 출처 |
| 독자 문법(proprietary syntax), 픽셀 단위 제어 부족 | 검색 요약. 해당 페이지를 받아 확인했으나 이 주장 문구를 못 찾았어요: https://www.anygen.io/showcase/eraserio-review/index.html (여전히 미확인) | 낮음 |
| 비엔지니어 팀에게 학습곡선 | 검색 요약 (미확인) | 낮음 |
| 플랜 가격 예측 어려움, 시트당 비용 증가, API 별도 과금 | toolradar, 검색 요약 | 2차 출처 |
| 자유로운 브레인스토밍엔 tldraw/FigJam이 더 적합 | 검색 요약 (미확인) | 낮음 |

참고: 검색 결과 중 "Atlassian 인수" 언급(aitoolsatlas)은 **다른 곳에서 확인되지 않았어요**. 이 근거 없는 주장은 무시하세요 (미확인). Eraser의 Confluence 앱은 "Eraser for Confluence by Eraser", "Partner Supported"로 표기돼요 (재확인): https://marketplace.atlassian.com/apps/1232673 . 해당 목록 페이지에도 인수 언급은 없어요.

## 5. 자주 나오는 기능 요청 (추정 포함)

공개 feature-request 보드는 찾지 못했어요. 불만에서 역산한 요청이에요 (추정):

1. 모바일 편집
2. mind map, Gantt 등 추가 다이어그램 타입
3. AI 크레딧에 얽매이지 않는 편집 (수동 편집이 AI 한도와 무관)
4. 픽셀 수준 레이아웃 제어
5. 내보내기 후에도 편집 가능한 포맷 (reviewmytools: PNG/SVG/PDF만 언급, 편집 가능 여부 불명)

## 6. 로컬/오프라인 도구가 풀 수 있는 pain point

| Pain point | 근거 | 로컬 도구의 답 |
|---|---|---|
| **오프라인 불가** | "No offline mode; diagrams are stored in the Eraser cloud" (toolradar), "Can't use offline" (reviewmytools) | 로컬 파일 기반, 인터넷 없이 동작 |
| **데이터가 벤더 클라우드에 저장** | 위와 동일. AI 학습 미사용 주장은 있으나 보존·암호화 설명은 없다고 함 (reviewmytools) | 파일이 내 디스크에만 존재, AI는 사용자가 키/모델 선택 |
| **개인 파일·SSO는 유료 플랜** | reviewmytools | 기본이 private |
| **편집기·AI·호스팅 협업은 비공개** | "only the rendering library is open source" (https://www.eraser.io/guides/best-diagram-as-code-tools-in-2025) | 전체 오픈 |
| **AI 크레딧 과금 / 시트 과금** | toolradar | 사용자 본인 모델 호출, 시트 개념 없음 |
| **git-native** | diagram-as-code 장점으로 Git 추적·diff 언급 (일반론, Eraser 고유 아님) | 다이어그램을 repo의 텍스트 파일로, PR diff 가능 |
| **벤더 종속** | 벤더 스스로 포맷을 MIT로 공개, 단 "closed to contribution": https://www.eraser.io/blog/open-sourcing-eraser-diagrams | 열린 포맷 + 로컬 렌더러 |

- (재확인) 홈페이지 Enterprise 항목에 배포 옵션 "multi-tenant, single-tenant, or self-hosted"가 적혀 있어요: https://www.eraser.io/ . 개인 사용 가능 여부는 여전히 근거 없음 (미확인). 별개로 홈페이지의 `eraser_oss`(agent toolkit, MIT, "Self-host")는 앱 자체가 아니라 에이전트 도구 모음이에요.
- 벤더는 draw.io XML이 "designed as a GUI's save format, not a generation target: verbose, cryptic, and expensive in tokens"라고 주장해요 (원문 재확인, 벤더 관점): https://www.eraser.io/blog/open-sourcing-eraser-diagrams . 이 프로젝트가 draw.io 파일을 다루는 점과 대비되는 논점이에요 (추정).

## 7. 대안 비교에서 드러난 사용자 선택 기준

- AlternativeTo에서 Eraser 대안 1위는 draw.io (Apache-2.0, self-hosted 가능), 다음은 Excalidraw, Mermaid 등. 오픈소스+self-host가 대안 목록의 핵심 필터: https://alternativeto.net/software/eraser-io
- Eraser를 모방한 오픈소스 시도가 있음: HN의 "building something like eraser.io from excalidraw" (2024-02-01, 댓글 0, 재확인됨; 제목 원문은 "excaildraw" 오타): https://hn.algolia.com/api/v1/search?query=eraser.io&tags=story&hitsPerPage=15 , 소규모 프로젝트 Eido (미확인). 수요 신호는 약하지만 존재해요 (추정).

## 8. 시사점 (추정)

1. **차별점 후보:** 오프라인 + git-native 텍스트 파일 + 로컬 AI(또는 BYO key). 이 셋은 Eraser가 구조적으로 못 주는 영역이에요.
2. **베끼지 말 것:** 엔터프라이즈 맵 갤러리 (CMDB 연동 등). 개인/팀 개발 문서 용도가 맞아요.
3. **보강할 것:** 수동 편집이 일급이어야 해요. AI 재생성 한도에 대한 불만이 반복되기 때문이에요.
4. **리스크:** 직접 사용자 원문 증거가 얇아서 위 pain point 순위는 가설이에요. 실제 사용자 인터뷰나 Reddit/HN 직접 열람으로 검증이 필요해요.
