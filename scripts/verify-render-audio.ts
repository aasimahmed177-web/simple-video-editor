import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import ffprobe from "@ffprobe-installer/ffprobe";
import { muxProjectAudio } from "../server/render-audio";
import { newProject } from "../src/ads/model";

// Real encode/mux regression using only generated noise, tones, and a color card.
const exec = promisify(execFile);
const rate = 48_000;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "adscade-audio-check-"));
const run = (binary: string, args: string[]) =>
  exec(binary, args, {
    encoding: "buffer",
    maxBuffer: 8_000_000,
    timeout: 30_000,
    killSignal: "SIGKILL",
  });
const ff = (args: string[]) =>
  run(ffmpeg!, ["-v", "error", "-nostdin", ...args]);
const file = (name: string) => path.join(dir, name);

function wave(samples: Int16Array) {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.byteLength, 40);
  const pcm = Buffer.alloc(samples.byteLength);
  samples.forEach((sample, i) => pcm.writeInt16LE(sample, i * 2));
  return Buffer.concat([header, pcm]);
}

async function decode(name: string) {
  const { stdout } = await ff([
    "-i",
    file(name),
    "-vn",
    "-ar",
    String(rate),
    "-ac",
    "2",
    "-f",
    "s16le",
    "-",
  ]);
  return Int16Array.from({ length: stdout.length / 2 }, (_, i) =>
    stdout.readInt16LE(i * 2),
  );
}

// Search ±50ms directly against independent source samples; no ASR timing involved.
function delay(
  actual: Int16Array,
  expected: Int16Array,
  outputStart: number,
  sourceStart: number,
  length: number,
) {
  let bestLag = 0,
    bestScore = -Infinity;
  for (let lag = -2400; lag <= 2400; lag++) {
    let score = 0;
    for (let i = 3000; i < length - 3000; i += 64)
      score +=
        (actual[(outputStart + i + lag) * 2] ?? 0) *
        expected[(sourceStart + i) * 2];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestLag;
}

try {
  assert.ok(ffmpeg, "FFmpeg is required");
  let seed = 1729;
  const state = [0, 0];
  const source = Int16Array.from({ length: rate * 3 * 2 }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const channel = i % 2;
    state[channel] = state[channel] * 0.95 + (seed / 0xffffffff - 0.5) * 0.05;
    return Math.round(state[channel] * 24_000);
  });
  const music = Int16Array.from({ length: (rate / 5) * 2 }, (_, i) =>
    Math.round(1000 * Math.sin((Math.floor(i / 2) * Math.PI * 394) / rate)),
  );
  await fs.writeFile(file("source.wav"), wave(source));
  await fs.writeFile(file("music.wav"), wave(music));
  await ff([
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x120:r=30:d=3",
    "-i",
    file("source.wav"),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "pcm_s16le",
    file("source.mov"),
  ]);
  await ff([
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x120:r=30",
    "-frames:v",
    "53",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-an",
    file("muted.mp4"),
  ]);

  const project = newProject();
  project.media = [
    {
      id: "source",
      name: "Generated video",
      file: "source.mov",
      duration: 3,
      hasAudio: true,
      kind: "video",
      width: 160,
      height: 120,
    },
    {
      id: "prepared",
      name: "Generated voice",
      file: "source.wav",
      duration: 3,
      hasAudio: true,
      kind: "audio",
      width: 0,
      height: 0,
    },
    {
      id: "music",
      name: "Generated tone",
      file: "music.wav",
      duration: 0.2,
      hasAudio: true,
      kind: "audio",
      width: 0,
      height: 0,
    },
  ];
  const common = {
    mediaId: "source",
    fit: "cover" as const,
    rotation: 0 as const,
    x: 50,
    y: 50,
  };
  project.clips = [
    { ...common, id: "one", start: 4 / 30, end: 26 / 30, volume: 0.5 },
    { ...common, id: "two", start: 37 / 30, end: 68 / 30, volume: 1 },
  ];
  const mux = (name: string, signal = AbortSignal.timeout(30_000)) =>
    muxProjectAudio({
      project,
      videoPath: file("muted.mp4"),
      outputPath: file(name),
      tempDir: dir,
      mediaDir: dir,
      signal,
    });

  await mux("raw.mp4");
  const raw = await decode("raw.mp4");
  assert.ok(
    Math.abs(delay(raw, source, 0, 4 * 1600, 22 * 1600)) <= 2,
    "First clip exceeds two samples of audio delay",
  );
  assert.ok(
    Math.abs(delay(raw, source, 22 * 1600, 37 * 1600, 31 * 1600)) <= 2,
    "Second clip exceeds two samples of audio delay",
  );
  for (const [offset, start, length, volume] of [
    [0, 4 * 1600, 22 * 1600, 0.5],
    [22 * 1600, 37 * 1600, 31 * 1600, 1],
  ]) {
    for (const channel of [0, 1]) {
      let dot = 0,
        energy = 0;
      for (let i = 1000; i < length - 1000; i++) {
        const sample = source[(start + i) * 2 + channel];
        dot += raw[(offset + i) * 2 + channel] * sample;
        energy += sample * sample;
      }
      assert.ok(
        Math.abs(dot / energy - volume) < 0.08,
        `Clip volume or channel mapping changed: expected ${volume}, measured ${dot / energy}`,
      );
    }
  }
  project.voiceId = "prepared";
  project.musicId = "music";
  project.musicVolume = 0.2;
  await mux("prepared-music.mp4");
  assert.ok(
    Math.abs(
      delay(await decode("prepared-music.mp4"), source, 0, 0, 53 * 1600),
    ) <= 2,
    "Prepared voice exceeds two samples of audio delay",
  );
  project.voiceId = null;
  project.musicId = null;
  project.clips[0].volume = 0;
  project.media[0].hasAudio = false;
  await mux("silence.mp4");
  assert.ok(
    (await decode("silence.mp4")).every((sample) => sample === 0),
    "Muted or silent clips gained audio",
  );

  for (const name of ["raw.mp4", "prepared-music.mp4", "silence.mp4"]) {
    const { stdout } = await run(ffprobe.path, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,duration,channels,nb_frames",
      "-of",
      "json",
      file(name),
    ]);
    const streams = JSON.parse(stdout.toString()).streams;
    assert.ok(
      streams.some(
        (s: { codec_name: string; nb_frames: string }) =>
          s.codec_name === "h264" && s.nb_frames === "53",
      ),
    );
    assert.ok(
      streams.some(
        (s: { codec_name: string; channels: number; duration: string }) =>
          s.codec_name === "aac" &&
          s.channels === 2 &&
          Math.abs(Number(s.duration) - 53 / 30) < 0.01,
      ),
    );
  }
  await assert.rejects(() => mux("muted.mp4"), /must differ/);
  await assert.rejects(() => mux("aborted.mp4", AbortSignal.abort()));
  console.log(
    "Audio regression passed: two-clip sync within two samples, volumes/channels, prepared voice + looping music, silence, duration, and cancellation/path guards.",
  );
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
