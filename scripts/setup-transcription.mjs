import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const destination = resolve("data/models/ggml-base.bin");
const expected =
  "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
if ((await checksum(destination).catch(() => "")) === expected) {
  console.log("Multilingual Whisper base model is already installed and verified.");
} else {
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.${process.pid}.part`;
  try {
    console.log("Downloading the multilingual Whisper base model (148 MB)…");
    const response = await fetch(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
      { signal: AbortSignal.timeout(300000) },
    );
    if (!response.ok || !response.body)
      throw new Error(`Download failed (${response.status}).`);
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(partial, { flags: "wx", mode: 0o600 }),
    );
    if ((await checksum(partial)) !== expected)
      throw new Error(
        "Model checksum did not match; download was not installed.",
      );
    await rename(partial, destination);
    console.log("Multilingual Whisper base model installed; SHA-256 verified.");
  } finally {
    await rm(partial, { force: true });
  }
}
console.log(
  "Requires whisper-cli and ffmpeg on PATH. Enable with STT_PROVIDER=local in .env.local.",
);
