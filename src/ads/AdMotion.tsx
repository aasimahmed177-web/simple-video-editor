import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Brand, Caption, Clip, Project } from "./model";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Motion is confined to a shot; the source trim and audio timing stay unchanged. */
export const MotionVideo: React.FC<{
  clip: Clip;
  index: number;
  length: number;
  src: string;
}> = ({ clip, index, length, src }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const sideways = clip.rotation === 90 || clip.rotation === 270;
  const baseScale = index % 3 === 1 ? 1.045 : 1;
  const zoom = interpolate(
    frame,
    [0, Math.max(1, length - 1)],
    [baseScale, baseScale + 0.025],
    {
      ...clamp,
      easing: Easing.inOut(Easing.quad),
    },
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{ transform: `scale(${zoom})`, transformOrigin: "50% 46%" }}
      >
        <OffthreadVideo
          src={src}
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
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const MotionCaption: React.FC<{
  caption: Caption;
  brand: Brand;
  time: number;
  ctaVisible: boolean;
}> = ({ caption, brand, time, ctaVisible }) => {
  const { fps, height, width } = useVideoConfig();
  const vertical = height > width;
  const age = Math.max(0, (time - caption.start) * fps);
  const enter = spring({
    frame: age,
    fps,
    config: { damping: 24, stiffness: 240, mass: 0.7 },
  });
  // Never infer karaoke timing from word count. Corrected text without matching
  // word timings stays a readable phrase until it has been aligned again.
  const words =
    caption.words?.length &&
    caption.words.map((word) => word.text.trim()).join(" ") ===
      caption.text.trim().replace(/\s+/g, " ")
      ? caption.words
      : undefined;
  const bottom = vertical
    ? Math.max(
        (height * brand.captionBottom) / 100,
        ctaVisible ? height * 0.29 : 0,
      )
    : height * 0.18;
  return (
    <div
      style={{
        position: "absolute",
        bottom,
        left: 72,
        right: vertical ? 130 : 72,
        textAlign: "center",
        fontSize: brand.captionSize,
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: "-0.015em",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        textShadow: "0 2px 7px #000000B3",
        opacity: interpolate(age, [0, 3], [0.35, 1], clamp),
        transform: `translateY(${(1 - enter) * 15}px)`,
      }}
    >
      <span
        style={{
          background: brand.captionBackground
            ? `${brand.background}CF`
            : "transparent",
          padding: "9px 15px",
          borderRadius: 9,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {words
          ? words.map((word, index) => {
              const active = time >= word.start && time < word.end;
              return (
                <span
                  key={`${index}-${word.start}`}
                  style={{ color: active ? brand.accent : brand.foreground }}
                >
                  {index > 0 ? " " : ""}
                  {word.text.trim()}
                </span>
              );
            })
          : caption.text}
      </span>
    </div>
  );
};

export const MotionHook: React.FC<{ project: Project }> = ({ project }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const vertical = height > width;
  const end = project.hookSeconds * fps;
  const enter = spring({ frame, fps, config: { damping: 24, stiffness: 150 } });
  const exit = interpolate(
    frame,
    [Math.max(0, end - 7), Math.max(1, end)],
    [1, 0],
    clamp,
  );
  return (
    <div
      style={{
        position: "absolute",
        top: height * (vertical ? 0.13 : 0.09),
        left: 76,
        right: vertical ? 138 : 76,
        display: "flex",
        alignItems: "stretch",
        gap: 20,
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * 22}px)`,
        textShadow: "0 3px 15px #000000CC",
      }}
    >
      <div
        style={{
          width: 5,
          flexShrink: 0,
          background: project.brand.accent,
          borderRadius: 3,
        }}
      />
      <div
        style={{
          fontSize: vertical ? 46 : 43,
          fontWeight: 650,
          lineHeight: 1.1,
          letterSpacing: "-0.025em",
        }}
      >
        {project.hook}
      </div>
    </div>
  );
};

export const MotionCta: React.FC<{ project: Project }> = ({ project }) => {
  const frame = useCurrentFrame();
  const { fps, height, width, durationInFrames } = useVideoConfig();
  const vertical = height > width;
  const start = Math.max(0, durationInFrames - project.brand.ctaSeconds * fps);
  const age = Math.max(0, frame - start);
  const enter = spring({
    frame: age,
    fps,
    config: { damping: 24, stiffness: 180, mass: 0.8 },
  });
  const line = interpolate(age, [3, 22], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        position: "absolute",
        ...(vertical ? { bottom: height * 0.18 } : { top: height * 0.09 }),
        left: 76,
        right: vertical ? 138 : 76,
        display: "flex",
        justifyContent: "center",
        opacity: interpolate(age, [0, 5], [0, 1], clamp),
        transform: `translateY(${(1 - enter) * 20}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          maxWidth: "100%",
          padding: "19px 26px",
          boxSizing: "border-box",
          borderRadius: 14,
          border: `1px solid ${project.brand.accent}80`,
          background: `${project.brand.background}EB`,
          boxShadow: "0 8px 32px #00000040",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            fontSize: 34,
            fontWeight: 650,
            lineHeight: 1.16,
            textAlign: "center",
            overflowWrap: "anywhere",
          }}
        >
          {project.brand.cta}
        </span>
        <span
          aria-hidden
          style={{
            color: project.brand.accent,
            fontFamily: "Arial",
            fontSize: 40,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ↗
        </span>
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: 3,
            width: `${line * 100}%`,
            background: project.brand.accent,
          }}
        />
      </div>
    </div>
  );
};

export const MotionCallout: React.FC<{
  callout: Project["callouts"][number];
  brand: Brand;
  time: number;
}> = ({ callout, brand, time }) => {
  const { fps, height, width } = useVideoConfig();
  const vertical = height > width;
  const age = Math.max(0, (time - callout.start) * fps);
  const remaining = (callout.end - time) * fps;
  const enter = spring({
    frame: age,
    fps,
    config: { damping: 23, stiffness: 200, mass: 0.8 },
  });
  const exit = interpolate(remaining, [0, 5], [0, 1], clamp);
  const match = callout.text.match(/^(\d+)\s+(.+)$/);
  const number = match?.[1];
  const label = match?.[2] ?? callout.text;
  return (
    <div
      style={{
        position: "absolute",
        top: height * (vertical ? 0.54 : 0.075),
        left: 76,
        right: vertical ? 138 : 76,
        display: "flex",
        justifyContent: "center",
        opacity: interpolate(age, [0, 4], [0, 1], clamp) * exit,
        transform: `translateY(${(1 - enter) * 20}px) scale(${0.98 + enter * 0.02})`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          borderLeft: `4px solid ${brand.accent}`,
          padding: "11px 22px",
          borderRadius: "0 12px 12px 0",
          background: `${brand.background}CF`,
          boxShadow: "0 7px 30px #00000024",
          maxWidth: "100%",
        }}
      >
        {number ? (
          <span
            style={{
              color: brand.accent,
              fontSize: 86,
              fontWeight: 700,
              lineHeight: 0.95,
              letterSpacing: "-0.055em",
              flexShrink: 0,
            }}
          >
            {number}
          </span>
        ) : null}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: brand.accent,
              fontSize: 25,
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: "0.11em",
              marginBottom: 5,
              overflowWrap: "anywhere",
            }}
          >
            {callout.kicker}
          </div>
          <div
            style={{
              fontSize: 38,
              fontWeight: 650,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              overflowWrap: "anywhere",
            }}
          >
            {label}
          </div>
        </div>
      </div>
    </div>
  );
};
