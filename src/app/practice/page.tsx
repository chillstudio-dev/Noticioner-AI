"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  ClipboardCheck,
  FileText,
  FolderOpen,
  Loader2,
  LockKeyhole,
  Pill,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import "./practice.css";
import { Recorder } from "@/components/recorder";
import { TranscriptTranslation } from "@/components/transcript-translation";
import { TrustReview } from "@/components/trust-review";
import { TrustQuality } from "@/components/trust-quality";
import { PatientSummaries } from "@/components/patient-summaries";
import { TrustNoteEditor } from "@/components/trust-note-editor";
import type { TrustFinding } from "@/lib/trust-engine";
import type { Note } from "@/lib/clinical";
import type { SpeechLanguage } from "@/lib/languages";

type Patient = {
  id: string;
  name: string;
  dob: string;
  external_identifier?: string;
  version: number;
};
type Member = { practitioner_id: string; display_name: string; role: string };
type AuthState = {
  configured: boolean;
  authenticated: boolean;
  organizations?: { id: string; name: string; role: string }[];
};
type Bootstrap = {
  demo?: boolean;
  actor: {
    practitionerId: string;
    organizationId: string;
    role: string;
    displayName: string;
  };
  patients: Patient[];
  directoryLimited?: boolean;
  members: Member[];
  provider: {
    configured: boolean;
    label: string;
    model?: string;
    transcriptionConfigured: boolean;
    transcriptionLabel: string;
    transcriptionProvider: string;
    transcriptionLanguages: SpeechLanguage[];
  };
  files: { configured: boolean; pdfEnabled: boolean; maxBytes: number };
};
type ClinicalNote = {
  id: string;
  content: string;
  status: string;
  version: number;
  created_at: string;
  approved_at?: string;
  author_name?: string;
  amends_id?: string;
};
type Medication = {
  id: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
  status: string;
  source: string;
  created_at: string;
};
type Document = {
  id: string;
  filename: string;
  status: string;
  created_at: string;
  byte_size: number;
  mime_type: string;
};
type Summary = {
  trust_findings: TrustFinding[];
  model?: string;
  id: string;
  status: string;
  version: number;
  created_at: string;
  stale?: boolean;
  note?: {
    statements?: {
      id: string;
      section: string;
      text: string;
      certainty: string;
      evidence?: { segmentId: string; quote: string }[];
    }[];
  };
  sources?: { id: string; type: string; version: number; segmentId: string }[];
};
type Detail = {
  permissions: { canWrite: boolean; canApprove: boolean; canManage: boolean };
  patient: Patient;
  notes: ClinicalNote[];
  medications: Medication[];
  documents: Document[];
  summaries: Summary[];
  grants: {
    practitioner_id: string;
    display_name?: string;
    active: boolean;
    access_level: "view" | "edit";
  }[];
  audit: {
    id: string;
    action: string;
    created_at: string;
    actor_name?: string;
  }[];
};
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const result = await fetch(`/api/practice/${path}`, {
    method: body === undefined && method === "POST" ? "GET" : method,
    cache: "no-store",
    credentials: "same-origin",
    headers:
      body instanceof FormData || body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const value = await result.json().catch(() => ({}));
  if (!result.ok)
    throw new RequestError(
      result.status,
      value.error || "The request could not be completed.",
    );
  return value as T;
}
const when = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not recorded";
function Tag({ children }: { children: ReactNode }) {
  return <span className="pr-tag">{children}</span>;
}
function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="pr-empty">
      {icon}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Field({
  label,
  name,
  ...props
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className="pr-field">
      {label}
      <input name={name} {...props} />
    </label>
  );
}

export default function PracticePage() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "signin" | "unavailable"
  >("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [organizations, setOrganizations] = useState<
    NonNullable<AuthState["organizations"]>
  >([]);
  const [busy, setBusy] = useState(false);
  const [loadingPatient, setLoadingPatient] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("Notes");
  const [quality, setQuality] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const navigate = (event: Event) => {
      const source = (event as CustomEvent<{ type: string; id: string }>)
        .detail;
      const tabs: Record<string, string> = {
        note: "Notes",
        document: "Documents",
        medication: "Medications",
      };
      if (!tabs[source.type]) return;
      setTab(tabs[source.type]);
      timer = setTimeout(() => {
        const el = document.getElementById(`practice-source-${source.id}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus();
      }, 0);
    };
    window.addEventListener("noticioner-source", navigate);
    return () => {
      window.removeEventListener("noticioner-source", navigate);
      clearTimeout(timer);
    };
  }, []);
  const [addPatient, setAddPatient] = useState(false);
  const [amendsId, setAmendsId] = useState<string | undefined>();
  const [noteText, setNoteText] = useState("");
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const selected = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const handleAccessFailure = useCallback((e: unknown) => {
    if (!(e instanceof RequestError) || ![401, 403, 404].includes(e.status))
      return;
    ++requestSequence.current;
    selected.current = null;
    setDetail(null);
    setLoadingPatient(false);
    setSelectedNotes([]);
    setSelectedDocuments([]);
    setConsent(false);
    setAmendsId(undefined);
    if (e.status === 401 || e.status === 403) {
      setData(null);
      setState("signin");
    }
  }, []);
  const load = useCallback(async () => {
    try {
      const authResponse = await fetch("/api/practice-auth/session", {
        cache: "no-store",
      });
      if (!authResponse.ok)
        throw new RequestError(
          authResponse.status,
          "Unable to check practice identity configuration.",
        );
      const auth: AuthState = await authResponse.json();
      setOrganizations(auth.organizations || []);
      if (!auth.configured)
        throw new RequestError(
          503,
          "Configure the practice database and organization sign-in before using shared records.",
        );
      if (!auth.authenticated)
        throw new RequestError(
          401,
          "Sign in with your organization to access shared records.",
        );
      const result = await request<Bootstrap>("bootstrap");
      setData(result);
      setState("ready");
      setError(
        new URLSearchParams(window.location.search).get("authError") || "",
      );
    } catch (e) {
      setData(null);
      setDetail(null);
      setState(
        e instanceof RequestError && e.status === 401
          ? "signin"
          : "unavailable",
      );
      setError(
        new URLSearchParams(window.location.search).get("authError") ||
          (e instanceof Error ? e.message : "Practice workspace unavailable."),
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (state !== "ready") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void request<Bootstrap>(`bootstrap?q=${encodeURIComponent(query)}`)
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch((e) => {
          if (!cancelled) {
            handleAccessFailure(e);
            setError(e instanceof Error ? e.message : "Patient search failed.");
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      cancelled = true;
    };
  }, [query, state, data?.actor.organizationId, handleAccessFailure]);
  async function openPatient(id: string) {
    setNoteText("");
    const sequence = ++requestSequence.current;
    selected.current = id;
    setLoadingPatient(true);
    setDetail(null);
    setError("");
    setNotice("");
    setSelectedNotes([]);
    setSelectedDocuments([]);
    setConsent(false);
    setAmendsId(undefined);
    try {
      const record = await request<Detail>(`patients/${id}`);
      if (sequence === requestSequence.current) setDetail(record);
    } catch (e) {
      if (sequence === requestSequence.current) {
        handleAccessFailure(e);
        setError(
          e instanceof Error ? e.message : "Patient record unavailable.",
        );
      }
    } finally {
      if (sequence === requestSequence.current) setLoadingPatient(false);
    }
  }
  async function mutate(
    path: string,
    body: unknown,
    message: string,
    method = "POST",
  ) {
    const target = selected.current;
    const sequence = requestSequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(path, body, method);
      const [workspace, patient] = await Promise.all([
        request<Bootstrap>(`bootstrap?q=${encodeURIComponent(query)}`),
        target ? request<Detail>(`patients/${target}`) : Promise.resolve(null),
      ]);
      setData(workspace);
      if (requestSequence.current === sequence) {
        setDetail(patient);
        setNotice(message);
      }
      return true;
    } catch (e) {
      if (requestSequence.current === sequence) handleAccessFailure(e);
      setError(e instanceof Error ? e.message : "Unable to save changes.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const patientPath = detail ? `patients/${detail.patient.id}` : "";
  const canCreate =
    data?.actor.role === "clinician" || data?.actor.role === "reviewer";
  const canWrite = !!detail?.permissions.canWrite;
  const canApprove = !!detail?.permissions.canApprove;
  const canManage = !!detail?.permissions.canManage;
  const patients =
    data?.patients.filter((p) =>
      `${p.name} ${p.external_identifier || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) || [];
  async function createPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await mutate(
        "patients",
        {
          name: fields.get("name"),
          dob: fields.get("dob"),
          identifier: fields.get("identifier"),
          ...(fields.get("reviewerId")
            ? { reviewerId: fields.get("reviewerId") }
            : {}),
        },
        "Patient record created.",
      )
    ) {
      form.reset();
      setAddPatient(false);
    }
  }
  function toggleSource(
    id: string,
    selectedIds: string[],
    setter: (ids: string[]) => void,
  ) {
    setter(
      selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id],
    );
  }
  return (
    <div className="practice">
      <header className="pr-header">
        <Link className="pr-brand" href={data?.demo ? "/doctor" : "/"}>
          <span>
            <Building2 size={23} />
          </span>
          Noticioner <b>Practice</b>
        </Link>
        <div className="pr-header-right">
          {state === "ready" && organizations.length > 0 && (
            <label className="pr-org-select">
              Practice
              <select
                aria-label="Active practice"
                disabled={busy}
                value={data?.actor.organizationId}
                onChange={async (event) => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await fetch(
                      "/api/practice-auth/organization",
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          organizationId: event.target.value,
                        }),
                      },
                    );
                    if (!result.ok)
                      throw new Error("Unable to switch practice.");
                    ++requestSequence.current;
                    selected.current = null;
                    setDetail(null);
                    setQuery("");
                    await load();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Unable to switch practice.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Tag>
            <LockKeyhole size={13} /> Shared practice
          </Tag>
          <Link href={data?.demo ? "/doctor" : "/"}>
            <ArrowLeft size={14} />{" "}
            {data?.demo ? "Doctor portal" : "Personal workspace"}
          </Link>
        </div>
      </header>
      {data?.demo && (
        <p className="pr-message" role="status">
          Sample hospital · synthetic patients only · demonstration identity
          service
        </p>
      )}
      {state !== "ready" ? (
        <main className="pr-gateway">
          <span className="pr-eyebrow">CONNECTED CARE · CONTROLLED ACCESS</span>
          <h1>
            One patient record.
            <br />
            An informed care team.
          </h1>
          <p className="pr-lead">
            Bring patient notes, medications and source documents together in a
            shared practice workspace, with explicit access and human-reviewed
            AI summaries.
          </p>
          <div className="pr-gateway-card">
            {state === "loading" ? (
              <>
                <Loader2 className="spin" />
                <h2>Opening practice workspace</h2>
                <p>Checking your organization and access.</p>
              </>
            ) : state === "signin" ? (
              <>
                <LockKeyhole size={28} />
                <h2>Sign in with your practice</h2>
                <p>
                  Your organization identity confirms who you are. Patient
                  access is limited to your authorized care relationships.
                </p>
                {error && (
                  <p className="pr-error" role="alert">
                    {error}
                  </p>
                )}
                {/* Full navigation is required for the OIDC redirect and state cookie. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a className="pr-primary" href="/api/practice-auth/login">
                  Continue with organization sign-in <ArrowUpRight size={17} />
                </a>
              </>
            ) : (
              <>
                <ShieldCheck size={28} />
                <h2>Practice connection needed</h2>
                <p>
                  This shared workspace requires its own database and
                  organization identity configuration. Your personal workspace
                  remains available.
                </p>
                <p className="pr-error" role="alert">
                  {error}
                </p>
                <button
                  onClick={() => {
                    setState("loading");
                    void load();
                  }}
                >
                  Check connection again
                </button>
              </>
            )}
          </div>
          <details className="pr-about">
            <summary>How shared records work</summary>
            <div className="pr-principles">
              <div>
                <Users />
                <strong>Purposeful sharing</strong>
                <p>Access follows care relationships, not a public link.</p>
              </div>
              <div>
                <ClipboardCheck />
                <strong>Human approval</strong>
                <p>AI drafts remain distinct from approved records.</p>
              </div>
              <div>
                <FileText />
                <strong>Visible provenance</strong>
                <p>Follow a summary back to its source material.</p>
              </div>
            </div>
          </details>
          <p className="pr-footnote">
            Research implementation · institutional review required before
            clinical use
          </p>
        </main>
      ) : (
        <div className="pr-layout">
          <aside className="pr-directory">
            <div className="pr-identity">
              <span className="pr-eyebrow">YOUR PRACTICE</span>
              <h2>{data?.actor.displayName}</h2>
              <p>{data?.actor.role} · Authorized workspace</p>
            </div>
            <div className="pr-directory-title">
              <h2>
                Patients <span>{data?.patients.length}</span>
              </h2>
              {canCreate && (
                <button
                  className="pr-square"
                  disabled={busy}
                  aria-label="Add patient"
                  onClick={() => setAddPatient(!addPatient)}
                >
                  <Plus size={18} />
                </button>
              )}
            </div>
            <label className="pr-mobile-patient-switcher">
              <span>Active patient</span>
              <select
                aria-label="Switch patient"
                value={detail?.patient.id ?? ""}
                disabled={busy || !patients.length}
                onChange={(event) => {
                  const patientId = event.target.value;
                  if (!patientId) return;
                  setTab("Notes");
                  void openPatient(patientId);
                }}
              >
                <option value="" disabled>
                  {patients.length
                    ? "Choose a patient"
                    : "No patients available"}
                </option>
                {(data?.patients ?? []).map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name}
                    {patient.external_identifier
                      ? ` · ${patient.external_identifier}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="pr-search">
              <Search size={17} />
              <input
                aria-label="Search authorized patients"
                placeholder="Search name or identifier"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {addPatient && (
              <form
                className="pr-form pr-patient-form"
                onSubmit={createPatient}
              >
                <h3>New patient record</h3>
                <Field name="name" label="Full name" required maxLength={100} />
                <Field name="dob" label="Date of birth" type="date" required />
                <Field
                  name="identifier"
                  label="Practice identifier"
                  required
                  maxLength={100}
                />
                {data?.actor.role === "clinician" && (
                  <label className="pr-field">
                    Assigned reviewer
                    <select name="reviewerId" required defaultValue="">
                      <option value="" disabled>
                        Choose a reviewer
                      </option>
                      {data.members
                        .filter((m) => m.role === "reviewer")
                        .map((m) => (
                          <option
                            key={m.practitioner_id}
                            value={m.practitioner_id}
                          >
                            {m.display_name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <button className="pr-primary" disabled={busy}>
                  Create patient
                </button>
                <button type="button" onClick={() => setAddPatient(false)}>
                  Cancel
                </button>
              </form>
            )}
            {data?.directoryLimited && (
              <p className="pr-muted">
                Showing the first 250 matches. Narrow your search by name or
                identifier.
              </p>
            )}
            {data?.actor.role !== "admin" && (
              <button disabled={busy} onClick={() => setQuality((v) => !v)}>
                {quality ? "Back to records" : "Quality · synthetic evaluation"}
              </button>
            )}
            <div className="pr-patient-list">
              {patients.map((p) => (
                <button
                  key={p.id}
                  disabled={busy}
                  className={detail?.patient.id === p.id ? "is-selected" : ""}
                  onClick={() => {
                    setQuality(false);
                    setTab("Notes");
                    void openPatient(p.id);
                  }}
                >
                  <span className="pr-avatar">
                    {p.name
                      .split(" ")
                      .map((x) => x[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.external_identifier || "No external identifier"}
                    </small>
                  </span>
                </button>
              ))}
              {!patients.length && (
                <p className="pr-directory-empty">
                  {query
                    ? "No matching authorized patients."
                    : "No patients available. Your administrator can arrange access."}
                </p>
              )}
            </div>
            <div className="pr-directory-bottom">
              <ShieldCheck size={17} />
              <p>
                Every patient request is checked against your active practice
                access.
              </p>
            </div>
            <button
              className="pr-signout"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const response = await fetch("/api/practice-auth/logout", {
                    method: "POST",
                  });
                  if (!response.ok)
                    throw new Error("Unable to sign out. Try again.");
                  ++requestSequence.current;
                  selected.current = null;
                  setDetail(null);
                  setData(null);
                  setState("signin");
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Unable to sign out.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Sign out
            </button>
          </aside>
          <main className="pr-main">
            <div aria-live="polite">
              {error && (
                <div className="pr-message pr-error" role="alert">
                  {error}
                  <button
                    onClick={() => setError("")}
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </div>
              )}
              {notice && (
                <div className="pr-message">
                  <Check size={17} />
                  {notice}
                </div>
              )}
              {busy && (
                <div className="pr-working">
                  <Loader2 size={16} className="spin" /> Saving and refreshing
                  record…
                </div>
              )}
            </div>
            {quality ? (
              <TrustQuality practice configured={!!data?.provider.configured} />
            ) : loadingPatient ? (
              <Empty
                icon={<Loader2 className="spin" />}
                title="Opening patient record"
              >
                Checking current care access and loading the latest versions.
              </Empty>
            ) : !detail ? (
              <Empty
                icon={<FolderOpen size={36} />}
                title="A shared view of patient care"
              >
                Select an authorized patient to review notes, medications and
                documents.
              </Empty>
            ) : (
              <>
                <div className="pr-patient-heading">
                  <div>
                    <span className="pr-eyebrow">PATIENT RECORD</span>
                    <h1>{detail.patient.name}</h1>
                    <p>
                      Born {detail.patient.dob.slice(0, 10)} <span>·</span>{" "}
                      {detail.patient.external_identifier ||
                        "Identifier not recorded"}
                    </p>
                  </div>
                  <Tag>
                    <ShieldCheck size={14} />{" "}
                    {canWrite ? "Can edit" : "View only"}
                  </Tag>
                </div>
                {!canWrite && (
                  <p className="pr-message">
                    You can view this patient’s records and download documents.
                    Ask an assigned reviewer for edit access.
                  </p>
                )}
                {(detail.notes.length >= 200 ||
                  detail.medications.length >= 200 ||
                  detail.documents.length >= 200 ||
                  detail.summaries.length >= 100) && (
                  <p className="pr-muted">
                    Recent history is shown: up to 200 notes, medications and
                    files, and 100 summaries. Contact the record custodian for
                    older history.
                  </p>
                )}
                <nav className="pr-tabs" aria-label="Patient record sections">
                  {[
                    "Notes",
                    "Medications",
                    "Documents",
                    "AI summaries",
                    "Patient summaries",
                    "Care team",
                    "Activity",
                  ].map((item) => (
                    <button
                      key={item}
                      aria-current={tab === item ? "page" : undefined}
                      className={tab === item ? "active" : ""}
                      disabled={busy}
                      onClick={() => setTab(item)}
                    >
                      {item}
                    </button>
                  ))}
                </nav>
                {tab === "Notes" && (
                  <section>
                    <div className="pr-section-heading">
                      <div>
                        <h2>Clinical notes</h2>
                        <p>
                          Preserve signed records. Add amendments when care
                          information changes.
                        </p>
                      </div>
                      <Tag>{detail.notes.length} records</Tag>
                    </div>
                    {detail.notes.length ? (
                      <div className="pr-stack">
                        {detail.notes.map((note) => (
                          <article
                            className="pr-card"
                            key={note.id}
                            id={`practice-source-${note.id}`}
                            tabIndex={-1}
                          >
                            <div className="pr-card-heading">
                              <Tag>{note.status}</Tag>
                              <small>{when(note.created_at)}</small>
                            </div>
                            {note.amends_id && (
                              <p className="pr-muted">
                                Amendment to note {note.amends_id.slice(0, 8)}
                              </p>
                            )}
                            <p className="pr-note">{note.content}</p>
                            <div className="pr-card-footer">
                              <span>
                                {note.author_name || "Practice author"} ·
                                Version {note.version}
                              </span>
                              <div>
                                {canApprove &&
                                  note.status !== "approved" &&
                                  note.status !== "Approved" && (
                                    <button
                                      disabled={busy}
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            "Approve this exact note version? Confirm that you reviewed its clinical content.",
                                          )
                                        )
                                          void mutate(
                                            `${patientPath}/notes/${note.id}/approve`,
                                            {
                                              version: note.version,
                                              reviewed: true,
                                            },
                                            "Note approved.",
                                          );
                                      }}
                                    >
                                      <ClipboardCheck size={15} /> Review &
                                      approve
                                    </button>
                                  )}
                                {canWrite && note.status === "approved" && (
                                  <button
                                    disabled={busy}
                                    onClick={() => {
                                      setAmendsId(note.id);
                                      document
                                        .getElementById("practice-note")
                                        ?.focus();
                                    }}
                                  >
                                    Add amendment
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty icon={<FileText />} title="No clinical notes yet">
                        Create a note to start this patient&apos;s shared
                        clinical record.
                      </Empty>
                    )}
                    {canWrite && (
                      <form
                        className="pr-card pr-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          const text = new FormData(form).get("text");
                          if (
                            await mutate(
                              `${patientPath}/notes`,
                              { text, ...(amendsId ? { amendsId } : {}) },
                              "Note saved for review.",
                            )
                          ) {
                            form.reset();
                            setNoteText("");
                            setAmendsId(undefined);
                          }
                        }}
                      >
                        <h3>
                          {amendsId ? "Add an amendment" : "New clinical note"}
                        </h3>
                        <Recorder
                          key={detail.patient.id}
                          id={detail.patient.id}
                          disabled={busy}
                          transcriptionConfigured={
                            !!data?.provider.transcriptionConfigured
                          }
                          transcriptionLabel={
                            data?.provider.transcriptionLabel ||
                            "Audio transcription"
                          }
                          localTranscription={
                            data?.provider.transcriptionProvider === "local"
                          }
                          transcriptionLanguages={
                            data?.provider.transcriptionLanguages
                          }
                          transcribePath={`practice/${patientPath}/transcribe`}
                          eventPath={null}
                          onError={setError}
                          onTranscript={(text) => {
                            setNoteText((current) =>
                              current ? `${current}\n\n${text}` : text,
                            );
                            setNotice(
                              "Transcript added to the draft. Check the wording and speaker attribution before saving.",
                            );
                          }}
                        />
                        <label className="pr-field">
                          Note text
                          <textarea
                            id="practice-note"
                            aria-label="Note text"
                            name="text"
                            value={noteText}
                            onChange={(event) =>
                              setNoteText(event.target.value)
                            }
                            required
                            rows={6}
                            maxLength={12000}
                            placeholder="Document the encounter, findings and plan…"
                          />
                        </label>
                        <TranscriptTranslation
                          key={detail.patient.id}
                          text={noteText}
                          endpoint={`practice/${patientPath}/translate`}
                          configured={!!data?.provider.configured}
                          disabled={busy}
                          onError={setError}
                        />
                        <div className="pr-actions">
                          <button className="pr-primary" disabled={busy}>
                            Save for review
                          </button>
                          {amendsId && (
                            <button
                              type="button"
                              onClick={() => setAmendsId(undefined)}
                            >
                              Cancel amendment
                            </button>
                          )}
                        </div>
                      </form>
                    )}
                  </section>
                )}
                {tab === "Medications" && (
                  <section>
                    <div className="pr-section-heading">
                      <div>
                        <h2>Medication history</h2>
                        <p>
                          Reported medication information with provenance. These
                          entries are not prescriptions.
                        </p>
                      </div>
                    </div>
                    {detail.medications.length ? (
                      <div className="pr-stack">
                        {detail.medications.map((m) => (
                          <article
                            className="pr-card"
                            key={m.id}
                            id={`practice-source-${m.id}`}
                            tabIndex={-1}
                          >
                            <div className="pr-card-heading">
                              <h3>
                                <Pill size={18} /> {m.name}
                              </h3>
                              <Tag>{m.status}</Tag>
                            </div>
                            <p>
                              {[m.dose, m.route, m.frequency]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            <p className="pr-muted">Source: {m.source}</p>
                            <small>Recorded {when(m.created_at)}</small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty icon={<Pill />} title="No medications recorded">
                        A missing entry does not mean the patient takes no
                        medication.
                      </Empty>
                    )}
                    {canWrite && (
                      <form
                        className="pr-card pr-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          const values = Object.fromEntries(new FormData(form));
                          if (
                            await mutate(
                              `${patientPath}/medications`,
                              values,
                              "Medication statement recorded.",
                            )
                          )
                            form.reset();
                        }}
                      >
                        <h3>Record a medication statement</h3>
                        <div className="pr-form-grid">
                          <Field
                            name="name"
                            label="Medication"
                            required
                            maxLength={150}
                          />
                          <Field
                            name="dose"
                            label="Dose"
                            required
                            maxLength={100}
                          />
                          <Field
                            name="route"
                            label="Route"
                            required
                            maxLength={100}
                          />
                          <Field
                            name="frequency"
                            label="Frequency"
                            required
                            maxLength={100}
                          />
                        </div>
                        <label className="pr-field">
                          Status
                          <select name="status">
                            <option value="reported">
                              Patient reported / unverified
                            </option>
                            {canApprove && (
                              <option value="verified">
                                Verified by reviewer
                              </option>
                            )}
                            {canApprove && (
                              <option value="stopped">Stopped</option>
                            )}
                          </select>
                        </label>
                        <Field
                          name="source"
                          label="Source / verification context"
                          required
                          maxLength={1000}
                          placeholder="For example, patient reported at consultation"
                        />
                        <button className="pr-primary" disabled={busy}>
                          Record medication
                        </button>
                      </form>
                    )}
                  </section>
                )}
                {tab === "Documents" && (
                  <section>
                    <div className="pr-section-heading">
                      <div>
                        <h2>Patient documents</h2>
                        <p>
                          Private source files, accessible only through an
                          authorized request.
                        </p>
                      </div>
                    </div>
                    {detail.documents.length ? (
                      <div className="pr-stack">
                        {detail.documents.map((doc) => (
                          <article
                            className="pr-card pr-document"
                            key={doc.id}
                            id={`practice-source-${doc.id}`}
                            tabIndex={-1}
                          >
                            <FileText size={24} />
                            <div>
                              <h3>{doc.filename}</h3>
                              <small>
                                {when(doc.created_at)}
                                {doc.byte_size
                                  ? ` · ${Math.ceil(doc.byte_size / 1024)} KB`
                                  : ""}
                              </small>
                            </div>
                            <Tag>{doc.status}</Tag>
                            {["ready", "available", "clean"].includes(
                              doc.status,
                            ) && (
                              <a
                                href={`/api/practice/${patientPath}/documents/${doc.id}/download`}
                              >
                                Download <ArrowUpRight size={15} />
                              </a>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty icon={<Upload />} title="No source documents">
                        Upload an allowed document to preserve its source and
                        make it available to the care team.
                      </Empty>
                    )}
                    {canWrite && (
                      <form
                        className="pr-card pr-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          if (
                            await mutate(
                              `${patientPath}/documents`,
                              new FormData(form),
                              "Document uploaded.",
                            )
                          )
                            form.reset();
                        }}
                      >
                        <h3>Upload a source document</h3>
                        <p className="pr-muted">
                          Upload UTF-8 plain text (.txt), up to 5 MB.
                          {data?.files.pdfEnabled
                            ? " Scanned PDF uploads are also available; PDF text cannot be summarized yet."
                            : " PDF uploads require a configured antivirus scanner."}
                          {!data?.files.configured &&
                            " Document storage is unavailable. Ask your administrator to configure encryption."}
                        </p>
                        <label className="pr-field">
                          Source file
                          <input
                            type="file"
                            name="file"
                            accept={
                              data?.files.pdfEnabled
                                ? ".txt,text/plain,.pdf,application/pdf"
                                : ".txt,text/plain"
                            }
                            required
                          />
                        </label>
                        <button
                          className="pr-primary"
                          disabled={busy || !data?.files.configured}
                        >
                          <Upload size={16} /> Upload privately
                        </button>
                      </form>
                    )}
                  </section>
                )}
                {tab === "Patient summaries" && (
                  <PatientSummaries
                    key={detail.patient.id}
                    endpoint={`/api/practice/${patientPath}/patient-summaries`}
                    sources={detail.notes
                      .filter(
                        (n) =>
                          n.status === "approved" &&
                          !detail.notes.some(
                            (a) =>
                              a.status === "approved" && a.amends_id === n.id,
                          ),
                      )
                      .map((n) => ({
                        id: n.id,
                        version: n.version,
                        label: n.content.slice(0, 70),
                      }))}
                    canWrite={canWrite}
                    canApprove={canApprove}
                    configured={!!data?.provider.configured}
                  />
                )}
                {tab === "AI summaries" && (
                  <section>
                    <div className="pr-section-heading">
                      <div>
                        <h2>AI summaries</h2>
                        <p>
                          Source-linked drafts. Review the clinical meaning
                          before approving.
                        </p>
                      </div>
                      <Tag>
                        {data?.provider.configured
                          ? data.provider.label
                          : "AI not configured"}
                      </Tag>
                    </div>
                    {detail.summaries.map((summary) => (
                      <article className="pr-card" key={summary.id}>
                        {summary.model && (
                          <p className="pr-muted">Model: {summary.model}</p>
                        )}
                        <div className="pr-card-heading">
                          <div>
                            <Tag>{summary.status}</Tag>
                            {summary.stale && (
                              <Tag>Sources changed · review required</Tag>
                            )}
                          </div>
                          <small>{when(summary.created_at)}</small>
                        </div>
                        <p className="pr-muted">
                          {summary.sources
                            ?.map(
                              (source) =>
                                `${source.segmentId}: ${source.type} ${source.id.slice(0, 8)} · version ${source.version}`,
                            )
                            .join("; ")}
                        </p>
                        {summary.note?.statements?.map((statement) => (
                          <div
                            className="pr-summary-statement"
                            key={statement.id}
                          >
                            <span className="pr-eyebrow">
                              {statement.section}
                            </span>
                            <p>{statement.text}</p>
                            <Tag>
                              {statement.certainty} · verify clinical meaning
                            </Tag>
                            {statement.evidence?.map((source, i) => (
                              <details key={i}>
                                <summary>Source {source.segmentId}</summary>
                                <blockquote>{source.quote}</blockquote>
                              </details>
                            ))}
                          </div>
                        ))}
                        {!summary.note?.statements?.length && (
                          <p>
                            Summary details are unavailable. Reopen the record
                            before reviewing.
                          </p>
                        )}
                        {canWrite &&
                          summary.status === "draft" &&
                          !summary.stale &&
                          summary.note?.statements?.length && (
                            <TrustNoteEditor
                              note={summary.note as Note}
                              disabled={busy}
                              onSave={(note) =>
                                mutate(
                                  `${patientPath}/summaries/${summary.id}`,
                                  { version: summary.version, note },
                                  "Draft edited; findings reset.",
                                  "PATCH",
                                )
                              }
                            />
                          )}
                        <TrustReview
                          findings={summary.trust_findings || []}
                          disabled={busy || !!summary.stale}
                          onResolve={
                            canApprove && summary.status === "draft"
                              ? (id, resolution, note) =>
                                  mutate(
                                    `${patientPath}/summaries/${summary.id}/findings`,
                                    {
                                      version: summary.version,
                                      id,
                                      resolution,
                                      note,
                                    },
                                    "Finding reviewed.",
                                    "PATCH",
                                  )
                              : undefined
                          }
                        />
                        {canWrite &&
                          summary.status === "draft" &&
                          !summary.stale && (
                            <button
                              disabled={
                                busy || !consent || !data?.provider.configured
                              }
                              onClick={() =>
                                void mutate(
                                  `${patientPath}/summaries/${summary.id}/audit`,
                                  { version: summary.version, consent: true },
                                  "Audit completed; review new findings.",
                                )
                              }
                            >
                              Retry semantic audit (requires provider consent
                              below)
                            </button>
                          )}
                        {canApprove &&
                          !summary.stale &&
                          !!summary.note?.statements?.length &&
                          !!summary.trust_findings?.length &&
                          !summary.trust_findings.some(
                            (f) =>
                              f.required &&
                              (f.resolution === "Open" ||
                                f.note.trim().length < 3),
                          ) &&
                          !["approved", "Approved"].includes(
                            summary.status,
                          ) && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Approve this summary after checking every statement against its sources?",
                                  )
                                )
                                  void mutate(
                                    `${patientPath}/summaries/${summary.id}/approve`,
                                    {
                                      version: summary.version,
                                      reviewed: true,
                                    },
                                    "Summary approved.",
                                  );
                              }}
                            >
                              <ClipboardCheck size={16} /> Review & approve
                            </button>
                          )}
                      </article>
                    ))}
                    {!detail.summaries.length && (
                      <Empty icon={<Sparkles />} title="No AI summaries yet">
                        Choose source notes and documents to generate a
                        reviewable draft.
                      </Empty>
                    )}
                    {canWrite && (
                      <form
                        className="pr-card pr-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await mutate(
                            `${patientPath}/summaries`,
                            {
                              sourceNoteIds: selectedNotes,
                              sourceDocumentIds: selectedDocuments,
                              consent,
                            },
                            "Summary generated. Review the draft and source quotations.",
                          );
                        }}
                      >
                        <h3>Generate from selected sources</h3>
                        <div className="pr-source-list">
                          {detail.notes
                            .filter((n) => n.status === "approved")
                            .map((n) => (
                              <label key={n.id}>
                                <input
                                  type="checkbox"
                                  checked={selectedNotes.includes(n.id)}
                                  onChange={() =>
                                    toggleSource(
                                      n.id,
                                      selectedNotes,
                                      setSelectedNotes,
                                    )
                                  }
                                />{" "}
                                <span>
                                  Note · {when(n.created_at)}
                                  <small>{n.content.slice(0, 100)}</small>
                                </span>
                              </label>
                            ))}
                          {detail.documents
                            .filter(
                              (d) =>
                                d.status === "available" &&
                                d.mime_type === "text/plain",
                            )
                            .map((d) => (
                              <label key={d.id}>
                                <input
                                  type="checkbox"
                                  checked={selectedDocuments.includes(d.id)}
                                  onChange={() =>
                                    toggleSource(
                                      d.id,
                                      selectedDocuments,
                                      setSelectedDocuments,
                                    )
                                  }
                                />
                                {d.filename}
                              </label>
                            ))}
                        </div>
                        <label className="pr-consent">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                            required
                          />{" "}
                          I am authorized to send these selected sources to the
                          configured AI provider for summarization.
                        </label>
                        <button
                          className="pr-primary"
                          disabled={
                            busy ||
                            !data?.provider.configured ||
                            !consent ||
                            (!selectedNotes.length && !selectedDocuments.length)
                          }
                        >
                          <Sparkles size={16} /> Generate review draft
                        </button>
                      </form>
                    )}
                  </section>
                )}
                {tab === "Care team" && (
                  <section>
                    <div className="pr-section-heading">
                      <div>
                        <h2>Authorized care team</h2>
                        <p>
                          Practice membership and a current patient access grant
                          are both required.
                        </p>
                      </div>
                    </div>
                    <div className="pr-stack">
                      {detail.grants
                        .filter((g) => g.active)
                        .map((g) => (
                          <article
                            className="pr-card pr-document"
                            key={g.practitioner_id}
                          >
                            <Users size={22} />
                            <div>
                              <h3>
                                {g.display_name ||
                                  data?.members.find(
                                    (m) =>
                                      m.practitioner_id === g.practitioner_id,
                                  )?.display_name ||
                                  "Practitioner"}
                              </h3>
                              <small>
                                {g.access_level === "edit"
                                  ? "Can edit"
                                  : "View only"}
                              </small>
                            </div>
                            {canManage && (
                              <label className="pr-field">
                                Access for {g.display_name || "practitioner"}
                                <select
                                  aria-label={`Access for ${g.display_name || g.practitioner_id}`}
                                  disabled={busy}
                                  value={g.access_level}
                                  onChange={(event) => {
                                    if (
                                      window.confirm(
                                        "Change this practitioner's patient access?",
                                      )
                                    )
                                      void mutate(
                                        `${patientPath}/grants`,
                                        {
                                          practitionerId: g.practitioner_id,
                                          accessLevel: event.target.value,
                                        },
                                        "Patient access updated.",
                                      );
                                  }}
                                >
                                  <option value="view">View only</option>
                                  <option value="edit">Can edit</option>
                                </select>
                              </label>
                            )}
                            {canManage && (
                              <button
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Revoke this practitioner's access to this patient?",
                                    )
                                  )
                                    void mutate(
                                      `${patientPath}/grants/${g.practitioner_id}`,
                                      {},
                                      "Patient access revoked.",
                                      "DELETE",
                                    );
                                }}
                              >
                                Revoke access
                              </button>
                            )}
                          </article>
                        ))}
                    </div>
                    {canManage ? (
                      <form
                        className="pr-card pr-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await mutate(
                            `${patientPath}/grants`,
                            {
                              practitionerId: new FormData(e.currentTarget).get(
                                "practitionerId",
                              ),
                              accessLevel: new FormData(e.currentTarget).get(
                                "accessLevel",
                              ),
                            },
                            "Care access granted.",
                          );
                        }}
                      >
                        <h3>Grant patient access</h3>
                        <label className="pr-field">
                          Active practitioner
                          <select
                            name="practitionerId"
                            required
                            defaultValue=""
                          >
                            <option disabled value="">
                              Choose a practice member
                            </option>
                            {data?.members
                              .filter(
                                (m) =>
                                  m.role !== "admin" &&
                                  !detail.grants.some(
                                    (g) =>
                                      g.practitioner_id === m.practitioner_id &&
                                      g.active,
                                  ),
                              )
                              .map((m) => (
                                <option
                                  key={m.practitioner_id}
                                  value={m.practitioner_id}
                                >
                                  {m.display_name} · {m.role}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="pr-field">
                          Patient access
                          <select name="accessLevel" defaultValue="view">
                            <option value="view">View only</option>
                            <option value="edit">Can edit</option>
                          </select>
                        </label>
                        <button className="pr-primary" disabled={busy}>
                          Grant access
                        </button>
                      </form>
                    ) : (
                      <p className="pr-muted">
                        Contact an assigned practice reviewer to change the care
                        team.
                      </p>
                    )}
                  </section>
                )}
                {tab === "Activity" && (
                  <section>
                    <div className="pr-section-heading">
                      <div>
                        <h2>Record activity</h2>
                        <p>
                          Recent access and record events. Application logs are
                          not an independently certified audit archive.
                        </p>
                      </div>
                    </div>
                    <div className="pr-card">
                      {detail.audit.length ? (
                        <ol className="pr-timeline">
                          {detail.audit.map((event) => (
                            <li key={event.id}>
                              <span />
                              <div>
                                <strong>{event.action}</strong>
                                <p>
                                  {event.actor_name || "Practice activity"} ·{" "}
                                  {when(event.created_at)}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p>No activity available for this record.</p>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
