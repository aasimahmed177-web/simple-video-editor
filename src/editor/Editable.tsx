import React from "react";
import {DEFAULT_LAYOUT, type EditorState} from "../types";

type RenderValues={text:string;color:string;asset:string};
type Props={
  id:string; label:string; state:EditorState; editMode:boolean; kind:"text"|"color"|"image";
  defaultText?:string; defaultColor?:string; defaultAsset?:string;
  children:(values:RenderValues)=>React.ReactNode;
  onPointerDown?:(id:string,label:string,kind:string,x:number,y:number)=>void;
  onPointerMove?:(x:number,y:number)=>void;
  onPointerUp?:()=>void;
};
export const Editable:React.FC<Props>=({id,label,state,editMode,kind,defaultText="",defaultColor="#000000",defaultAsset="",children,onPointerDown,onPointerMove,onPointerUp})=>{
  const lastPress=React.useRef<{time:number;x:number;y:number}|null>(null);
  if(state.hiddenElements[id]) return null;
  const layout={...DEFAULT_LAYOUT,...state.elementLayout[id]};
  const rendered=children({text:state.textOverrides[id]??defaultText,color:state.colorOverrides[id]??defaultColor,asset:state.assetOverrides[id]??defaultAsset});
  const events={onPointerDown:(event:React.PointerEvent)=>{if(!editMode)return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);onPointerDown?.(id,label,kind,event.clientX,event.clientY);window.dispatchEvent(new CustomEvent("simple-editor-select",{detail:{id,label,kind,x:event.clientX,y:event.clientY}}));const previous=lastPress.current;const now=performance.now();if(previous&&now-previous.time<420&&Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<18)window.dispatchEvent(new CustomEvent("simple-editor-open",{detail:{id,label,kind,x:event.clientX,y:event.clientY}}));lastPress.current={time:now,x:event.clientX,y:event.clientY};},onPointerMove:(event:React.PointerEvent)=>{if(event.currentTarget.hasPointerCapture(event.pointerId)){onPointerMove?.(event.clientX,event.clientY);window.dispatchEvent(new CustomEvent("simple-editor-move",{detail:{x:event.clientX,y:event.clientY}}));}},onPointerUp:(event:React.PointerEvent)=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);onPointerUp?.();window.dispatchEvent(new CustomEvent("simple-editor-up"));}};
  return <div data-editable-id={id} data-editable-label={label} data-editable-kind={kind} style={{position:"absolute",inset:0,pointerEvents:"none",translate:`${layout.x}px ${layout.y}px`,scale:layout.scale,rotate:`${layout.rotate}deg`,opacity:layout.opacity}}>
    {React.isValidElement<{style?:React.CSSProperties;draggable?:boolean;onDragStart?:(event:React.DragEvent)=>void}>(rendered)?React.cloneElement(rendered,{...events,draggable:false,onDragStart:(event:React.DragEvent)=>event.preventDefault(),style:{...rendered.props.style,pointerEvents:editMode?"auto":"none",cursor:editMode?"grab":undefined,touchAction:"none",userSelect:"none",outline:editMode?"3px dashed rgba(83,103,255,.7)":undefined,outlineOffset:-3}}):rendered}
  </div>;
};
