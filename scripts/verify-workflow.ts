// An opt-in integration check using generated speech, never customer footage.
// First create .local/test/english-sample.mp4 (see docs/WORKFLOW.md).
import fs from "node:fs";
import { newProject, type Media, type Caption } from "../src/ads/model";

const base = process.env.STUDIO_URL ?? "http://127.0.0.1:5173";
const post = async (route: string, value: unknown) => {
  const response = await fetch(`${base}/api/ads${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
};
const wait = async (id: string) => {
  for (let attempt = 0; attempt < 600; attempt++) {
    const status = await (await fetch(`${base}/api/ads/status`)).json();
    const job = status.jobs.find((j: { id: string }) => j.id === id);
    if (!job) throw new Error("Job disappeared");
    if (job.status === "error") throw new Error(job.error);
    if (job.status === "done") return job;
    if (attempt % 10 === 0) console.log(job.message);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Job timed out");
};
const run = async () => {
  const upload = await fetch(`${base}/api/ads/upload`, {
    method: "POST",
    headers: { "x-file-name": "english-sample.mp4" },
    body: fs.readFileSync(".local/test/english-sample.mp4"),
  });
  if (!upload.ok) throw new Error(await upload.text());
  const media = (await upload.json()) as Media;
  const p = newProject();
  p.name = "Workflow verification";
  p.media = [media];
  p.clips = [
    {
      id: "clip-1",
      mediaId: media.id,
      start: 0,
      end: Math.floor(media.duration * 30) / 30,
      volume: 1,
      fit: "cover",
      x: 50,
      y: 50,
    },
  ];
  const transcript = await wait((await post("/transcribe", { project: p })).id);
  p.captions = transcript.captions as Caption[];
  console.log("TRANSCRIPT:", p.captions.map((c) => c.text).join(" "));
  if (!p.captions.some((c) => /qualified|leads|discovery/i.test(c.text)))
    throw new Error("Transcription did not recognize the test speech");
  // Verify a shorter trimmed cut with deliberately reviewed subtitles.
  p.clips = [
    { ...p.clips[0], start: 1, end: 4 },
    { ...p.clips[0], id: "clip-2", start: 6, end: 9 },
  ];
  p.captions = [
    {
      id: "c1",
      start: 0,
      end: 3,
      text: "Your next ad starts here.",
      reviewed: true,
    },
    {
      id: "c2",
      start: 3,
      end: 6,
      text: "Book a discovery call.",
      reviewed: true,
    },
  ];
  p.hook = "Make your next ad count";
  p.brand.cta = "Book a discovery call";
  await post("/projects", p);
  const result = await wait(
    (await post("/export", { project: p, formats: ["square", "vertical"] })).id,
  );
  fs.mkdirSync(".local/test", { recursive: true });
  fs.writeFileSync(
    ".local/test/result.json",
    JSON.stringify(
      { project: p, transcript: transcript.captions, files: result.files },
      null,
      2,
    ),
  );
  console.log("EXPORTS:", result.files);
};
run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
