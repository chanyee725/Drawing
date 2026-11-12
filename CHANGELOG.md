# Changelog

이 파일은 사용자가 체감하는 변화를 적어요. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 를 따라요.

## [Unreleased]

### Added

- draw.io 파일 감시와 변경 기록: 파일이 바뀌면 셀 단위로 비교해서 추가, 삭제, 이동, 글자, 스타일 변경을 기록해요. (T2)
- 다이어그램 보기: draw.io 공식 뷰어로 페이지를 그리고, 바뀐 셀을 색으로 잠깐 표시해요. (T3)
- Dispatch 에이전트 피드(서버): 세션을 워크트리 폴더에 연결하고 파일 변경을 에이전트에 귀속해요. 읽기 전용이에요. 화면 표시는 아직 없어요. (T4)
- 서드파티 고지: 뷰어에 포함된 서드파티 코드 목록을 `web/static/vendor/drawio/THIRD_PARTY.md` 에 적었어요.
- 한국어 README 와 실행 방법을 추가했어요.

### Notes

- 실행 전에 `npm run build` 가 필요해요. 빌드 없이 실행하면 페이지 대신 안내 메시지가 나와요.

<!-- TODO(T5): 라이브 커서와 에이전트 활동 패널이 생기면 Added 에 추가. -->
<!-- TODO(T6): 변경 기록 타임라인과 되감기가 생기면 Added 에 추가. -->
