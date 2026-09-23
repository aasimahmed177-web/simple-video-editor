import { describe, expect, it } from "vitest";
import {
  clipFrames,
  durationFrames,
  groupWords,
  newProject,
  projectSchema,
  reviewIssues,
  toSrt,
} from "./model";

const fixture = () => {
  const p = newProject();
  p.media = [
    {
      id: "media",
      file: "media.mp4",
      name: "Test",
      duration: 12,
      width: 1920,
      height: 1080,
      hasAudio: true,
      kind: "video",
    },
  ];
  p.clips = [
    {
      id: "clip",
      mediaId: "media",
      start: 2,
      end: 12,
      volume: 1,
      fit: "cover",
      x: 50,
      y: 50,
    },
  ];
  return p;
};
describe("ad editing timeline", () => {
  it("defaults older saved projects to 1080p and validates resolution choices", () => {
    const p = fixture();
    const old = { ...p, exportResolution: undefined };
    expect(projectSchema.parse(old).exportResolution).toBe("1080");
    for (const resolution of ["720", "1080", "2160"])
      expect(
        projectSchema.safeParse({ ...p, exportResolution: resolution }).success,
      ).toBe(true);
    expect(
      projectSchema.safeParse({ ...p, exportResolution: "4000" }).success,
    ).toBe(false);
  });
  it("rejects preview paths that escape the media folder", () => {
    const p = fixture();
    p.media[0].previewFile = "../outside.mp4";
    expect(projectSchema.safeParse(p).success).toBe(false);
  });
  it("quantizes source in/out points consistently so subtitles and video share a clock", () => {
    const p = fixture();
    p.clips[0].start = 0.018;
    p.clips[0].end = 1.018;
    expect(clipFrames(p.clips[0])).toBe(30);
    expect(durationFrames(p)).toBe(30);
  });
  it("rejects clips outside source footage and subtitles outside the edited cut", () => {
    const p = fixture();
    p.clips[0].end = 15;
    expect(projectSchema.safeParse(p).success).toBe(false);
    p.clips[0].end = 12;
    p.captions = [
      { id: "c", start: 9, end: 11, text: "Past the cut", reviewed: false },
    ];
    expect(projectSchema.safeParse(p).success).toBe(false);
  });
  it("rejects source paths that could escape the local media directory", () => {
    const p = fixture();
    p.media[0].file = "../../private.mp4";
    expect(projectSchema.safeParse(p).success).toBe(false);
  });
  it("requires review and detects overlaps, stale cuts, and unreadably fast captions", () => {
    const p = fixture();
    p.timingReviewed = false;
    p.captions = [
      { id: "a", start: 0, end: 2, text: "A short line", reviewed: false },
      {
        id: "b",
        start: 1.9,
        end: 2,
        text: "This line is too fast",
        reviewed: true,
      },
    ];
    const issues = reviewIssues(p).join(" ");
    expect(issues).toContain("cut changed");
    expect(issues).toContain("needs spelling");
    expect(issues).toContain("overlap");
    expect(issues).toContain("too fast");
  });
  it("allows reviewed captions and permits deliberately caption-free exports", () => {
    const p = fixture();
    p.captions = [
      { id: "a", start: 0, end: 2, text: "Reviewed", reviewed: true },
    ];
    expect(reviewIssues(p)).toEqual([]);
    p.captions[0].reviewed = false;
    p.subtitlesEnabled = false;
    expect(reviewIssues(p)).toEqual([]);
  });
  it("groups word timestamps into short phrases without bridging silence", () => {
    const cues = groupWords(
      [
        { text: " Hello", startMs: 0, endMs: 300 },
        { text: " world.", startMs: 300, endMs: 800 },
        { text: " Next", startMs: 2000, endMs: 2400 },
        { text: " line", startMs: 2400, endMs: 2900 },
      ],
      2.8,
    );
    expect(cues.map((c) => c.text)).toEqual(["Hello world.", "Next line"]);
    expect(cues[1].end).toBe(2.8);
    expect(cues.every((c) => !c.reviewed)).toBe(true);
  });
  it("exports ordered SRT timestamps with milliseconds and rollover", () => {
    expect(
      toSrt([
        { id: "b", start: 60.1, end: 62.5, text: "Second", reviewed: true },
        { id: "a", start: 0, end: 1.9996, text: "First", reviewed: true },
      ]),
    ).toBe(
      "1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n2\n00:01:00,100 --> 00:01:02,500\nSecond\n",
    );
  });
  it("keeps Whisper word fragments and punctuation attached", () => {
    const cues = groupWords(
      [
        { text: " Ad", startMs: 0, endMs: 100 },
        { text: "sc", startMs: 100, endMs: 200 },
        { text: "ade", startMs: 200, endMs: 350 },
        { text: ".", startMs: 350, endMs: 350 },
        { text: " Works", startMs: 700, endMs: 1100 },
      ],
      2,
    );
    expect(cues.map((c) => c.text)).toEqual(["Adscade.", "Works"]);
  });
});
