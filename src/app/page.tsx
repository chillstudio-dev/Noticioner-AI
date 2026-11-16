"use client";
import { Fragment, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Link2,
  Loader2,
  Menu,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Users,
  X,
  AlertCircle,
  BarChart3,
  Sparkles,
} from "lucide-react";
import {
  parseTranscript,
  sections,
  type Note,
  type Flag,
} from "@/lib/clinical";
import type { Consultation, Patient } from "@/lib/db";
import { api, loadWorkspace } from "@/lib/client-api";
import { Badge, Modal } from "@/components/ui";
import type { providerStatus } from "@/lib/provider";
import { Recorder } from "@/components/recorder";
import { TranscriptTranslation } from "@/components/transcript-translation";
import {
  ConsultationStatusChart,
  ExtractionChart,
} from "@/components/clinical-charts";
import type {
  ExtractionChartDatum,
  StatusChartDatum,
} from "@/components/clinical-charts";
import { TrustSources } from "@/components/trust-review";
import { PatientSummaries } from "@/components/patient-summaries";
import { TrustQuality } from "@/components/trust-quality";
import type { Evaluation } from "@/lib/evaluation";

type Page =
  | "Overview"
  | "Consultations"
  | "Patients"
  | "AI Evaluation"
  | "Analytics"
  | "Settings";
type ActivityItem = {
  id: string;
  action: string;
  created_at: string;
  consultation_id: string | null;
};
type Data = {
  patients: Patient[];
  consultations: Consultation[];
  provider: ReturnType<typeof providerStatus>;
  activity: ActivityItem[];
  evaluations: Evaluation[];
};
const date = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const time = (s: string) =>
  new Date(s).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const initials = (s: string) =>
  s
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
const pct = (n: number | null) =>
  n === null ? "N/A" : `${(n * 100).toFixed(1)}%`;
export default function App() {
  const [data, setData] = useState<Data | null>(null),
    [ready, setReady] = useState(false),
    [page, setPage] = useState<Page>("Overview"),
    [selected, setSelected] = useState<Consultation | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All statuses"),
    [message, setMessage] = useState(""),
    [messageKind, setMessageKind] = useState<"info" | "error">("info"),
    [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false),
    [patientId, setPatientId] = useState(""),
    [consultType, setConsultType] = useState("General consultation");
  const [transcript, setTranscript] = useState(""),
    [editNote, setEditNote] = useState<Note | null>(null),
    [editing, setEditing] = useState(false),
    [highlight, setHighlight] = useState<string | null>(null);
  const [flag, setFlag] = useState<Flag | null>(null),
    [resolution, setResolution] = useState("Addressed"),
    [reviewNote, setReviewNote] = useState(""),
    [approval, setApproval] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [profile, setProfile] = useState<Patient | null>(null),
    [patientForm, setPatientForm] = useState<Patient | null>(null),
    [deletion, setDeletion] = useState<"consultation" | "workspace" | null>(
      null,
    ),
    [auditOpen, setAuditOpen] = useState(false),
    [history, setHistory] = useState<ActivityItem[]>([]);
  const [busyLabel, setBusyLabel] = useState("Working…");
  const refresh = useCallback(async () => {
    const d = await loadWorkspace<Data>();
    setData(d);
    return d;
  }, []);
  useEffect(() => {
    refresh()
      .catch(() => {
        setMessageKind("error");
        setMessage(
          "Unable to open your workspace. Check the server and try again.",
        );
      })
      .finally(() => setReady(true));
  }, [refresh]);
  const act = async (fn: () => Promise<void>, label = "Saving changes…") => {
    setBusyLabel(label);
    setBusy(true);
    setMessageKind("info");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessageKind("error");
      setMessage(
        (e as Error).name === "TimeoutError"
          ? "This request took too long. Your saved work is preserved; please retry."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  function openConsult(c: Consultation) {
    setSelected(c);
    setTranscript(c.transcript);
    setEditNote(c.note);
    setEditing(false);
    setHighlight(null);
    setReviewed(false);
    setPage("Consultations");
  }
  function update(c: Consultation) {
    setSelected(c);
    setTranscript(c.transcript);
    setEditNote(c.note);
    setEditing(false);
    setReviewed(false);
  }
  const canLeaveRecord = () =>
    !busy &&
    (!selected ||
      (transcript === selected.transcript &&
        (!editing ||
          JSON.stringify(editNote) === JSON.stringify(selected.note))) ||
      window.confirm("Leave without saving transcript or note changes?"));
  const start = () => {
    if (busy) return;
    setMessage("");
    if (!data?.patients.length) {
      setPage("Patients");
      setPatientForm({
        id: "",
        name: "",
        dob: "",
        history: "",
        allergies: "",
        medications: "",
      });
      setMessage("Add a patient profile, then start a consultation.");
      return;
    }
    setPatientId(data.patients[0].id);
    setNewOpen(true);
  };
  const navigate = (p: Page) => {
    if (!canLeaveRecord()) return;
    setSelected(null);
    setPage(p);
    setNavOpen(false);
    setSearch("");
    setFilter("All statuses");
    setMessage("");
  };
  useEffect(() => {
    if (!navOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navOpen]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        selected &&
        (transcript !== selected.transcript ||
          (editing &&
            JSON.stringify(editNote) !== JSON.stringify(selected.note)))
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [selected, transcript, editing, editNote]);
  if (!ready)
    return (
      <div className="loading">
        <Loader2 className="spin" />
        Opening your clinical workspace…
      </div>
    );
  if (!data)
    return (
      <main className="loading">
        <p role="alert">{message || "Workspace unavailable"}</p>
        <button onClick={() => window.location.reload()}>
          Retry opening workspace
        </button>
      </main>
    );
  const currentPatient = selected
    ? data.patients.find((p) => p.id === selected.patient_id)
    : null;
  const drafts = data.consultations.filter((c) => c.status !== "Approved"),
    approved = data.consultations.filter((c) => c.status === "Approved"),
    today = data.consultations.filter(
      (c) =>
        new Date(c.created_at).toLocaleDateString() ===
        new Date().toLocaleDateString(),
    );
  const filtered = data.consultations.filter(
    (c) =>
      (c.patient_name + " " + c.type)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "All statuses" || c.status === filter),
  );
  const filteredPatients = data.patients.filter((p) =>
    (p.name + " " + p.history + " " + p.allergies)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const reviewCount =
    selected?.flags.filter((f) => f.resolution === "Open").length ?? 0;
  const workflowStep =
    selected?.status === "Approved"
      ? 4
      : selected?.note
        ? reviewCount
          ? 2
          : 3
        : selected?.transcript
          ? 1
          : 0;
  const nav = [
    { name: "Overview", icon: LayoutDashboard },
    { name: "Consultations", icon: FileText },
    { name: "Patients", icon: Users },
    { name: "AI Evaluation", icon: FlaskConical },
    { name: "Analytics", icon: BarChart3 },
    { name: "Settings", icon: Settings },
  ] as const;
  const latestBaseline = data.evaluations.find(
      (e) => (!e.suite || e.suite === "extraction") && e.mode === "baseline",
    ),
    latestAI = data.evaluations.find(
      (e) => (!e.suite || e.suite === "extraction") && e.mode === "ai",
    );
  const table = (items: Consultation[], isFiltered = false) =>
    items.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Consultation</th>
              <th>Status</th>
              <th>Review flags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="row">
                    <span className="avatar">{initials(c.patient_name)}</span>
                    <div>
                      <strong>{c.patient_name}</strong>
                      <small>Synthetic patient · {c.id.slice(0, 8)}</small>
                    </div>
                  </div>
                </td>
                <td>
                  {c.type}
                  <small>
                    {date(c.created_at)} · {time(c.created_at)}
                  </small>
                </td>
                <td>
                  <Badge
                    kind={
                      c.status === "Approved"
                        ? "teal"
                        : c.status === "Draft"
                          ? "neutral"
                          : "amber"
                    }
                  >
                    {c.status === "Approved" && <Check size={12} />} {c.status}
                  </Badge>
                </td>
                <td>
                  {c.flags.filter((f) => f.resolution === "Open").length || "—"}
                </td>
                <td>
                  <button
                    className="icon"
                    aria-label={`Open consultation for ${c.patient_name}`}
                    onClick={() => openConsult(c)}
                  >
                    <ArrowUpRightIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : isFiltered ? (
      <div className="empty">
        <Search />
        <h3>No matching consultations</h3>
        <p>Try a different patient name or clear your filters.</p>
        <button
          onClick={() => {
            setSearch("");
            setFilter("All statuses");
          }}
        >
          Clear filters
        </button>
      </div>
    ) : (
      <div className="empty">
        <FileText />
        <h3>Your first consultation starts here</h3>
        <p>
          Select a synthetic patient, add a transcript, and review a structured
          draft.
        </p>
        <button onClick={start}>
          <Plus size={16} />
          Start a consultation
        </button>
      </div>
    );
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside
        id="workspace-navigation"
        className={`sidebar${navOpen ? " is-open" : ""}`}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brandmark">
            <AudioLines size={23} />
          </span>
          Noticioner <b>AI</b>
        </a>
        <div className="workspace-label">
          <span className="workspace-dot" />
          Clinical workspace<small>Research prototype</small>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }, index) => (
            <Fragment key={name}>
              {index === 3 && (
                <div className="nav-label nav-subgroup-label">
                  REVIEW &amp; SETTINGS
                </div>
              )}
              <button
                aria-label={name}
                aria-current={page === name ? "page" : undefined}
                title={name}
                disabled={busy}
                className={page === name ? "active" : ""}
                onClick={() => navigate(name)}
              >
                <Icon size={19} />
                {name}
                {name === "Consultations" && drafts.length > 0 && (
                  <span className="nav-count">{drafts.length}</span>
                )}
              </button>
            </Fragment>
          ))}
        </nav>
        <Link
          href="/doctor"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            color: "var(--teal)",
            fontWeight: 600,
          }}
        >
          <ShieldCheck size={18} /> Doctor login
        </Link>
        <div className="sidebar-bottom">
          <div className="review-first">
            <ShieldCheck size={23} />
            <strong>Built for human judgment</strong>
            <p>
              Every draft stays in your hands. Review, verify, then approve.
            </p>
          </div>
          <div className="profile">
            <span className="avatar dark">AM</span>
            <div>
              <strong>Workspace reviewer</strong>
              <small>Simulated clinician</small>
            </div>
            <button
              className="icon"
              aria-label="Settings"
              onClick={() => navigate("Settings")}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </aside>
      {navOpen && (
        <button
          className="mobile-nav-backdrop"
          type="button"
          aria-label="Dismiss navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu-button"
            type="button"
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
            aria-controls="workspace-navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{selected ? "Consultation workspace" : page}</strong>
          </div>
          <div className="top-actions">
            <span className="provider">
              <span
                className={`dot ${data.provider.configured ? "green" : ""}`}
              />
              {data.provider.configured
                ? `${data.provider.label} configured`
                : `${data.provider.label} not configured`}
            </span>
            <span className="top-divider" />
            <span className="avatar small-avatar">AM</span>
          </div>
        </header>
        <div className="prototype">
          <ShieldCheck size={14} />
          <span>
            Noticioner research prototype · Synthetic data · Simulated approval
          </span>
          <Badge>PROTOTYPE</Badge>
        </div>
        <main className="content" id="main-content">
          {message && (
            <div
              className={`toast ${messageKind}`}
              role={messageKind === "error" ? "alert" : "status"}
            >
              {messageKind === "error" ? (
                <AlertCircle size={18} />
              ) : (
                <CheckCheck size={18} />
              )}
              <span>{message}</span>
              <button
                className="icon"
                aria-label="Dismiss notification"
                onClick={() => setMessage("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {selected && currentPatient ? (
            <>
              <div className="page-heading">
                <div>
                  <button
                    className="text-button"
                    onClick={() => navigate("Consultations")}
                  >
                    <ArrowLeft size={15} />
                    Consultations
                  </button>
                  <h1>Consultation workspace</h1>
                  <p>
                    {currentPatient.name} · {selected.type} ·{" "}
                    {date(selected.created_at)}
                  </p>
                </div>
                <div className="row wrap">
                  <Badge
                    kind={selected.status === "Approved" ? "teal" : "amber"}
                  >
                    {selected.status}
                  </Badge>
                  <button
                    onClick={() =>
                      act(async () => {
                        setHistory(
                          await api<ActivityItem[]>(
                            `consultations/${selected.id}/audit`,
                          ),
                        );
                        setAuditOpen(true);
                      })
                    }
                  >
                    <Clock3 size={16} />
                    Activity
                  </button>
                  <a
                    className="button"
                    href={`/api/consultations/${selected.id}/pdf`}
                  >
                    <ArrowDownToLine size={16} />
                    Export PDF
                  </a>
                </div>
              </div>
              <div className="steps">
                {[
                  "Capture conversation",
                  "Generate draft",
                  "Review evidence",
                  "Approve record",
                ].map((s, i) => (
                  <div
                    key={s}
                    className={
                      i < workflowStep
                        ? "done"
                        : i === workflowStep
                          ? "current"
                          : ""
                    }
                    aria-current={i === workflowStep ? "step" : undefined}
                  >
                    <span>
                      {i < workflowStep ? <Check size={13} /> : i + 1}
                    </span>
                    {s}
                  </div>
                ))}
              </div>
              <div className="consult-grid">
                <aside className="card patient-context">
                  <span className="avatar big">
                    {initials(currentPatient.name)}
                  </span>
                  <h2>{currentPatient.name}</h2>
                  <Badge>Synthetic patient</Badge>
                  <dl>
                    <dt>Date of birth</dt>
                    <dd>{currentPatient.dob}</dd>
                    <dt>Recorded history</dt>
                    <dd>{currentPatient.history}</dd>
                    <dt>Recorded allergies</dt>
                    <dd>{currentPatient.allergies}</dd>
                    <dt>Current medications</dt>
                    <dd>{currentPatient.medications}</dd>
                  </dl>
                  <p className="small">
                    Existing context is shown for manual review. Draft
                    generation uses only the saved transcript.
                  </p>
                  <div className="divider" />
                  <div className="eyebrow">DOCUMENT DETAILS</div>
                  <p className="small">
                    Version {selected.version}
                    <br />
                    {selected.provider || "No draft generated"}
                    {selected.latency_ms !== null && (
                      <>
                        <br />
                        {(selected.latency_ms / 1000).toFixed(2)} seconds
                        processing
                      </>
                    )}
                  </p>
                  {selected.approved_at && (
                    <p className="small">
                      Simulated approval by {selected.approved_by}
                      <br />
                      {new Date(selected.approved_at).toLocaleString()}
                    </p>
                  )}
                </aside>
                <section className="card transcript-panel">
                  <div className="card-head">
                    <h2>
                      <AudioLines size={18} />
                      Conversation
                    </h2>
                    <Badge>{parseTranscript(transcript).length} segments</Badge>
                  </div>
                  <div className="panel-padding">
                    {selected.status !== "Approved" && (
                      <>
                        <Recorder
                          key={selected.id}
                          id={selected.id}
                          disabled={busy}
                          transcriptionConfigured={
                            data.provider.transcriptionConfigured
                          }
                          transcriptionLabel={data.provider.transcriptionLabel}
                          localTranscription={
                            data.provider.transcriptionProvider === "local"
                          }
                          transcriptionLanguages={
                            data.provider.transcriptionLanguages
                          }
                          onError={(error) => {
                            setMessageKind("error");
                            setMessage(error);
                          }}
                          onTranscript={(s) => {
                            if (
                              transcript !== selected.transcript &&
                              !window.confirm(
                                "Replace unsaved transcript with the transcription?",
                              )
                            )
                              return;
                            setTranscript(s);
                            setMessage(
                              "Transcription received. Review the text and save; AI generation infers speaker roles from context.",
                            );
                          }}
                        />
                      </>
                    )}
                    {
                      <div className="transcript-editor">
                        {" "}
                        <label htmlFor="transcript">
                          Paste or type transcript
                        </label>
                        <p className="small">
                          Paste the conversation as spoken. No speaker labels
                          are required. AI infers roles from context; uncertain
                          assignments remain visible for review.
                        </p>
                        <textarea
                          id="transcript"
                          disabled={busy}
                          className="transcript-input"
                          value={transcript}
                          onChange={(e) => setTranscript(e.target.value)}
                          readOnly={selected.status === "Approved"}
                          placeholder="Paste the conversation here. Speaker labels are optional."
                        />
                        {selected.status !== "Approved" && (
                          <div className="row between">
                            <span className="small">
                              {transcript === selected.transcript
                                ? "All transcript changes saved"
                                : "Unsaved changes · saving invalidates the current draft"}
                            </span>
                            <button
                              disabled={
                                busy || transcript === selected.transcript
                              }
                              onClick={() =>
                                act(async () => {
                                  const c = await api<Consultation>(
                                    `consultations/${selected.id}`,
                                    "PATCH",
                                    { transcript, version: selected.version },
                                  );
                                  update(c);
                                  await refresh();
                                })
                              }
                            >
                              Save transcript
                            </button>
                          </div>
                        )}
                      </div>
                    }
                    <div className="source-list">
                      <TranscriptTranslation
                        key={selected.id}
                        text={transcript}
                        endpoint={`consultations/${selected.id}/translate`}
                        configured={data.provider.configured}
                        disabled={busy}
                        onError={(error) => {
                          setMessage(error);
                          setMessageKind("error");
                        }}
                      />
                      <div className="eyebrow">SOURCE EVIDENCE</div>
                      {parseTranscript(selected.transcript).map((s) => (
                        <div
                          tabIndex={-1}
                          id={`evidence-${s.id}`}
                          className={`segment ${highlight === s.id ? "highlight" : ""}`}
                          key={s.id}
                        >
                          <div className="row between">
                            <strong>
                              {s.speaker === "Unknown"
                                ? "Original conversation"
                                : s.speaker}
                            </strong>
                            <span className="mono">{s.id}</span>
                          </div>
                          <p>{s.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
                <section className="card note-panel">
                  <div className="card-head">
                    <h2>
                      <Sparkles size={18} />
                      Documentation assistant
                    </h2>
                    <Badge kind="teal">REVIEW FIRST</Badge>
                  </div>
                  <div className="panel-padding">
                    {selected.status !== "Approved" && (
                      <div className="generation">
                        <strong>{data.provider.label} API</strong>
                        <p className="small">
                          {data.provider.configured
                            ? "Draft generation uses the configured Claude API. The result stays a draft for clinician review."
                            : "Configure the Claude API in the server environment before generating a draft."}
                        </p>
                        <button
                          className="primary wide"
                          disabled={
                            busy ||
                            editing ||
                            !data.provider.configured ||
                            !selected.transcript ||
                            transcript !== selected.transcript
                          }
                          onClick={() =>
                            act(
                              async () => {
                                update(
                                  await api<Consultation>(
                                    `consultations/${selected.id}/generate`,
                                    "POST",
                                    { mode: "ai" },
                                  ),
                                );
                                await refresh();
                              },
                              `Generating a draft with ${data.provider.label}…`,
                            )
                          }
                        >
                          {busy ? (
                            <Loader2 className="spin" size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          Generate draft
                        </button>
                      </div>
                    )}
                    {selected.note ? (
                      <>
                        <div
                          className={`review-summary ${selected.status === "Approved" ? "approved" : ""}`}
                        >
                          <ShieldCheck size={20} />
                          <div>
                            <strong>
                              {selected.status === "Approved"
                                ? "Approved in the simulated workflow"
                                : reviewCount
                                  ? `${reviewCount} review prompt${reviewCount === 1 ? "" : "s"} to address`
                                  : "Ready for your final review"}
                            </strong>
                            <p>
                              {selected.status === "Approved"
                                ? `Version ${selected.version} · Read-only record`
                                : "Verify source meaning before approving this document."}
                            </p>
                          </div>
                        </div>
                        <div className="row between">
                          <h3>
                            {selected.status === "Approved"
                              ? "Reviewed SOAP record"
                              : "SOAP draft"}
                          </h3>
                          {selected.status !== "Approved" && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                setEditing(!editing);
                                setEditNote(selected.note);
                              }}
                            >
                              {editing ? "Cancel editing" : "Edit note"}
                            </button>
                          )}
                        </div>
                        {sections.map((section) => (
                          <div className="soap-section" key={section}>
                            <h4>
                              <span>{section[0]}</span>
                              {section}
                            </h4>
                            {(editNote || selected.note)!.statements
                              .filter((s) => s.section === section)
                              .map((s) => (
                                <div className="statement" key={s.id}>
                                  {s.speaker && (
                                    <Badge
                                      kind={
                                        s.speakerBasis === "Inferred"
                                          ? "amber"
                                          : "neutral"
                                      }
                                    >
                                      {s.speaker} ·{" "}
                                      {s.speakerBasis === "Inferred"
                                        ? "AI-inferred role"
                                        : s.speakerBasis === "Explicit"
                                          ? "Source label"
                                          : "Role unclear"}
                                    </Badge>
                                  )}
                                  {editing ? (
                                    <textarea
                                      disabled={busy}
                                      aria-label={`Edit ${section} statement`}
                                      value={s.text}
                                      onChange={(e) =>
                                        setEditNote((n) =>
                                          n
                                            ? {
                                                statements: n.statements.map(
                                                  (st) =>
                                                    st.id === s.id
                                                      ? {
                                                          ...st,
                                                          text: e.target.value,
                                                        }
                                                      : st,
                                                ),
                                              }
                                            : n,
                                        )
                                      }
                                    />
                                  ) : (
                                    <p>{s.text}</p>
                                  )}
                                  <div className="row wrap">
                                    <Badge
                                      kind={
                                        s.certainty === "Supported"
                                          ? "teal"
                                          : "amber"
                                      }
                                    >
                                      {s.certainty === "Supported"
                                        ? "Source linked · verify meaning"
                                        : s.certainty}
                                    </Badge>
                                    {selected.flags
                                      .filter(
                                        (f) =>
                                          f.trust?.statementId === s.id &&
                                          f.trust.kind === "evidence",
                                      )
                                      .map((f) => (
                                        <Badge
                                          key={f.id}
                                          kind={
                                            f.trust!.status === "supported"
                                              ? "teal"
                                              : "amber"
                                          }
                                        >
                                          EvidenceGuard: {f.trust!.status}
                                        </Badge>
                                      ))}
                                    {s.evidence.map((e) => (
                                      <button
                                        className="evidence"
                                        key={e.segmentId + e.quote}
                                        title={`${e.segmentId}: ${e.quote}`}
                                        onClick={() => {
                                          setHighlight(e.segmentId);
                                          document
                                            .getElementById(
                                              `evidence-${e.segmentId}`,
                                            )
                                            ?.scrollIntoView({
                                              behavior: "smooth",
                                              block: "center",
                                            });
                                        }}
                                      >
                                        <Link2 size={12} />
                                        {e.segmentId}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            {!(editNote || selected.note)!.statements.some(
                              (s) => s.section === section,
                            ) && (
                              <p className="missing-text">
                                {section === "Assessment"
                                  ? "Assessment not established in the source conversation — clinician review required."
                                  : "Not documented in the source conversation."}
                              </p>
                            )}
                          </div>
                        ))}
                        {editing && (
                          <button
                            className="primary wide"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                update(
                                  await api<Consultation>(
                                    `consultations/${selected.id}/note`,
                                    "PATCH",
                                    {
                                      note: editNote,
                                      version: selected.version,
                                    },
                                  ),
                                );
                                await refresh();
                                setMessage(
                                  "Edits saved as a new version. Review flags have been recalculated.",
                                );
                              })
                            }
                          >
                            Save note edits
                          </button>
                        )}
                        {selected.status === "Approved" && (
                          <PatientSummaries
                            key={selected.id}
                            endpoint={`/api/consultations/${selected.id}/patient-summaries`}
                            sources={[
                              {
                                id: selected.id,
                                version: selected.version,
                                label: "Approved consultation",
                              },
                            ]}
                            canWrite
                            canApprove
                            personal
                            configured={data.provider.configured}
                          />
                        )}
                        {selected.status !== "Approved" && (
                          <button
                            disabled={
                              busy || editing || !data.provider.configured
                            }
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Send the current draft, cited sources and recorded patient context to the configured provider for a new semantic audit? This resets review dispositions.",
                                )
                              )
                                void act(async () => {
                                  update(
                                    await api<Consultation>(
                                      `consultations/${selected.id}/audit`,
                                      "POST",
                                      {
                                        version: selected.version,
                                        consent: true,
                                      },
                                    ),
                                  );
                                  await refresh();
                                });
                            }}
                          >
                            Retry semantic audit
                          </button>
                        )}
                        <details className="trust-detail">
                          <summary>
                            Trust Engine source and checker details
                          </summary>
                          {selected.flags
                            .filter((f) => f.trust)
                            .map((f) => (
                              <article key={f.id}>
                                <strong>
                                  {f.category} · {f.trust!.status} ·{" "}
                                  {f.trust!.statementId || f.trust!.target}
                                </strong>
                                <TrustSources finding={f.trust!} />
                              </article>
                            ))}
                        </details>
                        <div className="review-section">
                          <h3>
                            <ClipboardCheck size={18} />
                            Review prompts{" "}
                            <span>
                              {
                                selected.flags.filter(
                                  (f) =>
                                    f.trust?.required !== false &&
                                    f.resolution === "Open",
                                ).length
                              }{" "}
                              open
                            </span>
                          </h3>
                          <p className="small">
                            Documentation prompts, not proof of clinical error.
                            Limited synthetic allergy/medication rules are
                            available; comprehensive interaction checking is
                            unavailable.
                          </p>
                          {selected.flags
                            .filter((f) => f.trust?.required !== false)
                            .map((f) => (
                              <button
                                key={f.id}
                                className={`flag ${f.resolution !== "Open" ? "resolved" : ""}`}
                                disabled={
                                  busy ||
                                  editing ||
                                  selected.status === "Approved"
                                }
                                onClick={() => {
                                  setMessage("");
                                  setFlag(f);
                                  setReviewNote(f.note);
                                  setResolution(
                                    f.resolution === "Open"
                                      ? "Addressed"
                                      : f.resolution,
                                  );
                                }}
                              >
                                <span>
                                  {f.resolution === "Open" ? (
                                    <AlertCircle size={17} />
                                  ) : (
                                    <CheckCheck size={17} />
                                  )}
                                </span>
                                <div>
                                  <strong>{f.category}</strong>
                                  <p>{f.message}</p>
                                  <small>
                                    {f.priority} · {f.resolution}
                                  </small>
                                </div>
                                <ChevronRight size={14} />
                              </button>
                            ))}
                        </div>
                        {selected.status !== "Approved" && (
                          <button
                            className="primary wide"
                            disabled={
                              busy ||
                              editing ||
                              transcript !== selected.transcript
                            }
                            onClick={() => {
                              setMessage("");
                              setApproval(true);
                            }}
                          >
                            <ShieldCheck size={17} />
                            Review & approve
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="empty compact">
                        <Sparkles />
                        <h3>A clear record starts with a conversation</h3>
                        <p>
                          Save a transcript, then generate a draft. Statements
                          will link back to their original source.
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </>
          ) : page === "Overview" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR DAY, AT A GLANCE</div>
                  <h1>
                    Your documentation workspace{" "}
                    <span className="greeting-dot">.</span>
                  </h1>
                  <p>A little less paperwork. A little more time for people.</p>
                </div>
                <button className="primary" onClick={start}>
                  <Plus size={18} />
                  Start new consultation
                </button>
              </div>
              <div className="stats-grid">
                {[
                  {
                    label: "Consultations today",
                    value: today.length,
                    sub: "From your saved workspace",
                    icon: Stethoscope,
                  },
                  {
                    label: "Awaiting review",
                    value: drafts.length,
                    sub: "Your judgment makes the difference",
                    icon: ClipboardCheck,
                  },
                  {
                    label: "Approved records",
                    value: approved.length,
                    sub: "Simulated clinician approval",
                    icon: CheckCheck,
                  },
                  {
                    label: "Generated drafts",
                    value: data.consultations.filter((c) => c.note).length,
                    sub: "Saved drafts with source references",
                    icon: FileText,
                  },
                ].map(({ label, value, sub, icon: Icon }) => (
                  <div className="stat card" key={label}>
                    <div className="row between">
                      <span>{label}</span>
                      <Icon size={19} />
                    </div>
                    <strong className="stat-value">
                      {value.toString().padStart(2, "0")}
                    </strong>
                    <small>{sub}</small>
                  </div>
                ))}
              </div>
              <section className="hero-card">
                <div>
                  <Badge kind="light">THOUGHTFUL DOCUMENTATION</Badge>
                  <h2>From conversation to clarity.</h2>
                  <p>
                    Capture the story. Connect every statement to its source.
                    <br />
                    Create a record you can confidently review.
                  </p>
                  <button onClick={() => navigate("Consultations")}>
                    View consultations
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="hero-visual" aria-hidden="true">
                  <div className="wave">
                    {Array.from({ length: 27 }, (_, i) => (
                      <i
                        key={i}
                        style={{
                          height: 12 + Math.abs(Math.sin(i * 1.17)) * 55,
                        }}
                      />
                    ))}
                  </div>
                  <div className="mini-note">
                    <div className="row">
                      <span className="mini-icon">
                        <FileText size={18} />
                      </span>
                      <strong>Structured. Traceable. Yours.</strong>
                      <Check size={16} />
                    </div>
                    <div className="fake-lines">
                      <i />
                      <i />
                      <i />
                    </div>
                    <span>
                      <Link2 size={12} />
                      Evidence stays connected
                    </span>
                  </div>
                </div>
              </section>
              <div className="dashboard-grid">
                <section className="card">
                  <div className="card-head">
                    <div>
                      <h2>Recent consultations</h2>
                      <p>Pick up right where you left off.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("Consultations")}
                    >
                      View all
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {table(data.consultations.slice(0, 5))}
                </section>
                <aside className="card">
                  <div className="card-head">
                    <h2>Review queue</h2>
                    <Badge kind="amber">{drafts.length}</Badge>
                  </div>
                  <div className="queue">
                    {drafts.length ? (
                      drafts.slice(0, 4).map((c) => (
                        <button
                          key={c.id}
                          className="queue-item"
                          onClick={() => openConsult(c)}
                        >
                          <span className="avatar">
                            {initials(c.patient_name)}
                          </span>
                          <div>
                            <strong>{c.patient_name}</strong>
                            <small>
                              {c.note
                                ? `${c.flags.filter((f) => f.resolution === "Open").length} review prompts`
                                : "Transcript or draft needed"}
                            </small>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                      ))
                    ) : (
                      <div className="empty compact">
                        <CheckCheck />
                        <h3>You’re all caught up</h3>
                        <p>New drafts will appear here for review.</p>
                      </div>
                    )}
                    <div className="queue-footer">
                      <ShieldCheck size={16} />
                      Nothing is approved automatically.
                    </div>
                  </div>
                </aside>
              </div>
              <section className="activity-strip">
                <h3>Recent activity</h3>
                {data.activity.slice(0, 3).map((a) => (
                  <div key={a.id}>
                    <span className="activity-dot" />
                    <span>{a.action}</span>
                    <small>{time(a.created_at)}</small>
                  </div>
                ))}
              </section>
            </>
          ) : page === "Consultations" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR DOCUMENTATION</div>
                  <h1>Consultations</h1>
                  <p>
                    Every conversation, draft, and reviewed record in one place.
                  </p>
                </div>
                <button className="primary" onClick={start}>
                  <Plus size={17} />
                  Start new consultation
                </button>
              </div>
              <div className="card">
                <div className="filters">
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search consultations"
                      placeholder="Search patient or consultation type…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filter by status"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "All statuses",
                      "Draft",
                      "Needs Review",
                      "Reviewed",
                      "Approved",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                {table(filtered, !!search || filter !== "All statuses")}
              </div>
            </>
          ) : page === "Patients" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">SYNTHETIC PATIENT DIRECTORY</div>
                  <h1>People, with context.</h1>
                  <p>
                    Demonstration profiles only. Never enter real patient
                    information.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() =>
                    setPatientForm({
                      id: "",
                      name: "",
                      dob: "1990-01-01",
                      history: "Synthetic record.",
                      allergies: "Unknown",
                      medications: "Not documented",
                    })
                  }
                >
                  <Plus size={17} />
                  Add synthetic patient
                </button>
              </div>
              <label className="search patient-search">
                <Search size={18} />
                <input
                  aria-label="Search patients"
                  placeholder="Search name, allergies or history…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {filteredPatients.length === 0 && (
                <div className="card empty">
                  <Search />
                  <h3>
                    {search.trim() ? "No matching patients" : "No patients yet"}
                  </h3>
                  <p>
                    {search.trim()
                      ? "Search by name, history or recorded allergy."
                      : "Add a fictional patient profile to begin your first consultation."}
                  </p>
                  {search.trim() && (
                    <button onClick={() => setSearch("")}>Clear search</button>
                  )}
                </div>
              )}
              <div className="patient-grid">
                {filteredPatients.map((p) => (
                  <button
                    className="card patient-card"
                    key={p.id}
                    onClick={() => {
                      setMessage("");
                      setProfile(p);
                    }}
                  >
                    <div className="row between">
                      <span className="avatar big">{initials(p.name)}</span>
                      <ArrowRight size={18} />
                    </div>
                    <h2>{p.name}</h2>
                    <p>Born {p.dob} · Synthetic patient</p>
                    <div className="divider" />
                    <span className="eyebrow">RECORDED HISTORY</span>
                    <p>{p.history}</p>
                    <small>
                      {
                        data.consultations.filter((c) => c.patient_id === p.id)
                          .length
                      }{" "}
                      consultations
                    </small>
                  </button>
                ))}
              </div>
            </>
          ) : page === "AI Evaluation" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">EVIDENCE OVER ASSUMPTIONS</div>
                  <h1>How well does it document?</h1>
                  <p>Measured extraction results. Transparent limitations.</p>
                </div>
                <div className="row wrap">
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await api("evaluation/run", "POST", {
                          mode: "baseline",
                        });
                        await refresh();
                      })
                    }
                  >
                    <Play size={16} />
                    Run baseline
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await api("evaluation/run", "POST", { mode: "ai" });
                        await refresh();
                      })
                    }
                  >
                    {busy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <FlaskConical size={16} />
                    )}
                    Run AI evaluation
                  </button>
                </div>
              </div>
              <div className="notice">
                8 synthetic test cases · Author-written reference labels, not
                independently or clinically reviewed. This is a small,
                development-visible test set, not clinical validation or an
                unbiased held-out benchmark.
              </div>
              <TrustQuality configured={data.provider.configured} />
              <div className="evaluation-grid">
                {[latestBaseline, latestAI].map((r, i) => (
                  <section className="card metric-card" key={i}>
                    <div className="row between">
                      <h2>{i ? "AI pipeline" : "Keyword baseline"}</h2>
                      <Badge kind={r ? "teal" : "neutral"}>
                        {r ? "Measured" : "Not yet evaluated"}
                      </Badge>
                    </div>
                    {r ? (
                      <>
                        <p className="small">
                          {r.model} · {r.sampleSize} cases ·{" "}
                          {new Date(r.createdAt).toLocaleString()}
                        </p>
                        <div className="metric-trio">
                          <div>
                            <strong>{pct(r.precision)}</strong>
                            <small>Precision</small>
                          </div>
                          <div>
                            <strong>{pct(r.recall)}</strong>
                            <small>Recall</small>
                          </div>
                          <div>
                            <strong>{pct(r.f1)}</strong>
                            <small>F1</small>
                          </div>
                        </div>
                        <dl className="metric-list">
                          <dt>False positives / negatives</dt>
                          <dd>
                            {r.fp} / {r.fn}
                          </dd>
                          <dt>Unsupported statement rate</dt>
                          <dd>{pct(r.unsupportedRate)}</dd>
                          <dt>Evidence attribution accuracy</dt>
                          <dd>{pct(r.evidenceAccuracy)}</dd>
                          <dt>Structured output validity</dt>
                          <dd>{pct(r.validity)}</dd>
                          <dt>Mean processing latency</dt>
                          <dd>{r.latencyMs.toFixed(0)} ms</dd>
                        </dl>
                      </>
                    ) : (
                      <div className="empty compact">
                        <FlaskConical />
                        <p>
                          {i
                            ? "Configure a provider and run the same test cases. No AI scores are invented."
                            : "Run the deterministic baseline to establish a reproducible comparison."}
                        </p>
                      </div>
                    )}
                  </section>
                ))}
              </div>
              {(latestBaseline || latestAI) && (
                <section className="card chart-card">
                  <h2>Extraction performance</h2>
                  <div style={{ height: 260 }}>
                    <ExtractionChart
                      data={
                        (["precision", "recall", "f1"] as const).map((key) => ({
                          name: key.toUpperCase(),
                          ...(latestBaseline && {
                            Baseline: Number(
                              (latestBaseline[key] * 100).toFixed(1),
                            ),
                          }),
                          ...(latestAI && {
                            AI: Number((latestAI[key] * 100).toFixed(1)),
                          }),
                        })) as ExtractionChartDatum[]
                      }
                    />
                  </div>
                </section>
              )}
              {(latestAI || latestBaseline)?.byCategory && (
                <section className="card chart-card">
                  <h2>Performance by extraction category</h2>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Precision</th>
                          <th>Recall</th>
                          <th>F1</th>
                          <th>FP / FN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(latestAI || latestBaseline)!.byCategory.map((c) => (
                          <tr key={c.category}>
                            <td>{c.category}</td>
                            <td>{pct(c.precision)}</td>
                            <td>{pct(c.recall)}</td>
                            <td>{pct(c.f1)}</td>
                            <td>
                              {c.fp} / {c.fn}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="small">
                    Showing the latest {latestAI ? "AI" : "baseline"} run.
                    Categories with no reference facts have zero recall by
                    convention.
                  </p>
                </section>
              )}
              <section className="card">
                <div className="card-head">
                  <h2>Case-level inspection</h2>
                  <Badge>Successes & failure cases</Badge>
                </div>
                {(latestAI || latestBaseline)?.examples.map((e) => (
                  <details className="case" key={e.id}>
                    <summary>
                      {e.name}
                      <Badge kind={e.facts.fp + e.facts.fn ? "amber" : "teal"}>
                        {e.facts.fp} FP · {e.facts.fn} FN
                      </Badge>
                    </summary>
                    <p>Expected: {e.expected.join(", ")}</p>
                    <p>Extracted: {e.predicted.join(", ") || "None"}</p>
                    <p>
                      Missing: {e.missing.join(", ") || "None"} · Extra:{" "}
                      {e.extra.join(", ") || "None"}
                    </p>
                    <p>
                      Flag precision {pct(e.flags.precision)} · recall{" "}
                      {pct(e.flags.recall)}
                    </p>
                    {e.error && <p className="error">{e.error}</p>}
                  </details>
                )) || (
                  <div className="empty compact">
                    Run an evaluation to inspect individual results.
                  </div>
                )}
              </section>
              <section className="methodology">
                <h3>What the numbers mean</h3>
                <p>
                  Facts are matched by source segment ID and extraction
                  category. Precision = correct predictions / all predictions.
                  Recall = correct predictions / reference facts. F1 is their
                  harmonic mean. Evidence accuracy measures reference
                  category–segment matches, not semantic correctness.
                  Unsupported rate counts statements without validated source
                  evidence. Validity counts responses accepted by the schema.
                  Flag metrics are separate.
                </p>
                <p>
                  Source linking does not prove a summary is accurate. These
                  tests do not evaluate medical safety, diagnostic accuracy, or
                  audio transcription quality.
                </p>
              </section>
            </>
          ) : page === "Analytics" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">WORKSPACE ACTIVITY</div>
                  <h1>Your documentation, in perspective.</h1>
                  <p>
                    Calculated exclusively from this workspace’s saved
                    consultations.
                  </p>
                </div>
              </div>
              <div className="stats-grid">
                {[
                  {
                    label: "Total consultations",
                    v: data.consultations.length,
                  },
                  { label: "Approved", v: approved.length },
                  {
                    label: "Open review prompts",
                    v: data.consultations.reduce(
                      (n, c) =>
                        n +
                        c.flags.filter((f) => f.resolution === "Open").length,
                      0,
                    ),
                  },
                  { label: "Synthetic patients", v: data.patients.length },
                ].map((s) => (
                  <div className="card stat" key={s.label}>
                    <span>{s.label}</span>
                    <strong className="stat-value">{s.v}</strong>
                  </div>
                ))}
              </div>
              <div className="card chart-card">
                <h2>Consultations by status</h2>
                <div style={{ height: 300 }}>
                  <ConsultationStatusChart
                    data={
                      ["Draft", "Needs Review", "Reviewed", "Approved"].map(
                        (s) => ({
                          status: s,
                          count: data.consultations.filter(
                            (c) => c.status === s,
                          ).length,
                        }),
                      ) as StatusChartDatum[]
                    }
                  />
                </div>
              </div>
              <div className="notice">
                Documentation time savings are not measured. This dashboard
                makes no productivity or clinical performance claims.
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">WORKSPACE PREFERENCES</div>
                  <h1>Settings & transparency</h1>
                  <p>A clear view of what powers this prototype.</p>
                </div>
              </div>
              <div className="settings-grid">
                <section className="card settings-card">
                  <h2>
                    <Sparkles size={20} />
                    AI provider
                  </h2>
                  <Badge kind={data.provider.configured ? "teal" : "amber"}>
                    {data.provider.configured
                      ? "Configured on server"
                      : "Not configured"}
                  </Badge>
                  <dl>
                    <dt>Documentation model</dt>
                    <dd>{data.provider.model}</dd>
                    <dt>
                      Audio transcription{" "}
                      {data.provider.transcriptionConfigured
                        ? "(configured)"
                        : "(optional · not configured)"}
                    </dt>
                    <dd>
                      {data.provider.transcriptionLabel} ·{" "}
                      {data.provider.transcriptionModel}
                    </dd>
                  </dl>
                  <p>
                    Add your key to .env.local, then restart the app. Claude can
                    generate the note from a pasted or recorded transcript; no
                    audio provider is needed for that workflow.
                  </p>
                  <pre className="provider-config">{`# Claude
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key_here
CLAUDE_MODEL=claude-sonnet-5-5`}</pre>
                  <p className="small">
                    For OpenAI-compatible generation, set AI_PROVIDER=openai and
                    OPENAI_API_KEY. Audio can use Local Whisper with
                    STT_PROVIDER=local, or a separate API with STT_API_KEY /
                    STT_BASE_URL. Never put keys in a video or screenshot.
                  </p>
                  <p>
                    Actual provider errors are shown when a request runs.
                    “Configured” does not mean that a live request has
                    succeeded.
                  </p>
                </section>
                <section className="card settings-card">
                  <h2>
                    <ShieldCheck size={20} />
                    Research boundaries
                  </h2>
                  <p>
                    Noticioner AI is a research prototype. Use synthetic
                    demonstration data only. It is not intended for clinical
                    use.
                  </p>
                  <p>
                    No diagnostic recommendations, executable prescriptions,
                    medication interaction checking, regulatory certification,
                    or legally valid medical signatures.
                  </p>
                  <p>This project is a prototype and is not medical advice.</p>
                </section>
                <section className="card settings-card">
                  <h2>
                    <Trash2 size={20} />
                    Your workspace data
                  </h2>
                  <p>
                    SQLite stores your synthetic patients, consultations, note
                    versions, application activity and evaluation runs. Audio
                    stays in browser memory and is sent to your configured
                    provider only when you choose Transcribe.
                  </p>
                  <button
                    className="danger"
                    onClick={() => setDeletion("workspace")}
                  >
                    Delete workspace data
                  </button>
                  <p className="small">
                    Deleting removes this workspace and ends your session. No
                    recovery is provided.
                  </p>
                </section>
              </div>
            </>
          )}
          {selected && (
            <div className="record-footer">
              <span>
                Application-level activity history · not a certified medical
                audit trail
              </span>
              <button
                className="text-button danger-text"
                onClick={() => setDeletion("consultation")}
              >
                <Trash2 size={14} />
                Delete consultation
              </button>
            </div>
          )}
          <footer>
            Noticioner AI <span>Human judgment. Clear documentation.</span>
            <span>Research prototype · 2026</span>
          </footer>
        </main>
      </div>
      {newOpen && (
        <Modal
          pending={busy}
          error={messageKind === "error" ? message : undefined}
          title="Start a consultation"
          close={() => setNewOpen(false)}
        >
          <p className="muted">
            Choose a synthetic patient to begin a new record.
          </p>
          <label>
            Patient
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
            >
              {data.patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · Synthetic
                </option>
              ))}
            </select>
          </label>
          <label>
            Consultation type
            <select
              value={consultType}
              onChange={(e) => setConsultType(e.target.value)}
            >
              {["General consultation", "Follow-up", "Medication review"].map(
                (t) => (
                  <option key={t}>{t}</option>
                ),
              )}
            </select>
          </label>
          <div className="notice">
            No recording begins automatically. You can paste a transcript or
            record a conversation.
          </div>
          <button
            className="primary wide"
            disabled={busy || !patientId}
            onClick={() =>
              act(async () => {
                const c = await api<Consultation>("consultations", "POST", {
                  patientId,
                  type: consultType,
                });
                await refresh();
                openConsult(c);
                setNewOpen(false);
              })
            }
          >
            Create consultation
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {flag && selected && (
        <Modal
          pending={busy}
          error={messageKind === "error" ? message : undefined}
          title="Review documentation prompt"
          close={() => setFlag(null)}
        >
          <Badge kind="amber">{flag.category}</Badge>
          <p>{flag.message}</p>
          {flag.segmentId && (
            <button
              onClick={() => {
                setHighlight(flag.segmentId!);
                setFlag(null);
                setTimeout(
                  () =>
                    document
                      .getElementById(`evidence-${flag.segmentId}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" }),
                  100,
                );
              }}
            >
              <Link2 size={16} />
              View source {flag.segmentId}
            </button>
          )}
          <label>
            Resolution
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            >
              <option>Addressed</option>
              <option>Not applicable</option>
            </select>
          </label>
          <label>
            Reviewer note
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Explain how you addressed this prompt or why it does not apply."
            />
          </label>
          <button
            className="primary wide"
            disabled={busy || reviewNote.trim().length < 3}
            onClick={() =>
              act(async () => {
                update(
                  await api<Consultation>(
                    `consultations/${selected.id}/flags`,
                    "PATCH",
                    {
                      id: flag.id,
                      resolution,
                      note: reviewNote,
                      version: selected.version,
                    },
                  ),
                );
                setFlag(null);
                await refresh();
              })
            }
          >
            Save review action
          </button>
        </Modal>
      )}
      {approval && selected && (
        <Modal
          pending={busy}
          error={messageKind === "error" ? message : undefined}
          title="Simulated clinician approval"
          close={() => setApproval(false)}
        >
          <p>
            You are approving version <strong>{selected.version}</strong> as Dr.
            Morgan (simulated). Approved records become read-only.
          </p>
          <div className="notice">
            {selected.flags.filter((f) => f.resolution === "Open").length}{" "}
            unresolved review prompts. All prompts must be addressed or marked
            not applicable with a note.
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed every statement against its source, checked the draft and
            acknowledged all warnings.
          </label>
          <p className="small">
            This is a demonstration approval, not a legally valid medical
            signature.
          </p>
          <button
            className="primary wide"
            disabled={
              busy ||
              !reviewed ||
              selected.flags.some(
                (f) => f.trust?.required !== false && f.resolution === "Open",
              )
            }
            onClick={() =>
              act(async () => {
                update(
                  await api<Consultation>(
                    `consultations/${selected.id}/approve`,
                    "POST",
                    {
                      confirmed: true,
                      reviewed: true,
                      version: selected.version,
                    },
                  ),
                );
                setApproval(false);
                await refresh();
                setMessage(
                  "Record approved in the simulated workflow. You can now export the final version.",
                );
              })
            }
          >
            <ShieldCheck size={17} />
            Confirm simulated approval
          </button>
        </Modal>
      )}
      {profile && (
        <Modal
          pending={busy}
          error={messageKind === "error" ? message : undefined}
          title={profile.name}
          close={() => setProfile(null)}
        >
          <Badge>Synthetic patient · {profile.id.slice(0, 8)}</Badge>
          <dl>
            <dt>Date of birth</dt>
            <dd>{profile.dob}</dd>
            <dt>History</dt>
            <dd>{profile.history}</dd>
            <dt>Allergies</dt>
            <dd>{profile.allergies}</dd>
            <dt>Medications</dt>
            <dd>{profile.medications}</dd>
          </dl>
          <button
            onClick={() => {
              setPatientForm(profile);
              setProfile(null);
            }}
          >
            Edit synthetic profile
          </button>
          <h3>Consultation history</h3>
          {data.consultations
            .filter((c) => c.patient_id === profile.id)
            .map((c) => (
              <button
                className="queue-item wide"
                key={c.id}
                onClick={() => {
                  openConsult(c);
                  setProfile(null);
                }}
              >
                {date(c.created_at)} · {c.type}
                <Badge>{c.status}</Badge>
              </button>
            ))}
          <button
            className="primary wide"
            onClick={() => {
              setPatientId(profile.id);
              setProfile(null);
              setNewOpen(true);
            }}
          >
            Start consultation
          </button>
        </Modal>
      )}
      {patientForm && (
        <Modal
          pending={busy}
          error={messageKind === "error" ? message : undefined}
          title={
            patientForm.id ? "Edit synthetic patient" : "New synthetic patient"
          }
          close={() => setPatientForm(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api(
                  `patients${patientForm.id ? "/" + patientForm.id : ""}`,
                  patientForm.id ? "PATCH" : "POST",
                  patientForm,
                );
                setPatientForm(null);
                await refresh();
              });
            }}
          >
            {(
              ["name", "dob", "history", "allergies", "medications"] as const
            ).map((k) => (
              <label key={k}>
                {
                  {
                    name: "Name",
                    dob: "Date of birth",
                    history: "Relevant simulated history",
                    allergies: "Recorded allergies",
                    medications: "Current medications",
                  }[k]
                }
                <input
                  required={k === "name" || k === "dob"}
                  type={k === "dob" ? "date" : "text"}
                  value={patientForm[k]}
                  onChange={(e) =>
                    setPatientForm({ ...patientForm, [k]: e.target.value })
                  }
                />
              </label>
            ))}
            <button className="primary wide" disabled={busy}>
              Save synthetic patient
            </button>
          </form>
        </Modal>
      )}
      {deletion && (
        <Modal
          pending={busy}
          error={messageKind === "error" ? message : undefined}
          title={
            deletion === "workspace"
              ? "Delete this workspace?"
              : "Delete this consultation?"
          }
          close={() => setDeletion(null)}
        >
          <p>
            This permanently removes{" "}
            {deletion === "workspace"
              ? "all synthetic data in this workspace"
              : "the consultation, its note versions and associated activity"}
            . This action cannot be undone.
          </p>
          <button
            className="danger wide"
            disabled={busy}
            onClick={() =>
              act(async () => {
                if (deletion === "workspace") {
                  await api("workspace", "DELETE");
                  setSelected(null);
                  setPage("Overview");
                  await refresh();
                } else {
                  await api(`consultations/${selected!.id}`, "DELETE");
                  setSelected(null);
                  await refresh();
                }
                setDeletion(null);
              })
            }
          >
            Permanently delete
          </button>
        </Modal>
      )}
      {auditOpen && (
        <Modal
          pending={busy}
          error={messageKind === "error" ? message : undefined}
          title="Application activity history"
          close={() => setAuditOpen(false)}
        >
          <p className="small">
            Server timestamps. This is not a certified tamper-proof medical
            audit system.
          </p>
          {history.map((a) => (
            <div className="audit-row" key={a.id}>
              <Activity size={15} />
              <div>
                <strong>{a.action}</strong>
                <small>{new Date(a.created_at).toLocaleString()}</small>
              </div>
            </div>
          ))}
        </Modal>
      )}
      {busy && (
        <div className="working" role="status">
          <Loader2 className="spin" size={17} />
          {busyLabel}
        </div>
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={17} style={{ transform: "rotate(-35deg)" }} />;
}
