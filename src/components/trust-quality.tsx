"use client";
import { useEffect, useRef, useState } from "react";
import type { TrustEvaluation } from "@/lib/trust-evaluation";
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
export function TrustQuality({
  practice = false,
  configured,
}: {
  practice?: boolean;
  configured: boolean;
}) {
  const [runs, setRuns] = useState<TrustEvaluation[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    fetch(practice ? "/api/practice/quality" : "/api/bootstrap", {
      cache: "no-store",
    })
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok) throw new Error(value.error || "History unavailable");
        if (active)
          setRuns(
            (practice
              ? value.map((r: { results: TrustEvaluation }) => r.results)
              : value.evaluations
            ).filter((r: TrustEvaluation) => r.suite === "trust"),
          );
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [practice]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  async function run(mode: "deterministic" | "ai") {
    setBusy(true);
    setError("");
    setElapsed(0);
    controller.current = new AbortController();
    try {
      const r = await fetch(
        practice ? "/api/practice/quality" : "/api/evaluation/run",
        {
          method: "POST",
          signal: AbortSignal.any([
            controller.current.signal,
            AbortSignal.timeout(540000),
          ]),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suite: "trust", mode, consent }),
        },
      );
      const value = await r.json();
      if (!r.ok) throw new Error(value.error || "Evaluation failed");
      setRuns((old) => [value, ...old].slice(0, 20));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed.");
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  return (
    <section className="card pr-card trust-quality">
      <h2>Trust Engine Quality</h2>
      <p>
        24 deterministic fixtures, six per category. The optional provider suite
        audits eight fixed drafts in at most eight sequential calls. All cases
        are synthetic, author-written, development-visible, and not
        independently or clinically reviewed.
      </p>
      <p>
        No patient records are used. These measurements do not establish
        clinical accuracy, improved outcomes, or time saved.
      </p>
      <label className="row">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy}
        />
        I consent to send the eight synthetic cases to the configured provider.
      </label>
      <div className="row wrap">
        <button disabled={busy} onClick={() => void run("deterministic")}>
          Run 24 local checks
        </button>
        <button
          disabled={busy || !consent || !configured}
          onClick={() => void run("ai")}
        >
          Run 8 provider checks
        </button>
        {busy && (
          <button onClick={() => controller.current?.abort()}>
            Cancel evaluation
          </button>
        )}
      </div>
      {busy && (
        <p role="status">
          Evaluation in progress · {elapsed}s elapsed. Provider calls run
          sequentially and may take up to eight minutes. Per-case results appear
          on completion.
        </p>
      )}
      {error && (
        <p role="alert" className="error pr-error">
          {error}
        </p>
      )}
      {!runs.length && !busy && <p>No Trust evaluation recorded yet.</p>}
      {runs.map((run, i) => (
        <details key={run.createdAt + i} open={i === 0}>
          <summary>
            {run.mode} · {run.completed}/{run.sampleSize} cases completed ·{" "}
            {run.errors} errors · {new Date(run.createdAt).toLocaleString()}
          </summary>
          <p>
            {run.suiteVersion} · {run.checkerVersion} · {run.provider} /{" "}
            {run.model} · {(run.latencyMs / 1000).toFixed(2)}s
          </p>
          {run.errors > 0 && (
            <p className="error pr-error">
              Partial results: failed cases are recorded as errors; their
              missing expected findings count as false negatives. They are not
              successful cases.
            </p>
          )}
          <div className="trust-table">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>TP</th>
                  <th>FP</th>
                  <th>FN</th>
                  <th>Precision</th>
                  <th>Recall</th>
                  <th>F1</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { category: "Overall", ...run.overall },
                  ...run.byCategory,
                ].map((r) => (
                  <tr key={r.category}>
                    <th>{r.category}</th>
                    <td>{r.tp}</td>
                    <td>{r.fp}</td>
                    <td>{r.fn}</td>
                    <td>{percent(r.precision)}</td>
                    <td>{percent(r.recall)}</td>
                    <td>{percent(r.f1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small pr-muted">
            Matches require the same case, category, and target. Precision = TP
            / (TP + FP); recall = TP / (TP + FN); F1 is their harmonic mean. An
            empty denominator is reported as 0 by convention.
          </p>
          {run.examples.map((e) => (
            <details key={e.id}>
              <summary>
                {e.id} · {e.name} ·{" "}
                {e.error
                  ? "Error"
                  : `${e.metrics.tp} TP / ${e.metrics.fp} FP / ${e.metrics.fn} FN`}
              </summary>
              {e.error && <p>{e.error}</p>}
              <p>
                Expected: {e.expected.join(", ") || "No issue"}
                <br />
                Detected: {e.predicted.join(", ") || "No issue"}
                <br />
                Missed: {e.missing.join(", ") || "None"}
                <br />
                Extra: {e.extra.join(", ") || "None"}
                <br />
                Latency: {e.latencyMs}ms
              </p>
            </details>
          ))}
        </details>
      ))}
    </section>
  );
}
