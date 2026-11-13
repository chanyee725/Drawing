// Why a block cannot be laid out by hand or turned into shapes, as text: the code side (layoutSession) and the
// canvas side (layoutEdit) in one place, so both read the same for an action. No imports, so it runs under `node --test`.

export type EditReasonCode = 'kind' | 'errors' | 'version' | 'empty';
/** What the user is trying to do; the wording of a reason follows it. */
export type EditAction = 'move' | 'freeform';

const REASON_TEXT: Record<EditAction, Record<EditReasonCode, string>> = {
  move: {
    kind: '이 종류는 아직 노드를 옮길 수 없어요',
    errors: '코드 오류를 고치면 옮길 수 있어요',
    version: '새 버전에서 만든 배치라 여기서는 고칠 수 없어요',
    empty: '옮길 노드가 없어요',
  },
  freeform: {
    kind: '이 블록은 자유 도형으로 바꿀 수 없어요',
    errors: '코드 오류를 고치면 자유 도형으로 바꿀 수 있어요',
    version: '새 버전에서 만든 배치라 여기서는 바꿀 수 없어요',
    empty: '바꿀 노드가 없어요',
  },
};

export const reasonText = (code: EditReasonCode, action: EditAction = 'move') => REASON_TEXT[action][code];

export type ImageReasonCode = 'locked' | 'rotated' | 'cropped';

export const IMAGE_TEXT: Record<EditAction, Record<ImageReasonCode, string>> = {
  move: {
    locked: '잠긴 블록은 옮길 수 없어요',
    rotated: '돌린 블록은 옮길 수 없어요',
    cropped: '자른 블록은 옮길 수 없어요',
  },
  freeform: {
    locked: '잠긴 블록은 자유 도형으로 바꿀 수 없어요',
    rotated: '돌린 블록은 자유 도형으로 바꿀 수 없어요. 회전을 풀고 다시 해 주세요',
    cropped: '자른 블록은 자유 도형으로 바꿀 수 없어요. 자르기를 풀고 다시 해 주세요',
  },
};
