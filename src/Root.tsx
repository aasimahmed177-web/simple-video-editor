import "./index.css";
import { Composition } from "remotion";
import { DemoComposition } from "./Composition";
import editorState from "./editor-state.json";
import { AdComposition } from "./ads/AdComposition";
import { defaultBrand, durationFrames, type Project } from "./ads/model";

const emptyProject: Project = {
  id: "preview",
  name: "New ad",
  clips: [],
  media: [],
  captions: [],
  brand: defaultBrand,
  hook: "",
  hookSeconds: 3,
  musicId: null,
  musicVolume: 0.12,
  subtitlesEnabled: true,
  updatedAt: "",
  timingReviewed: true,
  exportResolution: "1080",
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SimpleEditorDemo"
        component={DemoComposition}
        durationInFrames={240}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ editorState, editMode: false }}
      />
      <Composition
        id="AdSquare"
        component={AdComposition}
        durationInFrames={30}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{ project: emptyProject, mediaBase: "" }}
        calculateMetadata={({ props }) => ({
          durationInFrames: durationFrames(props.project),
        })}
      />
      <Composition
        id="AdVertical"
        component={AdComposition}
        durationInFrames={30}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ project: emptyProject, mediaBase: "" }}
        calculateMetadata={({ props }) => ({
          durationInFrames: durationFrames(props.project),
        })}
      />
    </>
  );
};
