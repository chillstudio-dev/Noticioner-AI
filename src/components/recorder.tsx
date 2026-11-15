"use client";
import { useState, useRef, useEffect } from "react";
import { AudioLines, Mic, Pause, Play, Square, Loader2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { speechLanguages, type SpeechLanguage } from "@/lib/languages";
export function Recorder({
  id,
  disabled,
  transcriptionConfigured,
  transcriptionLabel,
  localTranscription,
  transcriptionLanguages,
  transcribePath = "transcribe",
  eventPath,
  onTranscript,
  onError,
}: {
  id: string;
  disabled: boolean;
  transcriptionConfigured: boolean;
  transcriptionLabel: string;
  localTranscription: boolean;
  transcriptionLanguages?: SpeechLanguage[];
  transcribePath?: string;
  eventPath?: string | null;
  onTranscript: (s: string) => void;
  onError: (s: string) => void;
}) {
  const [state, setState] = useState<
      "idle" | "recording" | "paused" | "stopped"
    >("idle"),
    [consent, setConsent] = useState(false),
    [seconds, setSeconds] = useState(0),
    [blob, setBlob] = useState<Blob | null>(null),
    [busy, setBusy] = useState(false),
    [language, setLanguage] = useState<SpeechLanguage>("en"),
    [audioUrl, setAudioUrl] = useState("");
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const mounted = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]);
  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current && recorder.current.state !== "inactive") {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        recorder.current.onerror = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const event = (action: string) =>
    eventPath === null
      ? Promise.resolve()
      : api(eventPath || `consultations/${id}/event`, "POST", { action }).catch(
          () => {},
        );
  async function start() {
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Microphone recording requires Safari or another supported browser on localhost or HTTPS. You can also type a transcript.",
        );
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mimeType = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const r = mimeType
        ? new MediaRecorder(media, { mimeType })
        : new MediaRecorder(media);
      recorder.current = r;
      chunks.current = [];
      setBlob(null);
      setSeconds(0);
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.onstop = () => {
        const captured = new Blob(chunks.current, {
          type: r.mimeType || mimeType || chunks.current[0]?.type,
        });
        setBlob(captured.size ? captured : null);
        if (!captured.size)
          onError(
            "No audio was captured. Check microphone access and record again.",
          );
        setState("stopped");
        media.getTracks().forEach((t) => t.stop());
        event("Recording stopped");
      };
      r.onerror = () => {
        onError(
          "Recording was interrupted. Stop and retry, or type a transcript.",
        );
        media.getTracks().forEach((t) => t.stop());
        setState("stopped");
      };
      // Safari can emit its final MP4 data only on stop; collect that event too.
      r.start();
      setState("recording");
      event("Recording started");
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      const name = e instanceof Error ? e.name : "";
      onError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access is blocked. In Safari, open Settings for This Website → Microphone → Allow, and check macOS System Settings → Privacy & Security → Microphone. Then try Record again."
          : name === "NotFoundError"
            ? "No microphone was found. Connect or enable a microphone and try again."
            : name === "NotReadableError"
              ? "The microphone is unavailable or in use. Close other recording apps and try again."
              : e instanceof Error
                ? e.message
                : "Unable to start the microphone. Try again or type a transcript.",
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function upload() {
    if (!blob || !consent) return;
    setBusy(true);
    try {
      const f = new FormData();
      f.append(
        "audio",
        new File(
          [blob],
          "consultation." +
            (blob.type.includes("mp4")
              ? "mp4"
              : blob.type.includes("ogg")
                ? "ogg"
                : "webm"),
          { type: blob.type.split(";")[0] },
        ),
      );
      f.append("consultationId", id);
      f.append("consent", "true");
      f.append("language", language);
      const r = await api<{ text: string }>(transcribePath, "POST", f);
      if (mounted.current) onTranscript(r.text);
    } catch (e) {
      if (mounted.current) onError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="recorder">
      <div className="row between">
        <span className="row">
          <AudioLines size={20} />
          <strong>
            {state === "recording"
              ? "Recording synthetic audio"
              : state === "paused"
                ? "Recording paused"
                : "Audio capture"}
          </strong>
        </span>
        <span className="mono">
          {Math.floor(seconds / 60)
            .toString()
            .padStart(2, "0")}
          :{(seconds % 60).toString().padStart(2, "0")}
        </span>
      </div>
      <p className="small">
        {transcriptionConfigured
          ? `${transcriptionLabel} · ${localTranscription ? "up to 3 minutes · audio stays on this server" : "audio sent to the configured provider"}`
          : "Transcription needs setup. You can still record, listen and download your audio, or paste a transcript."}
        <br />
        No speaker labels needed. AI infers roles from context when generating
        the note.
      </p>
      <label className="recorder-language">
        Spoken language
        <select
          aria-label="Spoken language"
          value={language}
          disabled={
            busy || state === "recording" || state === "paused" || !!blob
          }
          onChange={(e) => setLanguage(e.target.value as SpeechLanguage)}
        >
          {speechLanguages.map((item) => (
            <option
              key={item.code}
              value={item.code}
              disabled={
                !!transcriptionLanguages &&
                !transcriptionLanguages.includes(item.code)
              }
            >
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {transcriptionLanguages?.length === 1 && (
        <p className="small">
          The server has an English-only model. Install the multilingual model
          to enable the other languages.
        </p>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={state === "recording" || state === "paused"}
        />
        I consent to recording synthetic demonstration audio only.
      </label>
      <div className="row wrap">
        {(state === "idle" || state === "stopped") && (
          <button
            type="button"
            disabled={!consent || disabled || busy}
            onClick={start}
          >
            <Mic size={16} />
            {busy
              ? blob
                ? "Processing audio…"
                : "Waiting for microphone…"
              : "Record"}
          </button>
        )}
        {(state === "recording" || state === "paused") && (
          <>
            <button
              type="button"
              onClick={() => {
                if (state === "recording") {
                  recorder.current?.pause();
                  setState("paused");
                  event("Recording paused");
                } else {
                  recorder.current?.resume();
                  setState("recording");
                  event("Recording resumed");
                }
              }}
            >
              {state === "recording" ? <Pause size={16} /> : <Play size={16} />}{" "}
              {state === "recording" ? "Pause" : "Resume"}
            </button>
            <button type="button" onClick={() => recorder.current?.stop()}>
              <Square size={15} />
              Stop
            </button>
          </>
        )}
        {blob && (
          <button
            type="button"
            className="primary"
            disabled={busy || disabled || !consent || !transcriptionConfigured}
            onClick={upload}
          >
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <AudioLines size={16} />
            )}
            {busy
              ? "Transcribing…"
              : localTranscription
                ? "Transcribe locally"
                : "Transcribe audio"}
          </button>
        )}
      </div>
      {blob && (
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => {
            setBlob(null);
            setState("idle");
            setSeconds(0);
          }}
        >
          Discard recording
        </button>
      )}
      {!consent && (
        <p className="small">
          Check the recording consent box to enable Record.
        </p>
      )}
      {blob && audioUrl && (
        <div className="recorder-playback">
          <audio controls src={audioUrl} aria-label="Recorded audio preview" />
          <a
            href={audioUrl}
            download={`consultation.${blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm"}`}
          >
            Download recording
          </a>
        </div>
      )}
    </div>
  );
}
