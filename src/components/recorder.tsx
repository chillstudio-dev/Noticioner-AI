"use client";
import { useState, useRef, useEffect } from "react";
import { AudioLines, Mic, Pause, Play, Square, Loader2 } from "lucide-react";
import { api } from "@/lib/client-api";
export function Recorder({
  id,
  disabled,
  transcriptionConfigured,
  transcriptionLabel,
  localTranscription,
  onTranscript,
  onError,
}: {
  id: string;
  disabled: boolean;
  transcriptionConfigured: boolean;
  transcriptionLabel: string;
  localTranscription: boolean;
  onTranscript: (s: string) => void;
  onError: (s: string) => void;
}) {
  const [state, setState] = useState<
      "idle" | "recording" | "paused" | "stopped"
    >("idle"),
    [consent, setConsent] = useState(false),
    [seconds, setSeconds] = useState(0),
    [blob, setBlob] = useState<Blob | null>(null),
    [busy, setBusy] = useState(false);
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
    api(`consultations/${id}/event`, "POST", { action }).catch(() => {});
  async function start() {
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Recording is unavailable in this browser. Use the transcript editor.",
        );
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const r = new MediaRecorder(media);
      recorder.current = r;
      chunks.current = [];
      setBlob(null);
      setSeconds(0);
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.onstop = () => {
        setBlob(new Blob(chunks.current, { type: r.mimeType }));
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
      r.start(1000);
      setState("recording");
      event("Recording started");
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      onError(
        e instanceof Error
          ? e.message
          : "Microphone permission denied. Use the transcript editor.",
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function upload() {
    if (!blob) return;
    setBusy(true);
    try {
      const f = new FormData();
      f.append(
        "audio",
        new File(
          [blob],
          "consultation." + (blob.type.includes("mp4") ? "mp4" : "webm"),
          { type: blob.type },
        ),
      );
      f.append("consultationId", id);
      f.append("consent", "true");
      const r = await api<{ text: string }>("transcribe", "POST", f);
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
          ? `${transcriptionLabel} · ${localTranscription ? "English · up to 3 minutes · audio stays on this server" : "audio sent to the configured provider"}`
          : "Transcription needs setup. Paste a transcript or configure audio in Settings."}
        <br />
        No speaker labels needed. AI infers roles from context when generating
        the note.
      </p>
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
            disabled={!consent || disabled || busy || !transcriptionConfigured}
            onClick={start}
          >
            <Mic size={16} />
            Record
          </button>
        )}
        {(state === "recording" || state === "paused") && (
          <>
            <button
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
            <button onClick={() => recorder.current?.stop()}>
              <Square size={15} />
              Stop
            </button>
          </>
        )}
        {blob && (
          <button
            className="primary"
            disabled={busy || disabled || !transcriptionConfigured}
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
    </div>
  );
}
