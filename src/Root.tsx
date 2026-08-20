import "./index.css";
import {Composition} from "remotion";
import {DemoComposition} from "./Composition";
import editorState from "./editor-state.json";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="SimpleEditorDemo" component={DemoComposition} durationInFrames={240} fps={30} width={1080} height={1920} defaultProps={{editorState,editMode:false}} />
    </>
  );
};
