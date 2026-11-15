"use client";
import { useState } from "react";
import type { Note, Statement } from "@/lib/clinical";
export function TrustNoteEditor({
  note,
  disabled,
  onSave,
}: {
  note: Note;
  disabled: boolean;
  onSave: (note: Note) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Note | null>(null);
  if (!draft)
    return (
      <button
        disabled={disabled}
        onClick={() => setDraft(structuredClone(note))}
      >
        Edit draft statements
      </button>
    );
  const change = (i: number, patch: Partial<Statement>) =>
    setDraft({
      statements: draft.statements.map((s, j) =>
        j === i ? { ...s, ...patch } : s,
      ),
    });
  return (
    <div className="trust-note-editor">
      {draft.statements.map((s, i) => (
        <div key={s.id}>
          <label>
            {s.section} · {s.id}
            <textarea
              value={s.text}
              disabled={disabled}
              onChange={(e) => change(i, { text: e.target.value })}
            />
          </label>
          <small>
            Saving invalidates all previous findings and dispositions. Keep
            exact source quotations.
          </small>
          {(s.rejectedEvidence || []).length > 0 && (
            <div>
              <p>Rejected evidence references must be corrected or removed.</p>
              {s.rejectedEvidence?.map((e, k) => (
                <p key={k}>
                  {e.segmentId}: {e.quote}{" "}
                  <button
                    disabled={disabled}
                    onClick={() =>
                      change(i, {
                        rejectedEvidence: s.rejectedEvidence?.filter(
                          (_, n) => n !== k,
                        ),
                      })
                    }
                  >
                    Remove invalid reference
                  </button>
                </p>
              ))}
            </div>
          )}
          {s.evidence.map((e, k) => (
            <label key={k}>
              Supporting quote · {e.segmentId}
              <textarea
                disabled={disabled}
                value={e.quote}
                onChange={(event) =>
                  change(i, {
                    evidence: s.evidence.map((ref, n) =>
                      n === k ? { ...ref, quote: event.target.value } : ref,
                    ),
                  })
                }
              />
            </label>
          ))}
        </div>
      ))}
      <button
        disabled={disabled}
        onClick={() =>
          void onSave(draft).then((saved) => {
            if (saved !== false) setDraft(null);
          })
        }
      >
        Save and rerun local checks
      </button>
      <button disabled={disabled} onClick={() => setDraft(null)}>
        Cancel edit
      </button>
    </div>
  );
}
