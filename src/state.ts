import type {EditorState, ElementLayout} from "./types";
import {DEFAULT_LAYOUT} from "./types";

export const mergeLayout = (state: EditorState, id: string, patch: Partial<ElementLayout>): EditorState => ({
  ...state,
  elementLayout: {...state.elementLayout, [id]: {...DEFAULT_LAYOUT, ...state.elementLayout[id], ...patch}},
});
export const hideElement = (state: EditorState, id: string, hidden: boolean): EditorState => ({
  ...state, hiddenElements: {...state.hiddenElements, [id]: hidden},
});
export const resetElement = (state: EditorState, id: string): EditorState => {
  const next = structuredClone(state);
  delete next.elementLayout[id]; delete next.textOverrides[id]; delete next.colorOverrides[id];
  delete next.assetOverrides[id]; delete next.hiddenElements[id];
  return next;
};
