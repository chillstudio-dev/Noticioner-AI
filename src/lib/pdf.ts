import PDFDocument from "pdfkit";
import { join } from "node:path";
import type { Consultation, Patient } from "./db";
import { sections } from "./clinical";

const fonts = join(process.cwd(), "assets", "fonts");
const margin = 48;
const colors = {
  ink: "#183A37",
  muted: "#586D66",
  teal: "#126E61",
  line: "#DCE6E0",
  pale: "#F0F6F2",
};

/** Embedded fonts, shaped script runs and flowing paragraphs preserve source text. */
export async function exportPDF(
  c: Consultation,
  p: Patient,
): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: "A4",
    bufferPages: true,
    margins: { top: 68, right: margin, bottom: 68, left: margin },
    info: {
      Title: `Noticioner AI - Synthetic consultation - ${p.name}`,
      Author: "Noticioner AI research prototype",
      Subject: "Synthetic demonstration document. Not for clinical use.",
    },
  });
  const chunks: Buffer[] = [];
  const output = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont("Body", join(fonts, "NotoSans-Regular.ttf"));
  doc.registerFont("Bold", join(fonts, "NotoSans-Bold.ttf"));
  doc.registerFont("Tamil", join(fonts, "NotoSansTamil-Regular.ttf"));
  doc.registerFont("CJK", join(fonts, "NotoSansCJKjp-Regular.otf"));
  const width = doc.page.width - margin * 2;
  const bodyBottom = doc.page.height - 68;
  let first = true;
  let activeFont = "Body",
    activeSize = 10,
    activeColor = colors.ink;
  function decorate() {
    const y = doc.y;
    doc.save();
    doc.rect(0, 0, doc.page.width, 6).fill(colors.teal);
    doc
      .font("Bold")
      .fontSize(8)
      .fillColor(colors.teal)
      .text("NOTICIONER AI / CLINICAL DOCUMENTATION", margin, 25, {
        lineBreak: false,
      });
    doc
      .font("Body")
      .fontSize(7.5)
      .fillColor(colors.muted)
      .text("SYNTHETIC DEMONSTRATION - NOT FOR CLINICAL USE", margin, 40, {
        lineBreak: false,
      });
    doc
      .moveTo(margin, 55)
      .lineTo(doc.page.width - margin, 55)
      .lineWidth(0.5)
      .stroke(colors.line);
    doc.restore();
    doc.font(activeFont).fontSize(activeSize).fillColor(activeColor);
    doc.x = margin;
    doc.y = first ? 76 : Math.max(y, 68);
    first = false;
  }
  decorate();
  doc.on("pageAdded", decorate);
  function ensure(height: number) {
    if (doc.y + height > bodyBottom) doc.addPage();
  }
  function fontFor(cluster: string, strong: boolean) {
    if (/[\u0B80-\u0BFF]/u.test(cluster)) return "Tamil";
    if (
      /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/u.test(
        cluster,
      )
    )
      return "CJK";
    return strong ? "Bold" : "Body";
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  function paragraph(
    value: string,
    size = 10,
    strong = false,
    color = colors.ink,
  ) {
    const clean = value
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    if (!clean) return;
    for (const line of clean.split("\n")) {
      if (!line) {
        ensure(size + 3);
        doc.y += size + 3;
        continue;
      }
      const runs: { font: string; text: string }[] = [];
      for (const { segment } of segmenter.segment(line)) {
        const font = fontFor(segment, strong);
        const last = runs.at(-1);
        if (last?.font === font) last.text += segment;
        else runs.push({ font, text: segment });
      }
      doc.x = margin;
      runs.forEach((run, index) => {
        activeFont = run.font;
        activeSize = size;
        activeColor = color;
        doc
          .font(run.font)
          .fontSize(size)
          .fillColor(color)
          .text(run.text, {
            width,
            lineGap: 3,
            paragraphGap: 3,
            continued: index < runs.length - 1,
          });
      });
    }
  }
  function heading(title: string) {
    ensure(72);
    doc.y += 12;
    doc
      .moveTo(margin, doc.y)
      .lineTo(margin + width, doc.y)
      .lineWidth(0.6)
      .stroke(colors.line);
    doc.y += 10;
    paragraph(title, 12, true, colors.teal);
    doc.y += 5;
  }
  paragraph("Consultation report", 24, true, colors.teal);
  paragraph(
    "Research prototype - not a prescription or a legally valid medical signature.",
    8,
    false,
    colors.muted,
  );
  doc.y += 14;
  paragraph(p.name, 17, true);
  paragraph(`Date of birth: ${p.dob}`, 9, false, colors.muted);
  paragraph(`Consultation date: ${c.created_at.slice(0, 10)}`, 9);
  paragraph(`Consultation type: ${c.type}`, 9);
  paragraph(
    `Status: ${c.status}   |   Document version: ${c.version}`,
    9,
    true,
  );
  paragraph(
    `Generation: ${c.provider || "No draft generated"}`,
    8,
    false,
    colors.muted,
  );
  paragraph(`Record ID: ${c.id}`, 8, false, colors.muted);
  for (const section of sections) {
    heading(section);
    const statements =
      c.note?.statements.filter((statement) => statement.section === section) ||
      [];
    if (!statements.length)
      paragraph(
        section === "Assessment"
          ? "Assessment not established in the source conversation - clinician review required."
          : "Not documented in the source conversation.",
        10,
        false,
        colors.muted,
      );
    for (const statement of statements) {
      // Keep ordinary statements with their provenance; long paragraphs flow across pages.
      const estimated = doc
        .font("Body")
        .fontSize(10)
        .heightOfString(statement.text, { width, lineGap: 3 });
      ensure(Math.min(estimated + 42, 120));
      paragraph(statement.text);
      if (statement.speaker)
        paragraph(
          `Speaker: ${statement.speaker} / ${statement.speakerBasis || "Unknown"}`,
          8,
          false,
          colors.muted,
        );
      paragraph(
        `Source: ${statement.evidence.map((evidence) => evidence.segmentId).join(", ") || "No validated evidence"} / ${statement.certainty === "Supported" ? "Source linked - verify meaning" : statement.certainty}`,
        8,
        false,
        colors.muted,
      );
      doc.y += 8;
    }
  }
  heading("Review & approval");
  if (!c.flags.length)
    paragraph(
      "No rule-based documentation prompts were generated. This does not establish clinical safety.",
      9,
      false,
      colors.muted,
    );
  for (const flag of c.flags) {
    ensure(64);
    paragraph(`${flag.resolution} / ${flag.category}`, 9, true);
    paragraph(flag.message, 9, false, colors.muted);
    if (flag.note)
      paragraph(`Reviewer note: ${flag.note}`, 9, false, colors.muted);
    doc.y += 6;
  }
  ensure(65);
  doc.y += 8;
  paragraph(`Simulated approval: ${c.approved_by || "Not approved"}`, 9, true);
  if (c.approved_at)
    paragraph(
      `Approved at ${c.approved_at} / Version ${c.version}`,
      8,
      false,
      colors.muted,
    );
  paragraph(
    "This project is a prototype and is not medical advice.",
    8,
    false,
    colors.muted,
  );
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();
    const footer = doc.page.height - 42;
    doc
      .moveTo(margin, footer - 8)
      .lineTo(margin + width, footer - 8)
      .lineWidth(0.5)
      .stroke(colors.line);
    doc
      .font("Body")
      .fontSize(7)
      .fillColor(colors.muted)
      .text("NOTICIONER AI / SYNTHETIC DATA ONLY", margin, footer, {
        lineBreak: false,
      });
    doc.text(`${index + 1} / ${range.count}`, margin, footer, {
      width,
      align: "right",
      lineBreak: false,
    });
    doc.restore();
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return output;
}
