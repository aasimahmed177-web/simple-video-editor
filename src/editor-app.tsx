import React,{useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {Player,type PlayerRef} from "@remotion/player";
import {DemoComposition} from "./Composition";
import initialState from "./editor-state.json";
import type {EditorState,ReviewComment} from "./types";
import {DEFAULT_LAYOUT} from "./types";
import {hideElement,mergeLayout,resetElement} from "./state";
import "./index.css";

const api=async<T,>(path:string,body?:unknown):Promise<T>=>{
  const response=await fetch(path,body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:undefined);
  if(!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
};

const App:React.FC=()=>{
  const player=useRef<PlayerRef>(null); const canvas=useRef<HTMLDivElement>(null);
  const [state,setState]=useState<EditorState>(initialState); const [history,setHistory]=useState<EditorState[]>([]);
  const [selected,setSelected]=useState<string>(); const [label,setLabel]=useState(""); const [kind,setKind]=useState("");
  const [frame,setFrame]=useState(0); const [comments,setComments]=useState<ReviewComment[]>([]); const [comment,setComment]=useState("");
  const [status,setStatus]=useState("Saved locally"); const drag=useRef<{id:string;x:number;y:number;startX:number;startY:number;moved:boolean}|null>(null);
  useEffect(()=>{void api<ReviewComment[]>("/api/comments").then(setComments);},[]);
  useEffect(()=>{const current=player.current;if(!current)return;const update=(event:{detail:{frame:number}})=>setFrame(event.detail.frame);current.addEventListener("frameupdate",update);return()=>current.removeEventListener("frameupdate",update);},[]);
  useEffect(()=>{const down=(event:Event)=>{const detail=(event as CustomEvent<{id:string;label:string;kind:string;x:number;y:number}>).detail;pointerDown(detail.id,detail.label,detail.kind,detail.x,detail.y);};const move=(event:Event)=>{const detail=(event as CustomEvent<{x:number;y:number}>).detail;pointerMove(detail.x,detail.y);};const up=()=>pointerUp();window.addEventListener("simple-editor-select",down);window.addEventListener("simple-editor-move",move);window.addEventListener("simple-editor-up",up);return()=>{window.removeEventListener("simple-editor-select",down);window.removeEventListener("simple-editor-move",move);window.removeEventListener("simple-editor-up",up);};});
  const commit=async(next:EditorState)=>{setHistory((items)=>[...items.slice(-29),state]);setState(next);setStatus("Saving...");await api("/api/state",next);setStatus("Saved locally");};
  const update=(patch:Parameters<typeof mergeLayout>[2])=>selected&&void commit(mergeLayout(state,selected,patch));
  const layout=selected?{...DEFAULT_LAYOUT,...state.elementLayout[selected]}:DEFAULT_LAYOUT;
  const pointerDown=(id:string,nextLabel:string,nextKind:string,x:number,y:number)=>{setSelected(id);setLabel(nextLabel);setKind(nextKind);const current={...DEFAULT_LAYOUT,...state.elementLayout[id]};drag.current={id,x,y,startX:current.x,startY:current.y,moved:false};};
  const pointerMove=(x:number,y:number)=>{if(!drag.current||!canvas.current)return;drag.current.moved=true;const scale=canvas.current.getBoundingClientRect().width/1080;setState((current)=>mergeLayout(current,drag.current!.id,{x:Math.round(drag.current!.startX+(x-drag.current!.x)/scale),y:Math.round(drag.current!.startY+(y-drag.current!.y)/scale)}));};
  const pointerUp=()=>{if(!drag.current)return;const moved=drag.current.moved;drag.current=null;if(moved){void api("/api/state",state);setStatus("Saved locally");}};
  const undo=()=>{const previous=history.at(-1);if(!previous)return;setHistory((items)=>items.slice(0,-1));setState(previous);void api("/api/state",previous);};
  const upload=async(file:File)=>{if(!selected)return;const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});const result=await api<{path:string}>("/api/upload",{id:selected,name:file.name,dataUrl});await commit({...state,assetOverrides:{...state.assetOverrides,[selected]:result.path}});};
  const addComment=async()=>{if(!comment.trim())return;const item:ReviewComment={id:crypto.randomUUID(),frame,xPercent:50,yPercent:50,text:comment.trim(),...(selected?{elementId:selected}:{})};const next=await api<ReviewComment[]>("/api/comments",{action:"add",comment:item});setComments(next);setComment("");};
  const removeComment=async(id:string)=>setComments(await api<ReviewComment[]>("/api/comments",{action:"delete",id}));
  return <main style={{height:"100vh",display:"grid",gridTemplateRows:"64px 1fr",background:"#101116",color:"#f7f7fa",fontFamily:"Arial,sans-serif"}}>
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",borderBottom:"1px solid #30323b"}}><div><strong>Simple ChatGPT + Claude Video Editor</strong><span style={{marginLeft:12,color:"#9699a8"}}>Unofficial community project</span></div><span>{status}</span></header>
    <section style={{minHeight:0,display:"grid",gridTemplateColumns:"minmax(320px,1fr) 360px",gap:18,padding:18}}>
      <div style={{minHeight:0,display:"grid",gridTemplateRows:"1fr auto",placeItems:"center",gap:12}}>
        <div ref={canvas} style={{height:"100%",maxWidth:"100%",aspectRatio:"9/16",position:"relative",touchAction:"none",boxShadow:"0 20px 70px #0008"}}>
          <Player ref={player} component={DemoComposition} durationInFrames={240} fps={30} compositionWidth={1080} compositionHeight={1920} inputProps={{editorState:state,editMode:true}} controls acknowledgeRemotionLicense style={{width:"100%",height:"100%"}}/>
        </div>
        <input aria-label="Video position" type="range" min={0} max={239} value={frame} onChange={(e)=>{const next=Number(e.target.value);setFrame(next);player.current?.seekTo(next);}} style={{width:"min(680px,90%)"}}/>
      </div>
      <aside style={{overflow:"auto",display:"grid",alignContent:"start",gap:14,padding:18,borderRadius:18,background:"#1b1c24"}}>
        <h2 style={{margin:0}}>{selected?label:"Select an element"}</h2>
        {selected?<>
          <Slider label="Move X" value={layout.x} min={-1080} max={1080} step={1} onChange={(x)=>update({x})}/><Slider label="Move Y" value={layout.y} min={-1920} max={1920} step={1} onChange={(y)=>update({y})}/><Slider label="Size" value={layout.scale} min={0.1} max={3} step={0.05} onChange={(scale)=>update({scale})}/><Slider label="Turn" value={layout.rotate} min={-180} max={180} step={1} onChange={(rotate)=>update({rotate})}/><Slider label="Opacity" value={layout.opacity} min={0} max={1} step={0.05} onChange={(opacity)=>update({opacity})}/>
          {kind==="text"?<label>Text<textarea value={state.textOverrides[selected]??""} placeholder="Leave blank to use the default" onChange={(e)=>setState({...state,textOverrides:{...state.textOverrides,[selected]:e.target.value}})} onBlur={()=>void api("/api/state",state)} style={field}/></label>:null}
          {kind==="text"||kind==="color"?<label>Color<input type="color" value={state.colorOverrides[selected]??"#5367ff"} onChange={(e)=>void commit({...state,colorOverrides:{...state.colorOverrides,[selected]:e.target.value}})} style={{width:"100%",height:44}}/></label>:null}
          {kind==="image"?<label style={button}>Replace image<input hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e)=>e.target.files?.[0]&&void upload(e.target.files[0])}/></label>:null}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><button style={button} onClick={()=>void commit(resetElement(state,selected))}>Reset</button><button style={button} onClick={undo} disabled={!history.length}>Undo</button></div>
          <button style={{...button,color:"#ff8e88"}} onClick={()=>void commit(hideElement(state,selected,true))}>Remove element</button>
        </>:<p style={{color:"#9699a8"}}>Click an outlined element in the video. Drag it on the canvas or use exact controls here.</p>}
        <hr style={{width:"100%",borderColor:"#30323b"}}/><h3 style={{margin:0}}>Review comments</h3><textarea value={comment} onChange={(e)=>setComment(e.target.value)} placeholder="Add a note for this frame" style={field}/><button style={button} onClick={()=>void addComment()}>Add comment</button>
        {comments.map((item)=><article key={item.id} style={{padding:12,borderRadius:12,background:"#272936"}}><button style={{...button,width:"100%",textAlign:"left"}} onClick={()=>player.current?.seekTo(item.frame)}>{(item.frame/30).toFixed(1)}s · {item.elementId??"Canvas"}</button><p>{item.text}</p><button style={{...button,color:"#ff8e88"}} onClick={()=>void removeComment(item.id)}>Delete</button></article>)}
      </aside>
    </section>
  </main>;
};

const field:React.CSSProperties={display:"block",width:"100%",minHeight:48,marginTop:6,padding:10,border:"1px solid #3d4050",borderRadius:10,background:"#111219",color:"white"};
const button:React.CSSProperties={display:"block",padding:"10px 12px",border:"1px solid #3d4050",borderRadius:10,background:"#292b37",color:"white",cursor:"pointer"};
const Slider:React.FC<{label:string;value:number;min:number;max:number;step:number;onChange:(value:number)=>void}>=({label,value,min,max,step,onChange})=><label style={{display:"grid",gridTemplateColumns:"72px 1fr 72px",gap:8,alignItems:"center"}}><span>{label}</span><input type="range" value={value} min={min} max={max} step={step} onChange={(e)=>onChange(Number(e.target.value))}/><input type="number" value={value} min={min} max={max} step={step} onChange={(e)=>onChange(Number(e.target.value))} style={{...field,margin:0,minHeight:36}}/></label>;

createRoot(document.getElementById("root")!).render(<App/>);
