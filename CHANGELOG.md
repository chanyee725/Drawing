# Changelog

이 파일은 사용자가 체감하는 변화를 적어요. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 를 따라요.

## [Unreleased]

### Changed

- 프로젝트 방향을 draw.io 라이브 뷰어에서 Eraser 같은 로컬 다이어그램 도구로 바꿨어요.
- `npm start -- <workspace-dir>` 로 작업 폴더를 지정해요. 빈 화면(사이드바, 상단 바, 캔버스 영역)이 열려요. (E0)
- 작업 폴더 안의 파일(`*.dpx.json`)과 폴더를 만들고 읽고 저장하고 옮기고 지우는 서버 API를 추가했어요. 오래된 revision으로 저장하면 거절하고, 밖에서 바뀐 파일은 알려줘요. (E1)

### Removed

- draw.io 파일 감시, 변경 기록, Dispatch 에이전트 피드, 라이브 커서와 draw.io 뷰어를 없앴어요. git 기록에 남아 있어요.

### Notes

- 실행 전에 `npm run build` 가 필요해요. 빌드 없이 실행하면 페이지 대신 안내 메시지가 나와요.
