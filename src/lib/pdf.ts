import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Consultation, Patient } from "./db";
import { sections } from "./clinical";

/** English demonstration export. Every page retains a prototype disclosure. */
export async function exportPDF(c: Consultation, p: Patient) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.06, 0.4, 0.34);
  const ink = rgb(0.12, 0.23, 0.2);
  const muted = rgb(0.36, 0.44, 0.4);
  const border = rgb(0.86, 0.9, 0.87);
  const paper = rgb(0.96, 0.98, 0.96);
  const left = 48,
    width = 499;
  let page = doc.addPage([595, 842]),
    y = 790;
  const safe = (s: string) => s.replace(/[^\x20-\x7E\n]/g, "?");
  function newPage() {
    page = doc.addPage([595, 842]);
    page.drawText("CLINISCRIBE AI / CONTINUED", {
      x: left,
      y: 798,
      size: 9,
      font: bold,
      color: teal,
    });
    page.drawText("SYNTHETIC DEMONSTRATION - NOT FOR CLINICAL USE", {
      x: left,
      y: 782,
      size: 8,
      font: regular,
      color: muted,
    });
    page.drawLine({
      start: { x: left, y: 770 },
      end: { x: left + width, y: 770 },
      thickness: 0.6,
      color: border,
    });
    y = 748;
  }
  function room(height: number) {
    if (y - height < 64) newPage();
  }
  function text(value: string, size = 10, strong = false, color = ink) {
    const font = strong ? bold : regular;
    // Break exceptionally long tokens as well as ordinary word boundaries.
    const words = safe(value)
      .split(/\s+/)
      .flatMap((word) => {
        const parts: string[] = [];
        let part = "";
        for (const character of word) {
          if (font.widthOfTextAtSize(part + character, size) > width) {
            parts.push(part);
            part = "";
          }
          part += character;
        }
        if (part) parts.push(part);
        return parts;
      });
    let row = "";
    function draw() {
      room(size + 5);
      page.drawText(row, { x: left, y, size, font, color });
      y -= size + 5;
    }
    for (const word of words) {
      if (row && font.widthOfTextAtSize(row + " " + word, size) > width) {
        draw();
        row = "";
      }
      row += (row ? " " : "") + word;
    }
    if (row) draw();
  }
  function heading(title: string, letter?: string) {
    room(65);
    y -= 8;
    page.drawLine({
      start: { x: left, y: y + 8 },
      end: { x: left + width, y: y + 8 },
      thickness: 0.6,
      color: border,
    });
    if (letter) {
      page.drawRectangle({
        x: left,
        y: y - 13,
        width: 22,
        height: 22,
        color: paper,
      });
      page.drawText(letter, {
        x: left + 7,
        y: y - 6,
        size: 11,
        font: bold,
        color: teal,
      });
    }
    page.drawText(title, {
      x: left + (letter ? 33 : 0),
      y: y - 5,
      size: 11,
      font: bold,
      color: teal,
    });
    y -= 30;
  }
  doc.setTitle(`CliniScribe AI - Synthetic consultation - ${p.name}`);
  doc.setAuthor("CliniScribe AI research prototype");
  doc.setSubject("Synthetic demonstration document. Not medical advice.");
  page.drawRectangle({ x: 0, y: 833, width: 595, height: 9, color: teal });
  text("CliniScribe AI", 25, true, teal);
  text("CLINICAL DOCUMENTATION / RESEARCH PROTOTYPE", 8, true, muted);
  y -= 12;
  page.drawRectangle({
    x: left - 12,
    y: y - 29,
    width: width + 24,
    height: 43,
    color: paper,
  });
  text("SYNTHETIC DEMONSTRATION DOCUMENT", 9, true, teal);
  text(
    "Not for clinical use. Not a prescription or a legally valid medical signature.",
    8,
    false,
    muted,
  );
  y -= 15;
  text(p.name, 16, true);
  text(`Synthetic patient  /  Date of birth: ${p.dob}`, 9, false, muted);
  y -= 7;
  text(`Consultation: ${c.created_at.slice(0, 10)}  |  ${c.type}`, 10);
  text(`Status: ${c.status}  |  Document version: ${c.version}`, 10, true);
  text(`Generation: ${c.provider || "No draft generated"}`, 9, false, muted);
  text(`Record ID: ${c.id}`, 8, false, muted);
  y -= 8;
  for (const section of sections) {
    heading(section, section[0]);
    const statements =
      c.note?.statements.filter((s) => s.section === section) || [];
    if (!statements.length)
      text(
        section === "Assessment"
          ? "Assessment not established in the source conversation - clinician review required."
          : "Not documented in the source conversation.",
        10,
        false,
        muted,
      );
    for (const statement of statements) {
      room(40);
      text(statement.text);
      if (statement.speaker)
        text(
          `Speaker: ${statement.speaker} / ${statement.speakerBasis || "Unknown"}`,
          8,
          false,
          muted,
        );
      text(
        `Source: ${statement.evidence.map((e) => e.segmentId).join(", ") || "No validated evidence"}  /  ${statement.certainty === "Supported" ? "Source linked - verify meaning" : statement.certainty}`,
        8,
        false,
        muted,
      );
      y -= 5;
    }
  }
  heading("Review & approval");
  if (!c.flags.length)
    text(
      "No rule-based documentation prompts were generated. This does not establish clinical safety.",
      9,
      false,
      muted,
    );
  for (const flag of c.flags) {
    room(40);
    text(`${flag.resolution} / ${flag.category}`, 9, true);
    text(flag.message, 9, false, muted);
    if (flag.note) text(`Reviewer note: ${flag.note}`, 9, false, muted);
    y -= 5;
  }
  room(50);
  text(`Simulated approval: ${c.approved_by || "Not approved"}`, 9, true);
  if (c.approved_at)
    text(
      `Approved at ${c.approved_at}  /  Version ${c.version}`,
      8,
      false,
      muted,
    );
  y -= 5;
  text(
    "This project is a prototype and is not medical advice.",
    9,
    false,
    muted,
  );
  doc.getPages().forEach((sheet, index) => {
    sheet.drawLine({
      start: { x: left, y: 48 },
      end: { x: left + width, y: 48 },
      thickness: 0.6,
      color: border,
    });
    sheet.drawText("CLINISCRIBE AI  /  SYNTHETIC DATA ONLY", {
      x: left,
      y: 32,
      size: 8,
      font: regular,
      color: muted,
    });
    sheet.drawText(`${index + 1} / ${doc.getPageCount()}`, {
      x: 515,
      y: 32,
      size: 8,
      font: regular,
      color: muted,
    });
  });
  return doc.save();
}
