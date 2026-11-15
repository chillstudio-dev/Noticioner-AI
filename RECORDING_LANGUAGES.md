# Recording and speech languages

Recording is available in personal consultations and in shared-practice Notes for editors. Check the synthetic-audio consent box, select **Spoken language**, choose **Record**, then **Stop** and **Transcribe locally** (or **Transcribe audio**). Review the resulting transcript before saving. Shared-practice transcription appends text to the unsaved note; it does not approve or automatically save a note. View-only users cannot submit audio, including through direct API calls.

Supported selections: English (`en`), French (`fr`), Mandarin (`zh`), Malay (`ms`), Japanese (`ja`), Korean (`ko`), Spanish (`es`), Tamil (`ta`), Danish (`da`). These are transcription language selections; interface labels remain in English. AI instructions preserve source-language statement text and verbatim evidence quotes. The English keyword baseline is not a multilingual implementation. Report PDF exports now embed licensed Noto fonts and preserve supported native-script text; see [DOCTOR_PORTAL_TRANSLATION.md](DOCTOR_PORTAL_TRANSLATION.md) for translation and report updates.

## Recording fixes

Audio capture no longer depends on transcription-provider readiness. You can listen to and download captured audio before transcription is configured. The recorder selects a supported container, including Safari MP4, captures the final stop event, provides playback/download/discard, and reports permission/device errors with recovery steps. Language selection stays fixed until the recording is discarded so saved audio is not accidentally labeled with a different language. Audio remains in browser memory until leaving the recorder; download anything you need to retain.

On Safari, allow Microphone in **Settings for This Website** and in **macOS System Settings → Privacy & Security → Microphone**, if prompted. Use localhost or HTTPS. Permission must be granted by the user. The recorder displays a consent reminder and microphone permission errors separately from transcription setup.

## Local setup

Install whisper.cpp and FFmpeg, then run `npm run setup:transcription`. The script downloads the approximately 148 MB multilingual `ggml-base.bin` and verifies its SHA-256 before installation. Set:

```dotenv
STT_PROVIDER=local
LOCAL_WHISPER_MODEL=./data/models/ggml-base.bin
LOCAL_WHISPER_BIN=whisper-cli
FFMPEG_BIN=ffmpeg
```

Use explicit local executable paths when the tools are not on the server's PATH. Restart after changing configuration. Models with `.en` in the filename are English-only; the app restricts their selector and rejects other languages on the server. Local processing remains limited to three-minute clips, one job at a time. Audio tools receive no AI provider secrets; temporary files are removed. There is no automatic cloud fallback.

This machine's ignored local configuration previously referenced another computer's paths. The local tools were repaired: Whisper was rebuilt against this Mac's SDK with a portable CPU configuration; FFmpeg was installed into the ignored project tools directory after package-integrity verification; the multilingual model was downloaded and checksum-verified. These local tools and secrets are not distributed through Git.

The configured cloud adapter forwards the validated language code to its transcription endpoint. Compatibility and quality depend on the selected provider/model. Native-script text is retained as Unicode in the application and database. Medical terminology, accents, mixed-language speech and speaker attribution still need human review; adding language choices does not establish clinical accuracy.

Implementation references: [WebKit MediaRecorder](https://webkit.org/blog/11353/), [whisper.cpp model documentation](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md), [Whisper languages](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py).

## Verification, 15 November 2026

The end-of-round read-only review scored the implementation **8.3/10** (functionality 8.4, UX 8.0, architecture 8.4, security 8.5), with no blockers for the documented synthetic-data scope. A follow-up tightened consent so unchecking consent after capture disables transcription and prevents submission.

Lint, typecheck and production build passed. General tests: 41 passed, 2 database-specific tests skipped in that runner. Isolated PostgreSQL tests: 7 passed, including shared transcription success, view-only denial and access downgrade during transcription preventing the result from being returned. Browser tests: 9 passed across shared practice and recording; recording tests use mocked microphone/MediaRecorder and API responses to cover the MP4 stop event, pause/resume, preview/download, language forwarding, Unicode text, missing transcription configuration and permission errors. They do not establish physical microphone behavior on this user's Safari.

Actual local speech processing was exercised with synthetic macOS TTS audio for all eight requested languages, converted to MP4 and transcribed through the installed FFmpeg/Whisper pipeline. Every example produced nonempty text in its language. French, Malay, Japanese and Spanish matched the short supplied wording closely; punctuation/script variations occurred in other examples, and Danish contained substantial word errors. This one-example-per-language smoke check is not an accuracy benchmark. A synthetic French MP4 also passed the running production HTTP endpoint, and its disposable workspace was deleted afterward. Synthetic smoke artifacts are retained locally under the ignored `.tools` directory.
