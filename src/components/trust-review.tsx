"use client";
import { useState } from "react";
import type { TrustFinding } from "@/lib/trust-engine";
export function TrustSources({ finding }: { finding: TrustFinding }) {
  return (
    <details className="trust-sources">
      <summary>
        {finding.sources.length} audited source references ·{" "}
        {finding.checkerVersion}
        {finding.model ? ` · ${finding.model}` : ""}
      </summary>
      {finding.sources.map((s, i) => (
        <div key={i}>
          <small>
            {s.label || s.type} · {s.recordId || s.id} · version {s.version}
            {s.verification ? ` · ${s.verification}` : ""}
          </small>
          <blockquote>{s.quote || "No value recorded."}</blockquote>
          {["transcript", "note", "document", "medication"].includes(
            s.type,
          ) && (
            <button
              type="button"
              onClick={() => {
                const local = document.getElementById(`evidence-${s.id}`);
                if (local) {
                  local.scrollIntoView({ behavior: "smooth", block: "center" });
                  local.focus();
                } else
                  window.dispatchEvent(
                    new CustomEvent("noticioner-source", {
                      detail: { type: s.type, id: s.recordId || s.id },
                    }),
                  );
              }}
            >
              Open source record
            </button>
          )}
        </div>
      ))}
      {finding.explanations.map((e, i) => (
        <p key={i}>{e}</p>
      ))}
    </details>
  );
}
export function TrustReview({
  findings,
  disabled,
  onResolve,
}: {
  findings: TrustFinding[];
  disabled?: boolean;
  onResolve?: (
    id: string,
    resolution: "Addressed" | "Not applicable",
    note: string,
  ) => Promise<unknown>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <div className="trust-review">
      <p className="small pr-muted">
        Trust Engine findings support review; they do not certify clinical
        correctness. Safety rules cover limited fictional examples only.
      </p>
      {findings.length === 0 && (
        <p>No audit is available. Run checks before approval.</p>
      )}
      {findings.map((f) => (
        <article className="trust-finding" key={f.id}>
          <strong>
            {
              {
                evidence: "EvidenceGuard",
                gaps: "Documentation gap",
                consistency: "Consistency",
                safety: "Synthetic safety",
              }[f.kind]
            }{" "}
            · {f.status}
          </strong>
          <p>{f.message}</p>
          <small>
            {f.required ? f.resolution : "No disposition required"}
            {f.statementId ? ` · statement ${f.statementId}` : ""}
          </small>
          <TrustSources finding={f} />
          {f.note && <p>Reviewer rationale: {f.note}</p>}
          {f.required && onResolve && (
            <div className="trust-disposition">
              <label>
                Review rationale
                <textarea
                  disabled={disabled}
                  value={notes[f.id] ?? f.note}
                  onChange={(e) =>
                    setNotes({ ...notes, [f.id]: e.target.value })
                  }
                  maxLength={1000}
                />
              </label>
              <div className="row wrap">
                {(["Addressed", "Not applicable"] as const).map(
                  (resolution) => (
                    <button
                      key={resolution}
                      disabled={
                        disabled || (notes[f.id] ?? f.note).trim().length < 3
                      }
                      onClick={() =>
                        void onResolve(f.id, resolution, notes[f.id] ?? f.note)
                      }
                    >
                      {resolution}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
