export const editorScenes=[
  {id:"scene-1",label:"Scene 1 · Opening",startFrame:0,endFrame:80},
  {id:"scene-2",label:"Scene 2 · Message",startFrame:80,endFrame:160},
  {id:"scene-3",label:"Scene 3 · Finish",startFrame:160,endFrame:240},
];

export const sceneAtFrame=(frame:number)=>editorScenes.find((scene)=>frame>=scene.startFrame&&frame<scene.endFrame);
