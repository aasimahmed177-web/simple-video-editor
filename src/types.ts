export type ElementLayout = {x: number; y: number; scale: number; rotate: number; opacity: number};
export type EditorState = {
  elementLayout: Record<string, ElementLayout>;
  textOverrides: Record<string, string>;
  colorOverrides: Record<string, string>;
  assetOverrides: Record<string, string>;
  hiddenElements: Record<string, boolean>;
};
export type ReviewComment = {id:string;frame:number;timeSeconds?:number;xPercent:number;yPercent:number;text:string;elementId?:string;elementLabel?:string;sceneId?:string;sceneLabel?:string};
export const DEFAULT_LAYOUT: ElementLayout = {x: 0, y: 0, scale: 1, rotate: 0, opacity: 1};
