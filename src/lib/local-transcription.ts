import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  languageSchema,
  speechLanguages,
  type SpeechLanguage,
} from "./languages";

const execute = promisify(execFile);
let running = false;

function executable(name: string) {
  const candidates = name.includes("/")
    ? [resolve(/* turbopackIgnore: true */ name)]
    : (process.env.PATH || "").split(delimiter).map((dir) => join(dir, name));
  return candidates.find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function configuration() {
  return {
    model: resolve(
      /* turbopackIgnore: true */
      process.env.LOCAL_WHISPER_MODEL || "data/models/ggml-base.bin",
    ),
    whisper: executable(process.env.LOCAL_WHISPER_BIN || "whisper-cli"),
    ffmpeg: executable(process.env.FFMPEG_BIN || "ffmpeg"),
  };
}

export function localTranscriptionStatus() {
  const config = configuration();
  let readable = false;
  try {
    accessSync(config.model, constants.R_OK);
    readable = true;
  } catch {}
  return {
    configured: !!(readable && config.whisper && config.ffmpeg),
    languages: /\.en(?:[.-]|$)/i.test(basename(config.model))
      ? (["en"] as SpeechLanguage[])
      : speechLanguages.map((language) => language.code),
    model: basename(config.model)
      .replace(/^ggml-/, "")
      .replace(/\.bin$/, ""),
  };
}

// FFmpeg produces mono 16 kHz signed 16-bit PCM. Read the data chunk rather
// than assuming a fixed WAV header length; metadata chunks can vary.
function inspectPcm(wav: Buffer) {
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString("ascii", offset, offset + 4) === "data") {
      const start = offset + 8;
      if (size % 2 || start + size > wav.length)
        throw new Error("The audio could not be decoded. Please record again.");
      if (size > 180 * 16000 * 2)
        throw new Error(
          "Local transcription supports recordings up to 3 minutes. Please record a shorter clip.",
        );
      let energy = 0;
      for (let n = start; n < start + size; n += 2) {
        const value = wav.readInt16LE(n) / 32768;
        energy += value * value;
      }
      if (!size || Math.sqrt(energy / (size / 2)) < 0.0005)
        throw new Error(
          "No audible speech was detected. Check your microphone and record again.",
        );
      return;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("The audio could not be decoded. Please record again.");
}

export async function transcribeLocally(
  audio: File,
  signal?: AbortSignal,
  language: SpeechLanguage = "en",
) {
  languageSchema.parse(language);
  const config = configuration();
  if (!localTranscriptionStatus().configured)
    throw new Error(
      "Local transcription is not ready. Install whisper.cpp and FFmpeg, then run npm run setup:transcription on the server.",
    );
  if (!localTranscriptionStatus().languages.includes(language))
    throw new Error(
      "This local model only supports English. Install the multilingual model with npm run setup:transcription and update LOCAL_WHISPER_MODEL.",
    );
  if (running)
    throw new Error(
      "Local transcription is already processing a recording. Please retry when it finishes.",
    );
  if (!audio.size || audio.size > 20 * 1024 * 1024)
    throw new Error("Audio must be between 1 byte and 20 MB.");
  running = true;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "noticioner-audio-"));
    const input = join(directory, "recording"),
      wav = join(directory, "recording.wav"),
      output = join(directory, "transcript");
    await writeFile(input, Buffer.from(await audio.arrayBuffer()), {
      mode: 0o600,
    });
    const boundedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(105000)])
      : AbortSignal.timeout(105000);
    const options = {
      signal: boundedSignal,
      killSignal: "SIGKILL" as const,
      maxBuffer: 1024 * 1024,
      // Audio tools do not need the application's provider credentials.
      env: {
        PATH: process.env.PATH,
        TMPDIR: tmpdir(),
        LANG: "en_US.UTF-8",
        NODE_ENV: process.env.NODE_ENV || "production",
      },
    };
    try {
      await execute(
        config.ffmpeg!,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "matroska,webm,mov,mp3,wav,ogg",
          "-i",
          input,
          "-t",
          "181",
          "-vn",
          "-map_metadata",
          "-1",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          wav,
        ],
        { ...options, timeout: 20000 },
      );
    } catch {
      throw new Error(
        "The recording could not be decoded. Try a new recording or paste a transcript.",
      );
    }
    inspectPcm(await readFile(wav));
    try {
      await execute(
        config.whisper!,
        [
          "-m",
          config.model,
          "-f",
          wav,
          "-l",
          language,
          "-otxt",
          "-of",
          output,
          "-nt",
          "-np",
          "-t",
          "4",
        ],
        { ...options, timeout: 90000 },
      );
    } catch {
      throw new Error(
        "Local transcription could not finish. Retry with a shorter recording or paste a transcript.",
      );
    }
    const text = (await readFile(`${output}.txt`, "utf8"))
      .replace(/\[(?:BLANK_AUDIO|SILENCE|NO_SPEECH)\]/gi, "")
      .trim();
    if (!text)
      throw new Error(
        "No speech was recognized. Check your microphone and record again.",
      );
    return text;
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      running = false;
    }
  }
}
