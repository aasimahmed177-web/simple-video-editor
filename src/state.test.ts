import {describe, expect, it} from "vitest";
import {hideElement, mergeLayout, resetElement} from "./state";
import type {EditorState} from "./types";
import {sceneAtFrame} from "./editor-config";
const empty = (): EditorState => ({elementLayout:{},textOverrides:{},colorOverrides:{},assetOverrides:{},hiddenElements:{}});
describe("editor state", () => {
  it("merges layout changes without changing the input", () => {
    const state=empty(); const next=mergeLayout(state,"title",{x:42,opacity:0.5});
    expect(next.elementLayout.title).toEqual({x:42,y:0,scale:1,rotate:0,opacity:0.5});
    expect(state.elementLayout.title).toBeUndefined();
  });
  it("hides and restores an element", () => {
    const hidden=hideElement(empty(),"card",true); expect(hidden.hiddenElements.card).toBe(true);
    expect(hideElement(hidden,"card",false).hiddenElements.card).toBe(false);
  });
  it("resets every override for one element", () => {
    const state: EditorState={elementLayout:{title:{x:1,y:2,scale:1,rotate:0,opacity:1}},textOverrides:{title:"Changed"},colorOverrides:{title:"#ffffff"},assetOverrides:{title:"/uploads/title.png"},hiddenElements:{title:true}};
    expect(resetElement(state,"title")).toEqual(empty());
  });
  it("resolves public scene metadata at frame boundaries",()=>{
    expect(sceneAtFrame(79)?.id).toBe("scene-1");
    expect(sceneAtFrame(80)?.id).toBe("scene-2");
    expect(sceneAtFrame(239)?.id).toBe("scene-3");
    expect(sceneAtFrame(240)).toBeUndefined();
  });
});
