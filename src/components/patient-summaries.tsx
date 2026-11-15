"use client";
import { useEffect, useState } from "react";
import type { PatientSummary, TrustAudit } from "@/lib/trust-engine";
import { TrustReview } from "./trust-review";
type RecordSummary = {
  id: string;
  version: number;
  source_version: number;
  source_note_id?: string;
  status: string;
  content: PatientSummary;
  trust: TrustAudit;
  stale?: boolean;
};
type Source = { id: string; version: number; label: string };
export function PatientSummaries({
  endpoint,
  sources,
  canWrite,
  canApprove,
  personal = false,
  configured,
}: {
  endpoint: string;
  sources: Source[];
  canWrite: boolean;
  canApprove: boolean;
  personal?: boolean;
  configured: boolean;
}) {
  const [records, setRecords] = useState<RecordSummary[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [selected, setSelected] = useState(""),
    [edit, setEdit] = useState<{ id: string; content: PatientSummary } | null>(
      null,
    ),
    [notice, setNotice] = useState("");
  async function call(path: string, method = "GET", body?: unknown) {
    const r = await fetch(endpoint + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(240000),
    });
    const v = await r.json();
    if (!r.ok) throw new Error(v.error || "Request failed");
    return v;
  }
  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw new Error(v.error);
        if (active) setRecords(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setRecords(await call(""));
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const source = sources.find((s) => s.id === (selected || sources[0]?.id));
  return (
    <section className="card pr-card patient-summaries">
      <h2>Patient-friendly summaries</h2>
      <p>
        English plain-language drafts from one approved note. A clinician must
        review and approve each summary. Copy and print become available after
        approval; nothing is sent automatically.
      </p>
      {error && (
        <p role="alert" className="error pr-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && (
        <p role="status">
          Working… generation and the separate audit may take several minutes.
        </p>
      )}
      {canWrite && (
        <div className="trust-generate">
          <label>
            Approved source note
            <select
              disabled={busy}
              value={source?.id || ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="" disabled>
                Select an approved note
              </option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · version {s.version}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I consent to send this approved note to the configured provider for
            summary generation and audit.
          </label>
          <button
            disabled={busy || !source || !consent || !configured}
            onClick={() =>
              void act(() =>
                call("", "POST", {
                  sourceNoteId: source!.id,
                  sourceVersion: source!.version,
                  consent: true,
                }),
              )
            }
          >
            Generate patient summary
          </button>
          {!configured && <p>AI provider not configured.</p>}
        </div>
      )}
      {!records.length && <p>No patient summaries yet.</p>}
      {records.map((r) => (
        <article key={r.id} className="trust-summary">
          <div className="row between">
            <h3>Patient summary · {r.status}</h3>
            <small>
              Source version {r.source_version} · summary version {r.version}
            </small>
          </div>
          {r.stale && (
            <p className="error pr-error">
              Source changed. Generate a new summary before approval or export.
            </p>
          )}
          {(edit?.id === r.id ? edit.content : r.content).paragraphs.map(
            (p, i) => (
              <div key={p.id} className="trust-paragraph">
                {edit?.id === r.id ? (
                  <>
                    <label>
                      Paragraph {i + 1}
                      <textarea
                        value={p.text}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            content: {
                              paragraphs: edit.content.paragraphs.map((v, j) =>
                                j === i ? { ...v, text: e.target.value } : v,
                              ),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Exact supporting quote
                      <textarea
                        value={p.evidence[0]?.quote || ""}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            content: {
                              paragraphs: edit.content.paragraphs.map((v, j) =>
                                j === i
                                  ? {
                                      ...v,
                                      evidence: e.target.value
                                        ? [
                                            {
                                              segmentId:
                                                r.source_note_id ||
                                                sources[0]?.id ||
                                                "",
                                              quote: e.target.value,
                                            },
                                          ]
                                        : [],
                                    }
                                  : v,
                              ),
                            },
                          })
                        }
                      />
                    </label>
                    <button
                      onClick={() =>
                        setEdit({
                          ...edit,
                          content: {
                            paragraphs: edit.content.paragraphs.filter(
                              (_, j) => j !== i,
                            ),
                          },
                        })
                      }
                    >
                      Remove paragraph
                    </button>
                  </>
                ) : (
                  <>
                    <p>{p.text}</p>
                    <details>
                      <summary>Paragraph sources</summary>
                      {p.evidence.map((e, j) => (
                        <blockquote key={j}>
                          {e.quote}
                          <small> · {e.segmentId}</small>
                        </blockquote>
                      ))}
                    </details>
                  </>
                )}
              </div>
            ),
          )}
          {canWrite && r.status === "draft" && !r.stale && (
            <div className="row wrap">
              {edit?.id === r.id ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      setEdit({
                        ...edit,
                        content: {
                          paragraphs: [
                            ...edit.content.paragraphs,
                            { id: crypto.randomUUID(), text: "", evidence: [] },
                          ],
                        },
                      })
                    }
                  >
                    Add paragraph
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        call("/" + r.id, "PATCH", {
                          version: r.version,
                          content: edit.content,
                        }),
                      )
                    }
                  >
                    Save and rerun checks
                  </button>
                  <button disabled={busy} onClick={() => setEdit(null)}>
                    Cancel edit
                  </button>
                </>
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    setEdit({ id: r.id, content: structuredClone(r.content) })
                  }
                >
                  Edit summary
                </button>
              )}
              <button
                disabled={busy || !consent || !configured || !!edit}
                onClick={() =>
                  void act(() =>
                    call("/" + r.id + "/audit", "POST", {
                      version: r.version,
                      consent: true,
                    }),
                  )
                }
              >
                Retry semantic audit
              </button>
            </div>
          )}
          <TrustReview
            findings={r.trust.findings}
            disabled={busy || !!edit || !!r.stale || r.status === "approved"}
            onResolve={
              canApprove && r.status === "draft"
                ? (id, resolution, note) =>
                    act(() =>
                      call("/" + r.id + "/findings", "PATCH", {
                        version: r.version,
                        id,
                        resolution,
                        note,
                      }),
                    )
                : undefined
            }
          />
          {canApprove && r.status === "draft" && (
            <button
              disabled={
                busy ||
                !!edit ||
                !!r.stale ||
                r.trust.findings.some(
                  (f) =>
                    f.required &&
                    (f.resolution === "Open" || f.note.trim().length < 3),
                )
              }
              onClick={() => {
                if (
                  window.confirm(
                    "I reviewed every paragraph and source and approve this patient summary" +
                      (personal ? " in the simulated workspace." : "."),
                  )
                )
                  void act(() =>
                    call("/" + r.id + "/approve", "POST", {
                      version: r.version,
                      reviewed: true,
                      confirmed: true,
                    }),
                  );
              }}
            >
              {personal ? "Simulated approval" : "Approve patient summary"}
            </button>
          )}
          {r.status === "approved" && !r.stale && (
            <div className="row wrap">
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(
                      r.content.paragraphs.map((p) => p.text).join("\n\n"),
                    )
                    .then(() => setNotice("Approved summary copied."))
                    .catch(() => setError("Clipboard access unavailable."))
                }
              >
                Copy approved summary
              </button>
              <button
                onClick={() => {
                  const frame = document.createElement("iframe");
                  frame.setAttribute("title", "Approved patient summary print");
                  frame.style.position = "fixed";
                  frame.style.width = "1px";
                  frame.style.height = "1px";
                  document.body.appendChild(frame);
                  const doc = frame.contentDocument;
                  if (!doc) {
                    frame.remove();
                    return;
                  }
                  doc.title = "Noticioner — Approved patient summary";
                  const title = doc.createElement("h1");
                  title.textContent = "Approved patient summary";
                  doc.body.appendChild(title);
                  for (const p of r.content.paragraphs) {
                    const el = doc.createElement("p");
                    el.textContent = p.text;
                    doc.body.appendChild(el);
                  }
                  frame.contentWindow?.print();
                  setTimeout(() => frame.remove(), 1000);
                }}
              >
                Print approved summary
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
