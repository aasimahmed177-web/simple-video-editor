import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { clipFrames, type Project } from "./model";
import "./fonts.css";

export type AdProps = {
  project: Project;
  mediaBase?: string;
  preview?: boolean;
};
export const AdComposition: React.FC<AdProps> = ({
  project,
  mediaBase = "",
  preview = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const time = frame / fps,
    brand = project.brand;
  const subtitle = project.subtitlesEnabled
    ? project.captions.find((c) => time >= c.start && time < c.end)
    : undefined;
  let offset = 0;
  const mediaUrl = (id: string) => {
    const media = project.media.find((m) => m.id === id)!;
    return `${mediaBase}/api/ads/media/${preview && media.previewFile ? media.previewFile : media.file}`;
  };
  const ctaVisible =
    brand.cta &&
    brand.ctaSeconds > 0 &&
    time >= Math.max(0, durationInFrames / fps - brand.ctaSeconds);
  return (
    <AbsoluteFill
      style={{
        background: brand.background,
        color: brand.foreground,
        fontFamily: brand.font,
      }}
    >
      {project.clips.map((clip) => {
        const from = offset;
        const length = clipFrames(clip);
        const sideways = clip.rotation === 90 || clip.rotation === 270;
        offset += length;
        return (
          <Sequence key={clip.id} from={from} durationInFrames={length}>
            <OffthreadVideo
              src={mediaUrl(clip.mediaId)}
              trimBefore={Math.round(clip.start * fps)}
              trimAfter={Math.round(clip.start * fps) + length}
              volume={clip.volume}
              style={{
                position: "absolute",
                width: sideways ? height : width,
                height: sideways ? width : height,
                left: sideways ? (width - height) / 2 : 0,
                top: sideways ? (height - width) / 2 : 0,
                transform: `rotate(${clip.rotation ?? 0}deg)`,
                objectFit: clip.fit,
                objectPosition: `${clip.x}% ${clip.y}%`,
              }}
            />
          </Sequence>
        );
      })}
      {project.musicId ? (
        <Audio
          src={mediaUrl(project.musicId)}
          loop
          volume={(f) =>
            project.musicVolume *
            Math.min(1, f / 15, (durationInFrames - f) / 20)
          }
        />
      ) : null}
      {brand.showLogo ? (
        <div
          style={{
            position: "absolute",
            left: 76,
            top: height * 0.15,
            display: "flex",
            alignItems: "center",
            gap: 16,
            background: `${brand.background}D9`,
            padding: "12px 20px",
            borderRadius: 12,
          }}
        >
          <Img
            src={staticFile("brand/adscade-mark.png")}
            style={{ width: 58, height: 54, objectFit: "contain" }}
          />
          <span style={{ fontSize: 34, fontWeight: 600 }}>{brand.name}</span>
        </div>
      ) : null}
      {project.hook && time < project.hookSeconds ? (
        <div
          style={{
            position: "absolute",
            top: height * 0.25,
            left: 76,
            right: 110,
            fontSize: 68,
            lineHeight: 1.05,
            fontWeight: 700,
            textShadow: "0 2px 12px #000",
            background: `${brand.background}D9`,
            padding: "20px 26px",
            borderLeft: `7px solid ${brand.accent}`,
          }}
        >
          {project.hook}
        </div>
      ) : null}
      {subtitle ? (
        <div
          style={{
            position: "absolute",
            bottom: Math.max(
              (height * brand.captionBottom) / 100,
              ctaVisible ? height * 0.16 + 162 : 0,
            ),
            left: 76,
            right: 110,
            textAlign: "center",
            fontSize: brand.captionSize,
            fontWeight: 700,
            lineHeight: 1.18,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            textShadow: "0 2px 4px #000",
          }}
        >
          <span
            style={{
              background: brand.captionBackground
                ? `${brand.background}ED`
                : "transparent",
              padding: "10px 18px",
              borderRadius: 10,
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            {subtitle.text}
          </span>
        </div>
      ) : null}
      {ctaVisible ? (
        <div
          style={{
            position: "absolute",
            bottom: "16%",
            left: 76,
            right: 110,
            height: 132,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px 26px",
            boxSizing: "border-box",
            overflowWrap: "anywhere",
            color: brand.background,
            background: brand.accent,
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1.1,
            textAlign: "center",
            borderRadius: 10,
          }}
        >
          {brand.cta}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
