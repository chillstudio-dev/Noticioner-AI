import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const destination = resolve("data/models/ggml-base.en.bin");
const expected =
  "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
if ((await checksum(destination).catch(() => "")) === expected) {
  console.log("Whisper base.en model is already installed and verified.");
} else {
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.${process.pid}.part`;
  try {
    console.log("Downloading the English Whisper base model (148 MB)…");
    const response = await fetch(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
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
    console.log("Whisper base.en model installed; SHA-256 verified.");
  } finally {
    await rm(partial, { force: true });
  }
}
console.log(
  "Requires whisper-cli and ffmpeg on PATH. Enable with STT_PROVIDER=local in .env.local.",
);
