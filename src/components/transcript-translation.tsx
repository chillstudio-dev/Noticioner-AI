"use client";
import { useEffect, useRef, useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { speechLanguages, type SpeechLanguage } from "@/lib/languages";

export function TranscriptTranslation({
  text,
  endpoint,
  configured,
  disabled = false,
  onError,
}: {
  text: string;
  endpoint: string;
  configured: boolean;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const [target, setTarget] = useState<SpeechLanguage>("en");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    text: string;
    source: string;
    targetLanguage: SpeechLanguage;
    model: string;
  } | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = result?.source === text;
  return (
    <section className="translation-panel" aria-label="Transcript translation">
      <h3>
        <Languages size={17} /> Translate transcript
      </h3>
      <p className="small">
        Compare an AI translation with your original. Translation never replaces
        or saves over the source.
      </p>
      {!configured && (
        <p className="small">
          Translation requires the configured AI provider.
        </p>
      )}
      <label className="recorder-language">
        Translate into
        <select
          aria-label="Translation language"
          value={target}
          disabled={busy || disabled}
          onChange={(event) => setTarget(event.target.value as SpeechLanguage)}
        >
          {speechLanguages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy || disabled}
          onChange={(event) => setConsent(event.target.checked)}
        />
        I am authorized to send this text to the configured AI provider for
        translation.
      </label>
      <button
        type="button"
        disabled={busy || disabled || !configured || !consent || !text.trim()}
        onClick={async () => {
          const source = text;
          setBusy(true);
          try {
            const draft = await api<{
              text: string;
              targetLanguage: SpeechLanguage;
              model: string;
            }>(endpoint, "POST", {
              sourceText: source,
              targetLanguage: target,
              consent,
            });
            if (mounted.current) setResult({ ...draft, source });
          } catch (error) {
            if (mounted.current)
              onError(
                error instanceof Error ? error.message : "Translation failed.",
              );
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        {busy ? (
          <Loader2 size={15} className="spin" />
        ) : (
          <Languages size={15} />
        )}
        {busy ? "Translating…" : "Translate"}
      </button>
      {result && !current && (
        <p role="status" className="small">
          The source has changed. Translate again to review the current text.
        </p>
      )}
      {result && current && (
        <div className="translation-result">
          <strong>
            Unreviewed translation ·{" "}
            {
              speechLanguages.find(
                (language) => language.code === result.targetLanguage,
              )?.label
            }
          </strong>
          <p className="small">
            Verify medication names, numbers, negation and clinical meaning
            against the original. Model: {result.model}.
          </p>
          <textarea
            aria-label="Translated transcript"
            readOnly
            value={result.text}
            rows={7}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(result.text);
              } catch {
                onError(
                  "Unable to copy automatically. Select the translation text and copy it manually.",
                );
              }
            }}
          >
            Copy translation
          </button>
        </div>
      )}
    </section>
  );
}
