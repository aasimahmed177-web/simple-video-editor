import path from "node:path";
import fs from "node:fs";
import {
  downloadWhisperModel,
  installWhisperCpp,
} from "@remotion/install-whisper-cpp";

const to = path.resolve(".local/whisper.cpp");
fs.mkdirSync(path.dirname(to), { recursive: true });
await installWhisperCpp({ to, version: "1.5.5", printOutput: true });
await downloadWhisperModel({ model: "small.en", folder: to });
console.log("English transcription is ready. Audio stays on this computer.");
