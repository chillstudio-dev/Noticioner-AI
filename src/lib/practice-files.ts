import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PracticeError } from "./practice-store";
const execute = promisify(execFile);
function key() {
  const value = process.env.PRACTICE_FILE_KEY || "";
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value)
    throw new PracticeError(
      503,
      "Encrypted document storage is not configured.",
    );
  return decoded;
}
export function fileStatus() {
  let configured = false;
  try {
    key();
    configured = true;
  } catch {}
  return {
    configured,
    pdfEnabled: configured && !!process.env.PRACTICE_SCANNER_BIN,
    maxBytes: 5 * 1024 * 1024,
  };
}
export async function prepareDocument(file: File) {
  const secret = key();
  if (!file.size || file.size > 5 * 1024 * 1024)
    throw new PracticeError(400, "Files must be between 1 byte and 5 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120);
  let extracted: string | null = null;
  let mime: string;
  if (/\.txt$/i.test(filename) && ["", "text/plain"].includes(file.type)) {
    try {
      extracted = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new PracticeError(400, "Text documents must use UTF-8.");
    }
    if (!extracted.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(extracted))
      throw new PracticeError(400, "The file is not plain text.");
    mime = "text/plain";
  } else if (
    /\.pdf$/i.test(filename) &&
    file.type === "application/pdf" &&
    bytes.subarray(0, 5).toString() === "%PDF-"
  ) {
    const scanner = process.env.PRACTICE_SCANNER_BIN;
    if (!scanner || !isAbsolute(scanner))
      throw new PracticeError(
        503,
        "PDF scanning is not configured; upload a UTF-8 text document.",
      );
    const directory = await mkdtemp(join(tmpdir(), "practice-quarantine-"));
    try {
      const path = join(directory, "document.pdf");
      await writeFile(path, bytes, { mode: 0o600 });
      try {
        await execute(scanner, ["--no-summary", path], {
          timeout: 15000,
          maxBuffer: 16384,
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
          },
        });
      } catch {
        throw new PracticeError(
          422,
          "Document scanning failed or rejected the file. Nothing was stored.",
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    mime = "application/pdf";
  } else
    throw new PracticeError(
      400,
      "Supported files: UTF-8 .txt and scanned .pdf.",
    );
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", secret, nonce);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    filename,
    mime,
    bytes: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    encrypted: Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]),
    extracted,
  };
}
export function decryptDocument(payload: Buffer) {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      payload.subarray(0, 12),
    );
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]);
  } catch {
    throw new PracticeError(
      503,
      "Document could not be decrypted. Contact the practice administrator.",
    );
  }
}
