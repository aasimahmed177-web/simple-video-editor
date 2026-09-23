import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import {
  clipFrames,
  durationFrames,
  FPS,
  type Project,
} from "../src/ads/model";

const exec = promisify(execFile);
const SAMPLE_RATE = 48_000;

/** Build PCM first, then encode AAC once so renderer padding cannot delay speech. */
export async function muxProjectAudio({
  project,
  videoPath,
  outputPath,
  tempDir,
  mediaDir,
  signal,
}: {
  project: Project;
  videoPath: string;
  outputPath: string;
  tempDir: string;
  mediaDir: string;
  signal: AbortSignal;
}): Promise<void> {
  if (!ffmpeg) throw new Error("FFmpeg is unavailable.");
  const ffmpegPath = ffmpeg;
  if (path.resolve(videoPath) === path.resolve(outputPath))
    throw new Error("Audio mux output must differ from the source video.");
  signal.throwIfAborted();
  const frames = durationFrames(project);
  const duration = frames / FPS;
  const samples = (frames * SAMPLE_RATE) / FPS;
  if (!project.clips.length || frames <= 0)
    throw new Error("Add a video clip before exporting.");
  const work = await fs.mkdtemp(path.join(tempDir, "audio-mux-"));
  const run = (args: string[]) =>
    exec(
      ffmpegPath,
      ["-hide_banner", "-loglevel", "error", "-nostdin", ...args],
      {
        signal,
        killSignal: "SIGKILL",
        maxBuffer: 1_000_000,
      },
    );
  const mediaPath = (id: string) => {
    const media = project.media.find((item) => item.id === id);
    if (!media) throw new Error("An audio source is missing.");
    return { media, file: path.join(mediaDir, media.file) };
  };

  try {
    const voice = path.join(work, "voice.wav");
    if (project.voiceId) {
      const { file, media } = mediaPath(project.voiceId);
      if (!media.hasAudio) throw new Error("The prepared voice has no audio.");
      await run([
        "-i",
        file,
        "-vn",
        "-af",
        `aresample=${SAMPLE_RATE},apad=whole_len=${samples},atrim=end_sample=${samples},asetpts=PTS-STARTPTS`,
        "-ar",
        String(SAMPLE_RATE),
        "-ac",
        "2",
        "-c:a",
        "pcm_s24le",
        voice,
      ]);
    } else {
      const parts: string[] = [];
      for (let i = 0; i < project.clips.length; i++) {
        signal.throwIfAborted();
        const clip = project.clips[i];
        const { file, media } = mediaPath(clip.mediaId);
        const partFrames = clipFrames(clip);
        const partDuration = partFrames / FPS;
        const partSamples = (partFrames * SAMPLE_RATE) / FPS;
        const part = path.join(work, `part-${i}.wav`);
        parts.push(part);
        const input =
          media.hasAudio && clip.volume > 0
            ? ["-ss", String(Math.round(clip.start * FPS) / FPS), "-i", file]
            : ["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`];
        await run([
          ...input,
          "-vn",
          "-af",
          `aresample=${SAMPLE_RATE},apad=whole_len=${partSamples},atrim=end_sample=${partSamples},asetpts=PTS-STARTPTS,volume=${clip.volume},afade=t=in:d=0.005,afade=t=out:st=${partDuration - 0.005}:d=0.005`,
          "-t",
          String(partDuration),
          "-ar",
          String(SAMPLE_RATE),
          "-ac",
          "2",
          "-c:a",
          "pcm_s24le",
          part,
        ]);
      }
      const list = path.join(work, "parts.txt");
      await fs.writeFile(
        list,
        parts
          .map((part) => `file '${part.replaceAll("'", "'\\''")}'`)
          .join("\n"),
      );
      await run([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-c:a",
        "copy",
        voice,
      ]);
    }

    const args = ["-i", videoPath, "-i", voice];
    if (project.musicId && project.musicVolume > 0) {
      const { file, media } = mediaPath(project.musicId);
      if (!media.hasAudio) throw new Error("The music source has no audio.");
      const music = path.join(work, "music.wav");
      // Finish the loop into finite PCM before muxing; a looping demuxer can
      // otherwise keep FFmpeg's multi-input mux process alive after output EOF.
      await run([
        "-stream_loop",
        "-1",
        "-i",
        file,
        "-vn",
        "-af",
        `aresample=${SAMPLE_RATE},atrim=end_sample=${samples},asetpts=PTS-STARTPTS,volume='${project.musicVolume}*max(0,min(1,min(t/0.5,(${duration}-t)/(2/3))))':eval=frame`,
        "-t",
        String(duration),
        "-ar",
        String(SAMPLE_RATE),
        "-ac",
        "2",
        "-c:a",
        "pcm_s24le",
        music,
      ]);
      args.push("-i", music);
      args.push(
        "-filter_complex",
        `[1:a][2:a]amix=inputs=2:duration=first:normalize=0,atrim=end_sample=${samples}[mix]`,
        "-map",
        "0:v:0",
        "-map",
        "[mix]",
      );
    } else {
      args.push("-map", "0:v:0", "-map", "1:a:0");
    }
    // Stage the mux so cancellation cannot leave a partly written final export.
    const completed = path.join(work, "completed.mp4");
    await run([
      ...args,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "2",
      "-t",
      String(duration),
      "-movflags",
      "+faststart",
      completed,
    ]);
    signal.throwIfAborted();
    await fs.copyFile(completed, outputPath, fs.constants.COPYFILE_EXCL);
    if (signal.aborted) {
      await fs.rm(outputPath, { force: true });
      signal.throwIfAborted();
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
