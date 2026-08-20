import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame} from "remotion";
import type {EditorState} from "./types";
import {Editable} from "./editor/Editable";

export type DemoProps = {editorState: EditorState; editMode?: boolean; onElementDown?:(id:string,label:string,kind:string,x:number,y:number)=>void; onElementMove?:(x:number,y:number)=>void; onElementUp?:()=>void};

export const DemoComposition: React.FC<DemoProps> = ({editorState, editMode=false,onElementDown,onElementMove,onElementUp}) => {
  const frame=useCurrentFrame();
  const handlers={onPointerDown:onElementDown,onPointerMove:onElementMove,onPointerUp:onElementUp};
  return <AbsoluteFill style={{backgroundColor:"#eef1ff",fontFamily:"Arial, sans-serif",overflow:"hidden"}}>
    <Editable {...handlers} id="orb" label="Blue circle" state={editorState} editMode={editMode} kind="color" defaultColor="#5367ff">
      {({color})=><div style={{position:"absolute",width:700,height:700,borderRadius:"50%",backgroundColor:color,left:190,top:210,scale:interpolate(frame,[0,30],[0.86,1],{easing:Easing.bezier(0.16,1,0.3,1),extrapolateLeft:"clamp",extrapolateRight:"clamp"})}}/>}
    </Editable>
    <Editable {...handlers} id="demo-image" label="Demo image" state={editorState} editMode={editMode} kind="image" defaultAsset={staticFile("demo-grid.svg")}>
      {({asset})=><Img src={asset} style={{position:"absolute",left:120,top:360,width:840,height:560,objectFit:"cover",borderRadius:52,boxShadow:"0 30px 80px rgba(31,36,80,.22)"}}/>}
    </Editable>
    <Editable {...handlers} id="title" label="Main title" state={editorState} editMode={editMode} kind="text" defaultText="Edit videos without touching a timeline" defaultColor="#17182d">
      {({text,color})=><div style={{position:"absolute",left:96,right:96,top:1020,color,fontSize:106,lineHeight:0.96,fontWeight:800,letterSpacing:-5}}>{text}</div>}
    </Editable>
    <Editable {...handlers} id="subtitle" label="Subtitle" state={editorState} editMode={editMode} kind="text" defaultText="Move, resize, recolor, replace, comment, and render with Remotion." defaultColor="#555a78">
      {({text,color})=><div style={{position:"absolute",left:100,right:100,top:1390,color,fontSize:48,lineHeight:1.25,fontWeight:500}}>{text}</div>}
    </Editable>
    <Editable {...handlers} id="badge" label="Status badge" state={editorState} editMode={editMode} kind="text" defaultText="LOCAL FIRST" defaultColor="#ffffff">
      {({text,color})=><div style={{position:"absolute",left:100,top:1650,padding:"22px 32px",borderRadius:999,backgroundColor:"#17182d",color,fontSize:32,fontWeight:800,letterSpacing:4}}>{text}</div>}
    </Editable>
  </AbsoluteFill>;
};
