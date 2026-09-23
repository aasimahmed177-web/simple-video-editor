import { z } from "zod";

export const FPS = 30;
export const formats = {
  square: { width: 1080, height: 1080, label: "1:1 · Feed" },
  vertical: { width: 1080, height: 1920, label: "9:16 · Story" },
} as const;
export type Format = keyof typeof formats;
const id = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const seconds = z.number().finite().min(0).max(7200);
export const brandSchema = z.object({
  name: z.string().min(1).max(60),
  background: color,
  accent: color,
  foreground: color,
  font: z.enum(["Inter Tight", "Arial", "Georgia"]),
  captionSize: z.number().min(28).max(72),
  captionBottom: z.number().min(18).max(45),
  captionBackground: z.boolean(),
  showLogo: z.boolean(),
  cta: z.string().max(80),
  ctaSeconds: z.number().min(0).max(10),
  dictionary: z.array(z.string().min(1).max(60)).max(200),
});
export type Brand = z.infer<typeof brandSchema>;
export const defaultBrand: Brand = {
  name: "Adscade",
  background: "#03140D",
  accent: "#E2B95B",
  foreground: "#F3E8D2",
  font: "Inter Tight",
  captionSize: 48,
  captionBottom: 24,
  captionBackground: true,
  showLogo: true,
  cta: "Book a discovery call",
  ctaSeconds: 3,
  dictionary: ["Adscade", "Meta", "Instagram", "CTA", "ROAS", "VSL"],
};
export const mediaSchema = z.object({
  id,
  name: z.string().max(200),
  file: z.string().regex(/^[a-zA-Z0-9-]+\.(mp4|mov|webm|m4v|mp3|wav|m4a)$/),
  duration: z.number().positive().max(7200),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  hasAudio: z.boolean(),
  previewFile: z
    .string()
    .regex(/^[a-zA-Z0-9-]+\.mp4$/)
    .optional(),
  kind: z.enum(["video", "audio"]),
});
export type Media = z.infer<typeof mediaSchema>;
export const clipSchema = z
  .object({
    id,
    mediaId: id,
    start: seconds,
    end: seconds,
    volume: z.number().min(0).max(2),
    fit: z.enum(["cover", "contain"]),
    rotation: z
      .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
      .default(0),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  })
  .refine(
    (c) => c.end > c.start + 1 / FPS,
    "A clip must be longer than one frame",
  );
export type Clip = z.infer<typeof clipSchema>;
export const captionSchema = z
  .object({
    id,
    start: seconds,
    end: seconds,
    text: z.string().min(1).max(240),
    reviewed: z.boolean(),
  })
  .refine((c) => c.end > c.start, "Subtitle end must be after its start");
export type Caption = z.infer<typeof captionSchema>;
export const projectSchema = z
  .object({
    id,
    name: z.string().min(1).max(100),
    media: z.array(mediaSchema).max(80),
    clips: z.array(clipSchema).max(100),
    captions: z.array(captionSchema).max(2000),
    brand: brandSchema,
    hook: z.string().max(120),
    hookSeconds: z.number().min(0).max(10),
    musicId: id.nullable(),
    musicVolume: z.number().min(0).max(1),
    subtitlesEnabled: z.boolean(),
    updatedAt: z.string().max(40),
    timingReviewed: z.boolean().default(true),
    exportResolution: z.enum(["720", "1080", "2160"]).default("1080"),
  })
  .superRefine((p, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (new Set(p.media.map((m) => m.id)).size !== p.media.length)
      issue("Duplicate media IDs");
    if (new Set(p.clips.map((c) => c.id)).size !== p.clips.length)
      issue("Duplicate clip IDs");
    if (new Set(p.captions.map((c) => c.id)).size !== p.captions.length)
      issue("Duplicate subtitle IDs");
    for (const clip of p.clips) {
      const media = p.media.find((m) => m.id === clip.mediaId);
      if (!media || media.kind !== "video" || clip.end > media.duration + 0.05)
        issue("Clip extends beyond its source video");
    }
    if (
      p.musicId &&
      !p.media.some((m) => m.id === p.musicId && m.kind === "audio")
    )
      issue("Music source is missing");
    const duration = p.clips.reduce(
      (total, c) => total + clipFrames(c) / FPS,
      0,
    );
    for (const caption of p.captions)
      if (caption.end > duration + 0.05)
        issue(
          "Subtitle extends past the cut. Adjust its timing or transcribe again.",
        );
  });
export type Project = z.infer<typeof projectSchema>;
export const clipFrames = (clip: Pick<Clip, "start" | "end">) =>
  Math.max(1, Math.round(clip.end * FPS) - Math.round(clip.start * FPS));
export const durationFrames = (p: Pick<Project, "clips">) =>
  Math.max(
    1,
    p.clips.reduce((sum, c) => sum + clipFrames(c), 0),
  );
export const newProject = (brand = defaultBrand): Project => ({
  id: crypto.randomUUID(),
  name: "Untitled ad",
  media: [],
  clips: [],
  captions: [],
  brand: structuredClone(brand),
  hook: "",
  hookSeconds: 3,
  musicId: null,
  musicVolume: 0.12,
  subtitlesEnabled: true,
  updatedAt: new Date().toISOString(),
  timingReviewed: true,
  exportResolution: "1080",
});
export const timelineKey = (p: Project) =>
  JSON.stringify(
    p.clips.map(({ mediaId, start, end }) => ({ mediaId, start, end })),
  );
export const reviewIssues = (p: Project) => {
  const issues: string[] = [];
  if (!p.clips.length) issues.push("Add at least one video clip.");
  if (!p.subtitlesEnabled) return issues;
  if (p.clips.length && !p.captions.length)
    issues.push(
      "Transcribe or add subtitles before exporting, or turn subtitles off.",
    );
  if (!p.timingReviewed && p.captions.length)
    issues.push(
      "The cut changed. Check all subtitle timings or transcribe again.",
    );
  const sorted = [...p.captions].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (!c.reviewed)
      issues.push(`Subtitle ${i + 1} needs spelling and timing review.`);
    if (i && c.start < sorted[i - 1].end - 0.001)
      issues.push(`Subtitles ${i} and ${i + 1} overlap.`);
    if (c.text.length / (c.end - c.start) > 25)
      issues.push(
        `Subtitle ${i + 1} is too fast to read (over 25 characters/sec).`,
      );
  }
  return issues;
};
export const srtTime = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
export const toSrt = (captions: Caption[]) =>
  [...captions]
    .sort((a, b) => a.start - b.start)
    .map(
      (c, i) =>
        `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`,
    )
    .join("\n");
export const groupWords = (
  words: { text: string; startMs: number; endMs: number }[],
  duration: number,
): Caption[] => {
  // Whisper emits tokens, including word fragments and zero-duration punctuation.
  // Preserve leading-space boundaries before grouping whole words into lines.
  const merged: typeof words = [];
  for (const token of words) {
    if (!token.text.trim() || /^\s*\[.*\]\s*$/.test(token.text)) continue;
    const previous = merged.at(-1);
    if (previous && !/^\s/.test(token.text)) {
      previous.text += token.text;
      previous.endMs = Math.max(previous.endMs, token.endMs);
    } else merged.push({ ...token });
  }
  const groups: Caption[] = [];
  for (const word of merged) {
    const text = word.text.trim();
    const start = Math.max(0, word.startMs / 1000),
      end = Math.min(duration, word.endMs / 1000);
    if (!text || end <= start || /^\[.*\]$/.test(text)) continue;
    const last = groups.at(-1);
    if (
      last &&
      last.text.length + text.length < 42 &&
      end - last.start <= 3.5 &&
      start - last.end < 0.6 &&
      !/[.!?]$/.test(last.text)
    ) {
      last.text += ` ${text}`;
      last.end = end;
    } else
      groups.push({
        id: `caption-${groups.length + 1}`,
        text,
        start: Math.max(start, last?.end ?? 0),
        end,
        reviewed: false,
      });
  }
  return groups.filter((c) => c.end > c.start);
};
