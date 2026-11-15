import type { AuditInput, TrustSource } from "./trust-engine";
import type { Statement } from "./clinical";
export type TrustFixture = {
  id: string;
  name: string;
  category: "evidence" | "gaps" | "consistency" | "safety";
  input: AuditInput;
  expected: string[];
};
const source = (id: string, text: string): TrustSource => ({
  id,
  text,
  type: "note",
  version: 1,
});
const statement = (
  text: string,
  quote = text,
  segmentId = "s1",
): Statement => ({
  id: "c1",
  text,
  section: "Subjective",
  category: "other",
  certainty: "Uncertain",
  evidence: [{ segmentId, quote }],
});
const fixture = (
  id: string,
  category: TrustFixture["category"],
  name: string,
  sources: TrustSource[],
  claim: Statement,
  expected: string[],
  includeGaps = false,
): TrustFixture => ({
  id,
  category,
  name,
  input: { note: { statements: [claim] }, sources, includeGaps },
  expected,
});
const neutral = source("s1", "A fictional consultation was recorded.");
const general =
  "Allergy status unknown. Medication history unknown. Duration unknown. Follow-up not decided. Examination declined. Severity unknown. Associated symptoms unknown.";
export const trustFixtures: TrustFixture[] = [
  fixture(
    "e1",
    "evidence",
    "Unknown source ID",
    [source("s1", "Cough.")],
    statement("Cough.", "Cough.", "absent"),
    ["evidence:c1"],
  ),
  fixture(
    "e2",
    "evidence",
    "Quote does not exist",
    [source("s1", "Cough.")],
    statement("Fever.", "Fever."),
    ["evidence:c1"],
  ),
  fixture(
    "e3",
    "evidence",
    "Negation reversal",
    [source("s1", "No fever.")],
    statement("Fever.", "No fever."),
    ["evidence:c1", "consistency:c1|source:s1"],
  ),
  fixture(
    "e4",
    "evidence",
    "Exact wording is not semantic certification",
    [source("s1", "Cough.")],
    statement("Cough."),
    [],
  ),
  fixture(
    "e5",
    "evidence",
    "Ambiguous source stays unchecked",
    [source("s1", "Maybe a fever.")],
    statement("Maybe a fever."),
    [],
  ),
  fixture(
    "e6",
    "evidence",
    "Explicit denial retained",
    [source("s1", "No cough.")],
    statement("No cough."),
    [],
  ),
  ...(["allergy", "medication", "duration", "severity"] as const).map(
    (key, i) => {
      const text = general
        .split(". ")
        .filter((t) => !t.toLowerCase().startsWith(key))
        .join(". ");
      return fixture(
        `g${i + 1}`,
        "gaps",
        `${key} not established`,
        [source("s1", text)],
        statement(text),
        [`gaps:${key}`],
        true,
      );
    },
  ),
  fixture(
    "g5",
    "gaps",
    "Explicit unknowns are documented",
    [source("s1", general)],
    statement(general),
    [],
    true,
  ),
  fixture(
    "g6",
    "gaps",
    "Denials are not missing information",
    [
      source(
        "s1",
        general
          .replace("Allergy status unknown", "No known allergies")
          .replace("Medication history unknown", "No medication"),
      ),
    ],
    statement(
      general
        .replace("Allergy status unknown", "No known allergies")
        .replace("Medication history unknown", "No medication"),
    ),
    [],
    true,
  ),
  fixture(
    "c1",
    "consistency",
    "Conflicting negation",
    [neutral, source("a", "No cough."), source("b", "Cough present.")],
    statement(neutral.text),
    ["consistency:source:a|source:b"],
  ),
  fixture(
    "c2",
    "consistency",
    "Conflicting follow-up dates",
    [
      neutral,
      source("a", "Follow-up date 2026-11-20."),
      source("b", "Follow-up date 2026-11-21."),
    ],
    statement(neutral.text),
    ["consistency:source:a|source:b"],
  ),
  fixture(
    "c3",
    "consistency",
    "Conflicting doses",
    [
      neutral,
      source("a", "Metformin 500 mg once daily."),
      source("b", "Metformin 1000 mg once daily."),
    ],
    statement(neutral.text),
    ["consistency:source:a|source:b"],
  ),
  fixture(
    "c4",
    "consistency",
    "Explicit correction retained",
    [neutral, source("a", "Cough for two days, actually three days.")],
    statement(neutral.text),
    ["consistency:correction:a"],
  ),
  fixture(
    "c5",
    "consistency",
    "Agreeing sources",
    [neutral, source("a", "No fever."), source("b", "No fever.")],
    statement(neutral.text),
    [],
  ),
  fixture(
    "c6",
    "consistency",
    "Uncertain symptoms do not prove contradiction",
    [neutral, source("a", "Maybe fever."), source("b", "No fever.")],
    statement(neutral.text),
    [],
  ),
  fixture(
    "s1",
    "safety",
    "Synthetic penicillin and amoxicillin",
    [
      neutral,
      source("a", "Recorded penicillin allergy."),
      {
        ...source("m", "Amoxicillin 250 mg"),
        type: "medication",
        verification: "reported",
      },
    ],
    statement(neutral.text),
    ["safety:synthetic-penicillin-amoxicillin:a:m"],
  ),
  fixture(
    "s2",
    "safety",
    "Same drug aspirin",
    [
      neutral,
      source("a", "Recorded aspirin allergy."),
      {
        ...source("m", "Aspirin 75 mg"),
        type: "medication",
        verification: "verified",
      },
    ],
    statement(neutral.text),
    ["safety:synthetic-same-drug:a:m"],
  ),
  fixture(
    "s3",
    "safety",
    "Same drug ibuprofen",
    [
      neutral,
      source("a", "Recorded ibuprofen allergy."),
      {
        ...source("m", "Ibuprofen 200 mg"),
        type: "medication",
        verification: "reported",
      },
    ],
    statement(neutral.text),
    ["safety:synthetic-same-drug:a:m"],
  ),
  fixture(
    "s4",
    "safety",
    "No recorded allergy does not infer safety",
    [
      neutral,
      {
        ...source("m", "Amoxicillin 250 mg"),
        type: "medication",
        verification: "reported",
      },
    ],
    statement(neutral.text),
    [],
  ),
  fixture(
    "s5",
    "safety",
    "Unknown allergy remains uncertain",
    [
      neutral,
      source("a", "Unsure about penicillin allergy."),
      {
        ...source("m", "Amoxicillin 250 mg"),
        type: "medication",
        verification: "reported",
      },
    ],
    statement(neutral.text),
    [],
  ),
  fixture(
    "s6",
    "safety",
    "Stopped medication is retained but not an active match",
    [
      neutral,
      source("a", "Recorded penicillin allergy."),
      {
        ...source("m", "Amoxicillin 250 mg"),
        type: "medication",
        verification: "stopped",
      },
    ],
    statement(neutral.text),
    [],
  ),
];
// Fixed author-written drafts: no note-generation call is used in this suite.
export const providerTrustFixtures = trustFixtures.filter((f) =>
  ["e3", "e4", "g1", "g5", "c1", "c5", "s1", "s4"].includes(f.id),
);
