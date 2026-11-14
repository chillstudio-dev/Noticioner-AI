import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localTranscriptionStatus,
  transcribeLocally,
} from "../src/lib/local-transcription";

const audio = new File(["synthetic audio fixture"], "../../ignored.webm", {
  type: "audio/webm",
});
async function fixture(
  options: {
    silent?: boolean;
    seconds?: number;
    fail?: boolean;
    delay?: boolean;
  },
  run: () => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "cliniscribe-stt-test-"));
  const env = {
    TMPDIR: root,
    LOCAL_WHISPER_MODEL: join(root, "model.bin"),
    LOCAL_WHISPER_BIN: join(root, "whisper"),
    FFMPEG_BIN: join(root, "ffmpeg"),
    ANTHROPIC_API_KEY: "must-not-reach-audio-processes",
  };
  const saved = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    await writeFile(env.LOCAL_WHISPER_MODEL, "model fixture");
    await writeFile(
      env.FFMPEG_BIN,
      `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.ANTHROPIC_API_KEY) process.exit(77);
if (${!!options.fail}) { console.error('internal diagnostic must not reach user'); process.exit(1); }
const bytes = ${options.seconds || 1} * 16000 * 2;
const wav = Buffer.alloc(44 + bytes);
wav.write('RIFF'); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(bytes, 40);
for (let i=44; i<wav.length; i+=2) wav.writeInt16LE(${options.silent ? 0 : 2000}, i);
fs.writeFileSync(process.argv.at(-1), wav);
`,
      { mode: 0o700 },
    );
    await writeFile(
      env.LOCAL_WHISPER_BIN,
      `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.ANTHROPIC_API_KEY) process.exit(77);
const output = process.argv[process.argv.indexOf('-of') + 1];
setTimeout(() => fs.writeFileSync(output + '.txt', ' A synthetic headache transcript. '), ${options.delay ? 5000 : 0});
`,
      { mode: 0o700 },
    );
    await run();
    assert.deepEqual(
      (await readdir(root)).filter((name) =>
        name.startsWith("cliniscribe-audio-"),
      ),
      [],
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

test("local transcription isolates files, omits provider secrets from tools, and removes temporary audio", () =>
  fixture({}, async () => {
    assert.equal(localTranscriptionStatus().configured, true);
    assert.equal(
      await transcribeLocally(audio),
      "A synthetic headache transcript.",
    );
  }));
test("local transcription reports missing setup without attempting conversion", () =>
  fixture({}, async () => {
    process.env.LOCAL_WHISPER_MODEL += ".missing";
    assert.equal(localTranscriptionStatus().configured, false);
    await assert.rejects(() => transcribeLocally(audio), /not ready/);
  }));
test("decode errors are actionable and temporary audio is removed", () =>
  fixture({ fail: true }, async () => {
    await assert.rejects(
      () => transcribeLocally(audio),
      (error) => {
        assert.match((error as Error).message, /could not be decoded/);
        assert.ok(!(error as Error).message.includes("internal diagnostic"));
        return true;
      },
    );
  }));
test("silence and recordings over three minutes are rejected before inference", async () => {
  await fixture({ silent: true }, async () => {
    await assert.rejects(() => transcribeLocally(audio), /No audible speech/);
  });
  await fixture({ seconds: 181 }, async () => {
    await assert.rejects(() => transcribeLocally(audio), /up to 3 minutes/);
  });
});
test("local inference rejects concurrent requests and releases its slot after cancellation", () =>
  fixture({ delay: true }, async () => {
    const controller = new AbortController();
    const pending = transcribeLocally(audio, controller.signal);
    const rejection = assert.rejects(pending, /could not/);
    await assert.rejects(() => transcribeLocally(audio), /already processing/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();
    await rejection;
    const stopped = new AbortController();
    stopped.abort();
    await assert.rejects(
      () => transcribeLocally(audio, stopped.signal),
      /could not be decoded/,
    );
  }));
