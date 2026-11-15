"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  FileText,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";
import "../practice/practice.css";

type Session = {
  demo?: boolean;
  configured: boolean;
  authenticated: boolean;
  actor?: { displayName: string; role: string };
  organizations?: { id: string; name: string }[];
};

export default function DoctorPortal() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/practice-auth/session", {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "The doctor sign-in service is unavailable. Try again or contact your administrator.",
        );
      setSession(await response.json());
      setError(
        new URLSearchParams(window.location.search).get("authError") || "",
      );
    } catch (error) {
      setSession(null);
      setError(
        error instanceof Error ? error.message : "Sign-in is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="practice">
      <header className="pr-header">
        <Link href="/doctor" className="pr-brand">
          <span>
            <Building2 size={23} />
          </span>
          Noticioner <b>Doctor portal</b>
        </Link>
        <Link href={session?.demo ? "/doctor" : "/"}>
          <ArrowLeft size={15} />{" "}
          {session?.demo ? "Sample hospital" : "Personal workspace"}
        </Link>
      </header>
      <main className="pr-gateway">
        <span className="pr-eyebrow">DOCTOR ACCESS · CONNECTED CARE</span>
        <h1>
          Your practice.
          <br />
          Your authorized patients.
        </h1>
        <p className="pr-lead">
          Sign in with your hospital or practice account to open shared patient
          records, review notes and work with your care team.
        </p>
        {session?.demo && (
          <p className="pr-message" role="status">
            Sample hospital demonstration · synthetic records · simulated
            identity verification
          </p>
        )}
        <section className="pr-gateway-card" aria-label="Doctor sign-in">
          {loading ? (
            <>
              <Loader2 className="spin" />
              <h2>Checking your session</h2>
            </>
          ) : session?.authenticated ? (
            <>
              <ShieldCheck size={28} />
              <h2>Welcome, {session.actor?.displayName}</h2>
              <p>
                {session.actor?.role} ·{" "}
                {session.organizations
                  ?.map((organization) => organization.name)
                  .join(", ")}
              </p>
              <Link className="pr-primary" href="/practice">
                Open patient records <ArrowUpRight size={17} />
              </Link>
            </>
          ) : session?.configured ? (
            <>
              <LockKeyhole size={28} />
              <h2>Doctor sign-in</h2>
              <p>
                {session.demo
                  ? "Use one of the sample doctor accounts on the next screen. The displayed verification code simulates the hospital sign-in step; it is not real MFA."
                  : "Use your organization account and its required multi-factor authentication. Your care assignments determine what you can view or change."}
              </p>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="pr-primary" href="/api/practice-auth/login">
                Sign in with organization <ArrowUpRight size={17} />
              </a>
              <p className="small">
                Need access? Your practice administrator must provision your
                account and patient assignments.
              </p>
            </>
          ) : (
            <>
              <LockKeyhole size={28} />
              <h2>Organization sign-in needs setup</h2>
              <p>
                Your administrator must connect the practice database and
                organization identity provider before doctor accounts can sign
                in.
              </p>
              <p className="small">
                The personal workspace remains available for synthetic
                demonstrations.
              </p>
            </>
          )}
          {error && (
            <p className="pr-error" role="alert">
              {error}
            </p>
          )}
          {!loading && (
            <button type="button" onClick={() => void load()}>
              Check connection again
            </button>
          )}
        </section>
        <details className="pr-about">
          <summary>How shared records work</summary>
          <div className="pr-principles">
            <div>
              <Users />
              <strong>Care-team access</strong>
              <p>
                View-only or editing access follows each patient assignment.
              </p>
            </div>
            <div>
              <FileText />
              <strong>Shared clinical history</strong>
              <p>
                Notes, medications and source documents stay with the patient
                record.
              </p>
            </div>
            <div>
              <ShieldCheck />
              <strong>Reviewed decisions</strong>
              <p>
                Approval requires an authorized reviewer. Access and changes are
                audited.
              </p>
            </div>
          </div>
        </details>
        <p className="pr-footnote">
          Research implementation · synthetic data only until institutional
          deployment review
        </p>
      </main>
    </div>
  );
}
