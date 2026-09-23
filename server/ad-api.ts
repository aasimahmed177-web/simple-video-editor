import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import ffmpeg from "ffmpeg-static";
import ffprobe from "@ffprobe-installer/ffprobe";
import { transcribe, toCaptions } from "@remotion/install-whisper-cpp";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  selectComposition,
  makeCancelSignal,
} from "@remotion/renderer";
import nspell from "nspell";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../src/ads/upload";
import { createRequire } from "node:module";
import { z } from "zod";
import {
  brandSchema,
  clipFrames,
  defaultBrand,
  durationFrames,
  FPS,
  groupWords,
  projectSchema,
  reviewIssues,
  toSrt,
  type Caption,
  type Media,
  type Project,
} from "../src/ads/model";

const exec = promisify(execFile);
const root = path.resolve("data");
const folders = {
  media: path.join(root, "media"),
  projects: path.join(root, "projects"),
  exports: path.join(root, "exports"),
};
const whisperPath = path.resolve(".local/whisper.cpp");
const json = (res: ServerResponse, value: unknown, status = 200) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
};
const atomicJson = (file: string, value: unknown) => {
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
};
const readJson = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4_000_000) throw new Error("Project is too large");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};
const safeName = (value: string) =>
  z
    .string()
    .regex(/^[a-zA-Z0-9-]+(?:\.(?:json|mp4|mov|webm|m4v|mp3|wav|m4a|srt))?$/)
    .parse(value);
type Job = {
  id: string;
  projectId: string;
  type: "transcribe" | "export";
  status: "running" | "done" | "error";
  progress: number;
  message: string;
  captions?: Caption[];
  files?: string[];
  error?: string;
};
const jobs = new Map<string, Job>();
let active: { job: Job; abort: AbortController } | null = null;
let checker: ReturnType<typeof nspell> | null = null;
const spellcheck = (project: Project) => {
  if (!checker) {
    const require = createRequire(import.meta.url);
    const folder = path.dirname(require.resolve("dictionary-en"));
    checker = nspell({
      aff: fs.readFileSync(path.join(folder, "index.aff")),
      dic: fs.readFileSync(path.join(folder, "index.dic")),
    });
  }
  const allowed = new Set(
    [...project.brand.dictionary, project.brand.name].map((s) =>
      s.toLowerCase(),
    ),
  );
  return project.captions.flatMap((c) =>
    [...new Set(c.text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? [])]
      .filter(
        (word) =>
          !allowed.has(word.toLowerCase()) &&
          !checker!.correct(word.replaceAll("’", "'")),
      )
      .map((word) => ({
        captionId: c.id,
        word,
        suggestions: checker!.suggest(word).slice(0, 4),
      })),
  );
};

const streamFile = (
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  download = false,
) => {
  const size = fs.statSync(file).size;
  const ext = path.extname(file);
  const mime: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".m4v": "video/mp4",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".srt": "application/x-subrip",
    ".json": "application/json",
  };
  res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  if (download)
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(file)}"`,
    );
  let start = 0,
    end = size - 1;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start >= size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.setHeader("Content-Length", end - start + 1);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
};

const upload = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Media> => {
  const declaredBytes = Number(req.headers["content-length"] ?? 0);
  if (declaredBytes > MAX_UPLOAD_BYTES)
    throw new Error(`Maximum file size is ${MAX_UPLOAD_LABEL}`);
  const disk = await fsp.statfs(folders.media);
  if (disk.bavail * disk.bsize < declaredBytes + 256_000_000)
    throw new Error(
      "Not enough free disk space to import this file. Free some space and try again.",
    );
  const name = decodeURIComponent(
    String(req.headers["x-file-name"] ?? "video.mp4"),
  ).slice(0, 200);
  const ext = path.extname(name).toLowerCase();
  if (![".mp4", ".mov", ".webm", ".m4v", ".mp3", ".wav", ".m4a"].includes(ext))
    throw new Error("Choose MP4, MOV, WebM, MP3, M4A, or WAV");
  const id = randomUUID(),
    file = `${id}${ext}`,
    output = path.join(folders.media, file);
  const previewFile = `${id}-preview.mp4`;
  const previewPath = path.join(folders.media, previewFile);
  const abort = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.once("close", onClose);
  let bytes = 0;
  try {
    await pipeline(
      req,
      new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          callback(
            bytes > MAX_UPLOAD_BYTES
              ? new Error(`Maximum file size is ${MAX_UPLOAD_LABEL}`)
              : null,
            chunk,
          );
        },
      }),
      fs.createWriteStream(output, { flags: "wx" }),
    );
    const { stdout } = await exec(
      ffprobe.path,
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", output],
      { maxBuffer: 4_000_000, timeout: 60_000, signal: abort.signal },
    );
    const info = JSON.parse(stdout) as {
      format: { duration: string };
      streams: {
        codec_type: string;
        codec_name: string;
        width?: number;
        height?: number;
        disposition?: { attached_pic?: number };
      }[];
    };
    const video = info.streams.find(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    );
    const duration = Number(info.format.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7200)
      throw new Error("Use a video or audio file up to two hours long");
    const hasAudio = info.streams.some((s) => s.codec_type === "audio");
    if (!video && !hasAudio)
      throw new Error("This file has no usable video or audio");
    const audio = info.streams.find((s) => s.codec_type === "audio");
    const needsPreview =
      video &&
      ((video.width ?? 0) > 1920 ||
        (video.height ?? 0) > 1080 ||
        !["h264", "vp8", "vp9", "av1"].includes(video.codec_name) ||
        (audio &&
          !["aac", "mp3", "opus", "vorbis"].includes(audio.codec_name)));
    if (needsPreview) {
      await exec(
        ffmpeg!,
        [
          "-y",
          "-v",
          "error",
          "-i",
          output,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-vf",
          "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-threads",
          "2",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          previewPath,
        ],
        { signal: abort.signal, maxBuffer: 2_000_000 },
      );
    }
    return {
      id,
      file,
      name,
      duration,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      hasAudio,
      ...(needsPreview ? { previewFile } : {}),
      kind: video ? "video" : "audio",
    };
  } catch (error) {
    await fsp.rm(output, { force: true });
    await fsp.rm(previewPath, { force: true });
    throw error;
  } finally {
    res.removeListener("close", onClose);
  }
};

const runTranscription = async (p: Project, job: Job, signal: AbortSignal) => {
  if (
    !fs.existsSync(path.join(whisperPath, "ggml-small.en.bin")) ||
    !fs.existsSync(path.join(whisperPath, "main"))
  )
    throw new Error("Run npm run setup:transcription first, then try again.");
  if (
    !p.clips.some(
      (c) => c.volume > 0 && p.media.find((m) => m.id === c.mediaId)?.hasAudio,
    )
  )
    throw new Error(
      "The selected clips have no audible voice track. Unmute the footage or add subtitles manually.",
    );
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "adscade-transcribe-"));
  try {
    const parts: string[] = [];
    for (let i = 0; i < p.clips.length; i++) {
      if (signal.aborted) throw new Error("Cancelled");
      const clip = p.clips[i],
        media = p.media.find((m) => m.id === clip.mediaId)!;
      const duration = clipFrames(clip) / FPS;
      const part = path.join(temp, `part-${i}.wav`);
      parts.push(part);
      job.message = `Preparing clip ${i + 1} of ${p.clips.length}`;
      const input =
        media.hasAudio && clip.volume > 0
          ? [
              "-ss",
              String(Math.round(clip.start * FPS) / FPS),
              "-i",
              path.join(folders.media, media.file),
            ]
          : ["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono"];
      await exec(
        ffmpeg!,
        [
          "-y",
          ...input,
          "-t",
          String(duration),
          "-vn",
          "-af",
          `apad,atrim=duration=${duration}`,
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          part,
        ],
        { signal, maxBuffer: 2_000_000 },
      );
    }
    const list = path.join(temp, "parts.txt");
    await fsp.writeFile(
      list,
      parts.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"),
    );
    const wav = path.join(temp, "speech.wav");
    await exec(
      ffmpeg!,
      ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", wav],
      { signal },
    );
    job.message = "Transcribing English speech locally";
    const result = await transcribe({
      inputPath: wav,
      whisperPath,
      whisperCppVersion: "1.5.5",
      model: "small.en",
      language: "en",
      additionalArgs: [
        "--prompt",
        `Names and terms: ${[p.brand.name, ...p.brand.dictionary].join(", ")}`,
      ],
      tokenLevelTimestamps: true,
      printOutput: false,
      signal,
      onProgress: (progress) => {
        job.progress = Math.min(0.99, progress);
      },
    });
    job.captions = groupWords(
      toCaptions({ whisperCppOutput: result }).captions,
      durationFrames(p) / FPS,
    );
    if (!job.captions.length)
      throw new Error(
        "No speech was detected. Check the audio or add subtitles manually.",
      );
    atomicJson(path.join(folders.projects, `${p.id}-transcript.json`), {
      captions: job.captions,
      sourceClips: p.clips,
    });
    job.message = `${job.captions.length} subtitles ready for review`;
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
};

const runExport = async (
  p: Project,
  job: Job,
  signal: AbortSignal,
  mediaBase: string,
  requested: ("square" | "vertical")[],
) => {
  const issues = reviewIssues(p);
  if (issues.length) throw new Error(issues[0]);
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "adscade-render-"));
  const prefix = `${
    p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50) || "ad"
  }-${job.id}`;
  const { cancelSignal, cancel } = makeCancelSignal();
  signal.addEventListener("abort", cancel, { once: true });
  const created: string[] = [];
  try {
    job.message = "Preparing video renderer";
    const serveUrl = await bundle({
      entryPoint: path.resolve("src/index.ts"),
      outDir: path.join(temp, "bundle"),
      symlinkPublicDir: true,
    });
    if (signal.aborted) throw new Error("Cancelled");
    for (let i = 0; i < requested.length; i++) {
      const format = requested[i];
      const composition = await selectComposition({
        serveUrl,
        id: format === "square" ? "AdSquare" : "AdVertical",
        inputProps: { project: p, mediaBase },
      });
      const filename = `${prefix}-${format === "square" ? "1x1" : "9x16"}-${p.exportResolution}p.mp4`;
      created.push(filename);
      await renderMedia({
        serveUrl,
        composition,
        inputProps: { project: p, mediaBase },
        codec: "h264",
        audioCodec: "aac",
        pixelFormat: "yuv420p",
        crf: 18,
        scale: Number(p.exportResolution) / 1080,
        outputLocation: path.join(folders.exports, filename),
        concurrency: 2,
        offthreadVideoThreads: 2,
        offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
        cancelSignal,
        onProgress: ({ progress }) => {
          job.progress = (i + progress) / requested.length;
          job.message = `Rendering ${format === "square" ? "1:1 Feed" : "9:16 Story"} · ${Math.round(progress * 100)}%`;
        },
      });
    }
    if (p.subtitlesEnabled && p.captions.length) {
      const srt = `${prefix}.srt`;
      await fsp.writeFile(path.join(folders.exports, srt), toSrt(p.captions));
      created.push(srt);
    }
    const manifest = `${prefix}.json`;
    atomicJson(path.join(folders.exports, manifest), {
      exportedAt: new Date().toISOString(),
      project: p,
      files: created,
    });
    created.push(manifest);
    job.files = created;
    job.message = "Your exports are ready";
  } catch (error) {
    await Promise.all(
      created.map((file) =>
        fsp.rm(path.join(folders.exports, file), { force: true }),
      ),
    );
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    await fsp.rm(temp, { recursive: true, force: true });
  }
};

export const adApi = (): Plugin => ({
  name: "adscade-local-studio",
  configureServer(server) {
    Object.values(folders).forEach((folder) =>
      fs.mkdirSync(folder, { recursive: true }),
    );
    const previousJob = path.join(root, "last-job.json");
    if (fs.existsSync(previousJob)) {
      const previous = JSON.parse(fs.readFileSync(previousJob, "utf8")) as Job;
      if (previous.status === "running") {
        previous.status = "error";
        previous.error =
          "The server stopped during this job. Please start it again.";
      }
      jobs.set(previous.id, previous);
    }
    server.httpServer?.once("close", () => active?.abort.abort());
    // Apply to both editors: loopback binding plus origin checks prevent cross-site writes.
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/api/")) return next();
      const host = req.headers.host ?? "";
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
        return json(res, { error: "Local access only" }, 403);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`)
        return json(res, { error: "Origin not allowed" }, 403);
      if (req.headers["sec-fetch-site"] === "cross-site")
        return json(res, { error: "Cross-site access blocked" }, 403);
      next();
    });
    server.middlewares.use("/api/ads", (req, res, next) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost"),
          route = url.pathname;
        if (req.method === "GET" && route === "/status")
          return json(res, {
            transcriptionReady:
              fs.existsSync(path.join(whisperPath, "main")) &&
              fs.existsSync(path.join(whisperPath, "ggml-small.en.bin")),
            jobs: [...jobs.values()].slice(-20),
          });
        if (req.method === "POST" && route === "/upload")
          return json(res, await upload(req, res));
        if (
          (req.method === "GET" || req.method === "HEAD") &&
          route.startsWith("/media/")
        )
          return streamFile(
            req,
            res,
            path.join(folders.media, safeName(route.slice(7))),
          );
        if (
          (req.method === "GET" || req.method === "HEAD") &&
          route.startsWith("/download/")
        )
          return streamFile(
            req,
            res,
            path.join(folders.exports, safeName(route.slice(10))),
            true,
          );
        if (req.method === "GET" && route === "/projects") {
          const files = fs
            .readdirSync(folders.projects)
            .filter(
              (f) => f.endsWith(".json") && !f.endsWith("-transcript.json"),
            );
          const projects = files
            .flatMap((f) => {
              try {
                const p = projectSchema.parse(
                  JSON.parse(
                    fs.readFileSync(path.join(folders.projects, f), "utf8"),
                  ),
                );
                return [{ id: p.id, name: p.name, updatedAt: p.updatedAt }];
              } catch {
                return [];
              }
            })
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return json(res, projects);
        }
        if (req.method === "GET" && route.startsWith("/transcript/")) {
          const file = path.join(
            folders.projects,
            `${safeName(route.slice(12))}-transcript.json`,
          );
          if (!fs.existsSync(file))
            throw new Error(
              "No saved transcript yet. Transcribe this cut first.",
            );
          return json(res, JSON.parse(fs.readFileSync(file, "utf8")));
        }
        if (req.method === "GET" && route.startsWith("/projects/"))
          return json(
            res,
            JSON.parse(
              fs.readFileSync(
                path.join(
                  folders.projects,
                  `${safeName(route.slice(10))}.json`,
                ),
                "utf8",
              ),
            ),
          );
        if (req.method === "GET" && route.startsWith("/history/")) {
          const projectId = safeName(route.slice(9));
          const exports = fs
            .readdirSync(folders.exports)
            .filter((f) => f.endsWith(".json"))
            .flatMap((file) => {
              const result = JSON.parse(
                fs.readFileSync(path.join(folders.exports, file), "utf8"),
              ) as { project: Project; exportedAt: string; files: string[] };
              return result.project.id === projectId
                ? [
                    {
                      id: file,
                      projectId,
                      type: "export",
                      status: "done",
                      message: "Previous export",
                      progress: 1,
                      files: [...result.files, file],
                      exportedAt: result.exportedAt,
                    },
                  ]
                : [];
            })
            .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
          return json(res, exports);
        }
        if (req.method === "POST" && route === "/projects") {
          const p = projectSchema.parse(await readJson(req));
          p.updatedAt = new Date().toISOString();
          atomicJson(path.join(folders.projects, `${p.id}.json`), p);
          return json(res, p);
        }
        if (req.method === "GET" && route === "/brand")
          return json(
            res,
            fs.existsSync(path.join(root, "brand.json"))
              ? brandSchema.parse(
                  JSON.parse(
                    fs.readFileSync(path.join(root, "brand.json"), "utf8"),
                  ),
                )
              : defaultBrand,
          );
        if (req.method === "POST" && route === "/brand") {
          const brand = brandSchema.parse(await readJson(req));
          atomicJson(path.join(root, "brand.json"), brand);
          return json(res, brand);
        }
        if (req.method === "POST" && route === "/spellcheck")
          return json(
            res,
            spellcheck(projectSchema.parse(await readJson(req))),
          );
        if (req.method === "POST" && route === "/cancel") {
          active?.abort.abort();
          return json(res, { ok: true });
        }
        if (
          req.method === "POST" &&
          (route === "/transcribe" || route === "/export")
        ) {
          if (active)
            return json(
              res,
              {
                error:
                  "A job is already running. Wait for it to finish or cancel it.",
              },
              409,
            );
          const body = z
            .object({
              project: projectSchema,
              formats: z
                .array(z.enum(["square", "vertical"]))
                .min(1)
                .max(2)
                .optional(),
            })
            .parse(await readJson(req));
          const p = body.project;
          if (!p.clips.length) throw new Error("Add a video first");
          const job: Job = {
            id: randomUUID(),
            projectId: p.id,
            type: route === "/export" ? "export" : "transcribe",
            status: "running",
            progress: 0,
            message: "Starting",
          };
          const abort = new AbortController();
          jobs.set(job.id, job);
          active = { job, abort };
          atomicJson(previousJob, job);
          const address = server.httpServer?.address();
          if (!address || typeof address === "string")
            throw new Error("Local server is not ready");
          const work =
            job.type === "transcribe"
              ? runTranscription(p, job, abort.signal)
              : runExport(
                  p,
                  job,
                  abort.signal,
                  `http://127.0.0.1:${address.port}`,
                  [
                    ...new Set(
                      body.formats ?? (["square", "vertical"] as const),
                    ),
                  ],
                );
          void work
            .then(() => {
              job.status = "done";
              job.progress = 1;
            })
            .catch((error: unknown) => {
              job.status = "error";
              job.error = abort.signal.aborted
                ? "Cancelled. Your project is unchanged."
                : error instanceof Error
                  ? error.message
                  : String(error);
            })
            .finally(() => {
              active = null;
              atomicJson(path.join(root, "last-job.json"), job);
            });
          return json(res, job, 202);
        }
        next();
      })().catch((error: unknown) => {
        if (!res.headersSent)
          json(
            res,
            {
              error: error instanceof Error ? error.message : "Request failed",
            },
            400,
          );
        else res.destroy();
      });
    });
  },
});
