# 05. Eraser.io 인터랙션 카탈로그 (구현 체크리스트)

조사일: 2026-11-12. 공개 문서만 사용 (로그인·가입 없음).

## 0. 먼저 읽기: 근거의 한계

- **Eraser는 통합 단축키 표를 현재 docs에 공개하지 않아요.** 기능별 페이지에 흩어져 있어요. (docs 네비게이션: https://docs.eraser.io/)
- 옛 help 페이지 `help.eraser.io/keyboard-shortcuts-and-markdown-syntax/`에 전체 표가 있었다고 검색 결과에 나오지만, 이 환경에서 호스트가 열리지 않았고 내용은 약 5년 전 기준이에요. 아래 "구 help 표" 항목은 **검색 요약만 본 2차 정보**예요 (미확인).
- 재확인 (2026-11-12): `help.eraser.io` 호스트는 여전히 연결 안 되고, web.archive.org 사본과 `docs.eraser.io/docs/keyboard-shortcuts` 등 추정 URL은 404예요. 단축키 항목은 상태 그대로예요.
- Eraser에 없는 부분은 임의로 채우지 않았어요. 대신 "구현 제안" 열에 일반 관례(Excalidraw/tldraw/draw.io 류) 기반 값을 (추정)으로 적었어요.
- 표기: ✅ 공식 docs 확인 / 🟡 2차 정보 / ❓ 미확인 / 💡 (추정) 구현 제안.

범위 밖 (01~03 담당): 제품 모델, DSL 문법, 가격, 스택.

---

## 1. 전역 / 파일 수준 단축키

| 동작 | Mac / Win | 상태 | 출처 |
|---|---|---|---|
| 새 파일 (대시보드) | `^ N` | ✅ (표기 그대로; Mac `Ctrl+N`으로 읽힘) | https://docs.eraser.io/quickstart.md |
| Export 대화상자 열기 | `⌘/Ctrl + E` | ✅ | https://docs.eraser.io/export.md |
| 선택한 diagram을 PNG로 복사 | `Shift + Alt + C` | ✅ | https://docs.eraser.io/export.md |
| 열린 파일 Archive | `⌘/Ctrl + Shift + E` | 🟡 (검색 요약; 직접 확인 못 함) | https://docs.eraser.io/deleting-files |
| 댓글 전체 표시 토글 | `Ctrl/Alt + C` (표기 그대로) | ✅ | https://docs.eraser.io/comments.md |
| AI Diagram 프롬프트 열기 | `⌘/Ctrl + J` | ✅ | https://docs.eraser.io/ai-diagrams.md |
| Command palette (`⌘K` 등) | - | ❓ 공개 docs에서 못 찾음 | - |
| 단축키 도움말 (`?`) | - | ❓ | - |

구현 제안 💡: 전역 `⌘/Ctrl+K` palette, `?` 도움말, `⌘/Ctrl+S` 저장(로컬 도구면 자동 저장 + 수동 스냅샷).

## 2. 캔버스 단축키

| 동작 | 키 | 상태 | 출처 |
|---|---|---|---|
| Insert menu 열기 | `/` | ✅ | https://docs.eraser.io/insert-menu |
| Insert menu 필터 | 타이핑 (예: `ec2`) | ✅ | 〃 |
| Insert menu 항목 선택 | `Return` | ✅ | 〃 |
| Figure 도구 | `F` | ✅ | https://docs.eraser.io/figures.md |
| Comment 도구 | `C` | ✅ | https://docs.eraser.io/comments.md |
| 선택 요소에 댓글 | `⌘/Ctrl + Shift + M` | ✅ | 〃 |
| 댓글 등록 | `⌘/Ctrl + Return` | ✅ | 〃 |
| 댓글 thread resolve | `Option/Alt + R` | ✅ | 〃 |
| 댓글 thread 삭제 | `Option/Alt + D` | ✅ | 〃 |
| Selection 도구 | `V` 또는 `1` | 🟡 구 help 표 | 검색 요약 |
| Rectangle | `R` 또는 `2` | 🟡 | 〃 |
| Diamond | `D` | 🟡 | 〃 |
| Ellipse | `E` | 🟡 | 〃 |
| Arrow | `A` 또는 `5` | 🟡 | 〃 |
| Line | `L` | 🟡 | 〃 |
| Free draw | `P` | 🟡 | 〃 |
| Text | `T` | 🟡 | 〃 |

주의: `E`(Ellipse)와 `⌘E`(Export), `C`(Comment)와 `Shift+Alt+C`(Copy PNG)처럼 키가 겹치지 않게 modifier로 구분해요 (추정).

미확인 (❓): Delete/Backspace, Select All, Duplicate (`⌘D`/Alt+drag), Group/Ungroup, Z-order, Nudge(방향키), Zoom (`+ − 0 1`), Fit, Pan (Space+drag), 정렬/분배 단축키, Lock. 모두 공개 docs에 없어요.

구현 제안 💡 (관례 기반):

| 동작 | 제안 키 |
|---|---|
| Undo / Redo | `⌘/Ctrl+Z` / `⌘/Ctrl+Shift+Z`, Win은 `Ctrl+Y`도 |
| Select all | `⌘/Ctrl+A` |
| Duplicate | `⌘/Ctrl+D`, Alt+drag |
| Group / Ungroup | `⌘/Ctrl+G` / `⌘/Ctrl+Shift+G` |
| Delete | `Delete` / `Backspace` |
| Nudge | 방향키 1px, `Shift`+방향키 10px |
| Zoom | `⌘/Ctrl +`/`-`/`0`, `Shift+1` fit |
| Pan | `Space`+drag, 중간 버튼 drag |
| 취소 / 도구 해제 | `Esc` |

## 3. Document(노트 에디터) 단축키

| 동작 | 키 | 상태 | 출처 |
|---|---|---|---|
| H1 헤더 | `⌘⌥1` / `Ctrl+Alt+1`, 또는 `# `+space | ✅ (레벨 1만 명시) | https://docs.eraser.io/headers.md |
| 표 만들기 | `⌘⌥T` / `Ctrl+Alt+T` | ✅ | https://docs.eraser.io/tables.md |
| 행 추가 (커서 뒤) | `⌘/Ctrl + Shift + +` | ✅ | 〃 |
| 열 추가 (커서 뒤) | `⌘/Ctrl + Shift + Alt/Option + +` | ✅ | 〃 |
| Wikilink 드롭다운 | `+` (줄 첫 글자 또는 공백 뒤) | ✅ | https://docs.eraser.io/wikilink.md |
| 드롭다운 이동 / 선택 | `↑` `↓` / `Return` | ✅ | 〃 |
| 텍스트에 댓글 | `⌘/Ctrl + Shift + M` | ✅ | https://docs.eraser.io/comments.md |
| Bold 등 서식 (`⌘B`…) | - | 🟡 구 help 표에 있다고만 확인 | 검색 요약 |
| 하단 포맷 바 `+` 버튼 → Table | 클릭 | ✅ | tables.md |
| 표: 좌측/상단 hover `+` | hover | ✅ | 〃 |
| 표: 셀 우클릭 → Row → Add row before/after | 컨텍스트 메뉴 | ✅ | 〃 |

헤더 H2~H6 키, 목록/체크리스트 단축키 (❓). 구현 제안 💡: Markdown 입력 규칙(`#`, `-`, `1.`, `[]`, ``` ``` ```)과 `⌘B/I/K`.

## 4. Diagram-as-code 에디터

공개 docs에서 에디터 단축키·팔레트 항목은 **발견 못 함** (❓). 확인된 동작만:

| 동작 | 상태 | 출처 |
|---|---|---|
| 코드 편집 시 캔버스가 타이핑 중 실시간 갱신 | ✅ | https://docs.eraser.io/quickstart.md |
| 아이콘 자동 첨부 문법 `[icon: name]` | ✅ | 〃 |
| 코드의 "significant edit" 시 수동 드래그 레이아웃이 reset | ✅ (기준 미정의) | https://docs.eraser.io/draggable-edits-beta |
| 하단 배너 "Reset Layout" 버튼 | ✅ | 〃 |
| VS Code 확장: `.eraserdiagram` 파일, 기본 미리보기, Edit 아이콘으로 코드 에디터 | ✅ (command palette 항목 없음) | https://docs.eraser.io/using-the-vs-code-extension.md |
| 첫 줄 타입 키워드 `flow-chart` 등 4종 | ✅ | 〃 |

구현 제안 💡: CodeMirror/Monaco 기본 키 (`⌘/`, `⌘F`, `⌘Z`), 에러 라인 표시, 노드 클릭 ↔ 코드 라인 하이라이트 (Eraser 동작 여부 ❓).

## 5. 마우스 / 트랙패드

| 제스처 | 상태 | 출처 / 비고 |
|---|---|---|
| 요소 클릭 = 선택 (diagram 전체 클릭 → diagram 선택, 노드/그룹/화살표 클릭 → 요소 선택) | ✅ | draggable-edits-beta |
| 선택 시 하단 "draggable edit" 배너 표시 | ✅ | 〃 |
| 노드 드래그 이동 / 리사이즈 | ✅ | 〃 |
| Figure 이름 더블클릭 = 이름 편집 | ✅ | figures.md |
| Figure 이름 드래그 = figure 이동 | ✅ | 〃 |
| 요소를 figure 안/밖으로 드래그 = 추가/제거 | ✅ | 〃 |
| Figure 리사이즈로 포함 요소 변경 | ✅ | 〃 |
| Wikilink 클릭 = 파일 열기 / figure·header로 이동 | ✅ | wikilink.md |
| Figure embed 링크 클릭 = 캔버스를 figure로 이동 | ✅ | https://docs.eraser.io/figure-embeds |
| Divider 중앙 핸들 드래그 = 곡선 | ✅ (freeform) | https://docs.eraser.io/freeform-diagrams |
| Pan / Zoom (휠, 핀치, Space+drag) | ❓ | - |
| Marquee 선택 | ❓ (Figure 도구는 영역 드래그로 감싸기 ✅) | figures.md |

구현 제안 💡: 휠=세로 pan, `⌘/Ctrl`+휠 또는 핀치=zoom, `Shift`+휠=가로 pan, 중간 버튼 drag=pan, 빈 곳 drag=marquee.

## 6. 선택 / 다중 선택

| 항목 | 상태 |
|---|---|
| 단일 선택, diagram vs 요소 2단계 선택 | ✅ (위 §5) |
| Shift+클릭 추가 선택, marquee, Select all | ❓ 공개 docs에 없음 |
| 선택 요소 일부만 Export ("Export selection") | ✅ export.md |
| 선택 요소를 우클릭 → "Create Figure" | ✅ figures.md |
| 일부 connection만 선택해 Connector style 변경 | ✅ https://docs.eraser.io/styling.md |

구현 제안 💡: `Shift`/`⌘`+클릭 토글, marquee는 완전 포함 기준(Excalidraw식) 또는 교차 기준 중 택1, 선택 박스 핸들 8개 + 회전.

## 7. Connector 생성 / 라우팅

| 항목 | 상태 | 출처 |
|---|---|---|
| 라우팅 3종: elbow / straight / arc | ✅ | freeform-diagrams, styling.md |
| Property bar에서 arrowhead·routing 설정 (freeform), "Connector style" (코드 diagram) | ✅ | 〃 |
| 코드: diagram 단위 `connectorStyle straight`(이후 정의 connection에 적용), connection 단위 `A > B: [connectorStyle: arc]` | ✅ | styling.md |
| 항상 elbow인 경우: self-connection, 노드↔소속 group, 같은 두 노드 간 다중 connection | ✅ | 〃 |
| Connector 스타일은 cloud architecture / flow chart에만 적용 | ✅ | 〃 |
| Arrow 도구 (`A`) 로 freeform에서 연결선 그리기 | 🟡 (구 help 표) | - |
| 연결 포인트(anchor) 스냅, 끝점 재연결 드래그, 라우팅 waypoint 편집 | ❓ | - |
| 코드 diagram에서 화살표 드래그 이동 | ✅ 선택 가능 (draggable-edits-beta: "arrow" 클릭 선택). 이동 시 라우팅 동작은 ❓ | - |

구현 제안 💡: 노드 hover 시 4방향 포트 표시 → 포트 드래그로 생성, 대상 노드 윤곽 강조 후 drop, 끝점 핸들로 재연결, 노드 이동 시 elbow 자동 재라우팅, 노드 사이 빈 곳에 drop하면 새 노드 생성 메뉴 (이건 일반 관례, Eraser 동작 ❓).

## 8. Snapping / 정렬 가이드

공개 docs에 **snapping, smart guides, grid, 정렬/분배 도구 언급 없음** (freeform-diagrams.md에서도 "not covered" 확인). 전부 ❓.

구현 제안 💡: 가장자리/중심선 smart guide + 등간격 표시, 임계 약 5~8px(screen 기준), 스냅 일시 해제 modifier (`Alt` 또는 `⌘/Ctrl`), 선택 시 정렬 6종(좌/중/우/상/중/하) + 분배 2종 버튼. 관례 비교: draw.io는 Alt로 스냅 해제 (https://www.drawio.com/docs/manual/editor/alignment-tools/).

## 9. 컨텍스트 메뉴 (우클릭)

| 대상 | 항목 | 상태 | 출처 |
|---|---|---|---|
| 선택 요소들 | Create Figure | ✅ | figures.md |
| 표 셀 | Row → Add a row after / before | ✅ | tables.md |
| 댓글 | 3-dot menu: Resolve Thread / Delete Thread | ✅ | comments.md |
| diagram toolbar `…` | Copy as PNG, Copy as SVG, Copy Markdown embed, Copy HTML embed, Copy link to elements, Copy as XML/JSON (freeform만), Export selection, Convert to freeform | ✅ | export.md, freeform-diagrams |
| 캔버스 빈 곳 / 노드 일반 우클릭 전체 목록 | ❓ | - |
| 파일 헤더 `…` | Export, Version history | ✅ | export.md, version-history.md |
| 피드백 스레드: "Copy to clipboard as PNG"가 우클릭에도 있다는 언급 | 🟡 | https://feedback.eraser.io/feature-requests/p/export-png-to-clipboard |

## 10. Copy / Paste / Drop

| 동작 | 캔버스 | 문서 | 출처 |
|---|---|---|---|
| 이미지 (PNG/JPEG/GIF/SVG) | ✅ 이미지로 삽입 | ✅ 삽입 (WebP 등도 가능) | https://docs.eraser.io/import.md |
| WebP | ✅ 지원 안 함 | ✅ 지원 | 〃 |
| `.drawio` 파일 | ✅ drop 시 편집 가능 diagram으로 변환 | - | 〃 |
| `.eraserdiagram` 파일 | ✅ drop 가능 | - | freeform-diagrams |
| Eraser 다른 파일에서 복사한 요소/diagram | ✅ 그대로 삽입 | - | import.md |
| Freeform JSON / XML 텍스트 | ✅ 붙여넣기로 diagram 생성 | - | freeform-diagrams |
| Markdown 텍스트 | - | ✅ 서식 콘텐츠로 변환 | import.md |
| Rich text / HTML | - | ✅ 서식 유지 | 〃 |
| 코드 텍스트 붙여넣기 → 자동 code block / diagram 인식 | ❓ | ❓ | - |
| 캔버스의 figure 복사 → 노트 에디터에 붙여넣기 = live figure embed | ✅ | ✅ | figures.md, figure-embeds |
| Figure embed: 펼침(live preview) / 접힘(일반 링크) | - | ✅ | figure-embeds |
| Figure embed 링크 텍스트는 figure 이름이 기본, 아이콘 클릭 모달에서 수정/리셋 | - | ✅ | 〃 |
| Diagram 복사: Copy as JSON/XML → 다른 캔버스에 붙여넣기 | ✅ | - | freeform-diagrams |
| AI 프롬프트에 파일 drag&drop 첨부, 빈 프롬프트에서 `/` → Image/File | ✅ (AI 입력창) | - | ai-diagrams.md |
| 이미지를 AI sidebar `+`로 업로드 (png, jpeg) | ✅ | - | https://docs.eraser.io/image-import |

관찰 (추정): 이 표는 "붙여넣기 대상 컨텍스트(canvas vs document)마다 허용 포맷이 다르다"가 핵심 설계예요. 구현 시 paste handler를 컨텍스트별로 분리하세요.

## 11. 문서 ↔ 캔버스 드래그

- 공식 docs에서 **document와 canvas 사이 drag&drop은 설명되지 않아요** (figures.md 확인). ❓
- 확인된 연결 방식은 **copy → paste**(figure → 문서 embed)와 **wikilink**(`+`)예요.
- 구현 제안 💡: 캔버스 figure를 문서로 drag하면 embed 생성 (paste와 동일 동작). 문서의 header를 캔버스로 drag하는 동작은 필요 시 별도 결정.

## 12. Undo / Redo

공개 docs에 undo/redo 언급 없음 (freeform-diagrams.md 확인) ❓.

구현 제안 💡 (체크리스트):

- [ ] 캔버스 변경은 operation 단위 history stack (드래그 1회 = 1 step)
- [ ] 코드 편집(텍스트)과 캔버스 드래그 편집은 history가 얽히므로 규칙 필요: 코드 편집이 수동 레이아웃을 reset하면 undo로 복원 가능하게 (Eraser의 reset 동작은 https://docs.eraser.io/draggable-edits-beta)
- [ ] Version history와 별개: Eraser 버전 이력은 Save version / Preview / Restore(현재 상태가 새 버전으로 저장) / Duplicate (https://docs.eraser.io/version-history.md)

## 13. Command palette

공개 docs·검색에서 Eraser의 command palette (`⌘K`) **확인 못 함** (❓). 가장 가까운 것은 `/` insert menu예요.

Insert menu 항목 (✅ https://docs.eraser.io/insert-menu):

| 항목 | 설명 |
|---|---|
| Figure | 캔버스 정리용 컨테이너 |
| Diagram-as-code | DSL diagram 또는 freeform (AI Diagram, Freeform 포함) |
| Shape | cylinder, diamond 등 |
| Icon | simple / tech logo / cloud |
| Code Block | 구문 강조 |
| Image | 컴퓨터에서 업로드 |
| Device Frame | 와이어프레임용 |

구현 제안 💡: `/`와 `⌘K`를 분리. `/` = 삽입 전용(필터링 + Return), `⌘K` = 모든 커맨드(Export, Version history, Toggle comments, Theme, Convert to freeform, Reset Layout…).

## 14. 구현 체크리스트 (우선순위)

P0 (Eraser에서 확인됨, 그대로 구현):
- [ ] `/` insert menu + 필터 + Return
- [ ] `F` figure 도구, 이름 더블클릭 편집, 이름 드래그 이동, 안/밖 드래그로 소속 변경
- [ ] diagram 클릭 → 요소 클릭 2단계 선택, 드래그 이동/리사이즈, Reset Layout
- [ ] Connector 3종 (elbow/straight/arc) + 강제 elbow 규칙
- [ ] 캔버스 paste/drop 포맷 (이미지 4종, .drawio, JSON/XML, 내부 요소)
- [ ] figure → 문서 paste = live embed (펼침/접힘)
- [ ] `⌘/Ctrl+E` Export, `Shift+Alt+C` Copy PNG
- [ ] 댓글 (`C`, `⌘/Ctrl+Shift+M`, `⌘/Ctrl+Return`, `Alt+R/D`)

P1 (확인 안 됨, 관례로 구현):
- [ ] Undo/Redo, Select all, Delete, Duplicate, Group, Nudge
- [ ] Pan/Zoom, marquee, Shift 다중 선택
- [ ] Snapping / smart guide / 정렬·분배
- [ ] Command palette `⌘K`
- [ ] 문서↔캔버스 drag

P2: 코드 에디터 ↔ 캔버스 하이라이트 연동, 연결 포트 UI, 라우팅 waypoint 편집.

## 15. 다음 확인 거리 (이 조사에서 못 한 것)

1. 구 help 표 원문 (`help.eraser.io` 호스트가 열리지 않음). 앱 내 `?` 도움말을 직접 보는 것이 가장 정확해요 (로그인 필요라 이번엔 안 함).
2. 캔버스 우클릭 메뉴 전체, snapping 동작, 연결 anchor 동작은 앱 실사용으로만 확인 가능해요.
