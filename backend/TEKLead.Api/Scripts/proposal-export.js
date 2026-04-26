const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, LevelFormat, TabStopType, PageNumberElement, ExternalHyperlink,
} = require('docx');
const fs = require('fs');

// ── Settings (passed in at runtime) ──────────────────────────────────────────
const settings = JSON.parse(process.argv[2] || '{}');
const COMPANY   = settings.companyName   || "CSharpTek";
const SIGNER    = settings.signerName    || "Bhanu";
const SIGNER_T  = settings.signerTitle   || "Lead Developer & Project Manager";
const WEBSITE   = settings.website       || "csharptek2026.vercel.app";
const CONF_TEXT = settings.confidentialityText || "This document is intended solely for the recipient and may not be shared without written consent.";
const FOOTER_T  = settings.footerText    || `Confidential · ${COMPANY}`;

// ── Proposal data (passed in at runtime) ─────────────────────────────────────
const proposal = JSON.parse(process.argv[3] || '{}');
const CLIENT   = proposal.clientName    || "";
const COMPANY_C= proposal.clientCompany || "";
const HEADLINE = proposal.jobPostHeadline || proposal.jobPostBody?.slice(0, 80) || "Project Proposal";
const BUDGET   = proposal.budgetMin && proposal.budgetMax
  ? `$${Number(proposal.budgetMin).toLocaleString()} – $${Number(proposal.budgetMax).toLocaleString()} USD`
  : proposal.budgetMax ? `$${Number(proposal.budgetMax).toLocaleString()} USD` : "";
const TIMELINE = proposal.timelineValue ? `${proposal.timelineValue} ${proposal.timelineUnit || "weeks"}` : "";
const DATE_STR = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

// ── Generated proposal body (markdown-ish text) ───────────────────────────────
const BODY_TEXT = proposal.generatedResponse || "";

// ── Colors ────────────────────────────────────────────────────────────────────
const ACCENT   = "0f172a";
const BLUE     = "2563eb";
const MUTED    = "64748b";
const BORDER_C = "e2e8f0";
const border   = { style: BorderStyle.SINGLE, size: 1, color: BORDER_C };
const borders  = { top: border, bottom: border, left: border, right: border };

// ── Helpers ───────────────────────────────────────────────────────────────────
const spacer = (before = 160) => new Paragraph({ spacing: { before, after: 0 }, children: [new TextRun("")] });
const pageBreak = () => new Paragraph({ children: [new TextRun({ break: 1 })] });

function para(text, opts = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: opts.before || 60, after: opts.after || 60 },
    children: [new TextRun({ text: String(text), font: "Arial", size: opts.size || 22, bold: opts.bold || false, italics: opts.italics || false, color: opts.color || "000000" })],
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, font: "Arial", size: 22 })],
  });
}

function kv(label, value) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [2500, 6860],
    rows: [new TableRow({ children: [
      new TableCell({ borders, width: { size: 2500, type: WidthType.DXA }, shading: { fill: "f8fafc", type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: label, font: "Arial", size: 20, bold: true, color: MUTED })] })] }),
      new TableCell({ borders, width: { size: 6860, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: value, font: "Arial", size: 20 })] })] }),
    ]})],
  });
}

// ── Parse generated markdown into docx elements ───────────────────────────────
function parseMarkdown(md) {
  const lines = md.split('\n');
  const elements = [];
  let bulletRef = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // H1
    if (line.startsWith('# ')) {
      elements.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 6 } },
        children: [new TextRun({ text: line.slice(2).trim(), font: "Arial", size: 30, bold: true, color: ACCENT })],
      }));
      continue;
    }

    // H2
    if (line.startsWith('## ')) {
      elements.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: line.slice(3).trim(), font: "Arial", size: 26, bold: true, color: ACCENT })],
      }));
      continue;
    }

    // H3
    if (line.startsWith('### ')) {
      elements.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: line.slice(4).trim(), font: "Arial", size: 24, bold: true, color: ACCENT })],
      }));
      continue;
    }

    // Table rows — skip markdown tables (pipe-separated), render as plain text rows
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // Skip separator rows
      if (line.includes('---')) continue;
      const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length > 0) {
        elements.push(new Paragraph({
          spacing: { before: 40, after: 40 },
          children: cells.map((c, idx) => new TextRun({
            text: (idx > 0 ? '   ' : '') + c.replace(/\*\*/g, ''),
            font: "Arial", size: 20,
            bold: idx === 0 && cells.length > 1,
          })),
        }));
      }
      continue;
    }

    // Bullet
    if (line.match(/^[-*]\s/)) {
      const text = line.slice(2).trim().replace(/\*\*/g, '');
      elements.push(bullet(text));
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const text = line.replace(/^\d+\.\s/, '').trim().replace(/\*\*/g, '');
      elements.push(new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text, font: "Arial", size: 22 })],
      }));
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      elements.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_C, space: 4 } },
        spacing: { before: 120, after: 120 },
        children: [new TextRun("")],
      }));
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(spacer(80));
      continue;
    }

    // Bold inline — strip ** and render bold
    const boldStripped = line.replace(/\*\*(.*?)\*\*/g, '$1');
    elements.push(new Paragraph({
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: boldStripped.trim(), font: "Arial", size: 22 })],
    }));
  }

  return elements;
}

// ── Cover page ────────────────────────────────────────────────────────────────
const coverChildren = [
  spacer(1440),
  para(COMPANY.toUpperCase(), { center: true, size: 36, bold: true, color: BLUE }),
  spacer(40),
  para(CLIENT || COMPANY_C || "Proposal", { center: true, size: 48, bold: true, color: ACCENT }),
  spacer(20),
  para(HEADLINE, { center: true, size: 26, color: MUTED }),
  spacer(80),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: BORDER_C, space: 8 }, bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_C, space: 8 } },
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text: `PROPOSAL  ·  ${DATE_STR}`, font: "Arial", size: 22, color: MUTED })],
  }),
  spacer(80),
  ...(BUDGET ? [para(`Investment: ${BUDGET}`, { center: true, size: 26, bold: true, color: ACCENT })] : []),
  ...(TIMELINE ? [para(`Timeline: ${TIMELINE}`, { center: true, size: 22, color: MUTED })] : []),
  spacer(240),
  para(`Prepared by ${SIGNER}  |  ${COMPANY}`, { center: true, size: 20, color: MUTED }),
  ...(CLIENT ? [para(`Prepared for ${CLIENT}${COMPANY_C ? ` · ${COMPANY_C}` : ""}`, { center: true, size: 20, color: MUTED })] : []),
  spacer(200),
  para("CONFIDENTIAL", { center: true, size: 18, bold: true, color: "dc2626" }),
  para(CONF_TEXT, { center: true, size: 16, italics: true, color: MUTED }),
  pageBreak(),
];

// ── Body (parsed from generated text) ────────────────────────────────────────
const bodyChildren = BODY_TEXT
  ? parseMarkdown(BODY_TEXT)
  : [para("No proposal content generated yet.", { color: MUTED })];

// Add signature block at end
bodyChildren.push(
  spacer(200),
  new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: BORDER_C, space: 8 } },
    spacing: { before: 80, after: 40 },
    children: [new TextRun({ text: `${SIGNER}  |  ${SIGNER_T}`, font: "Arial", size: 22, bold: true })],
  }),
  para(COMPANY, { size: 22, color: MUTED }),
  para(WEBSITE, { size: 20, color: BLUE }),
  para(DATE_STR, { size: 20, color: MUTED }),
);

// ── Header & Footer ───────────────────────────────────────────────────────────
const header = new Header({
  children: [new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 4 } },
    spacing: { after: 100 },
    tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
    children: [
      new TextRun({ text: `${COMPANY}  |  ${HEADLINE.slice(0, 60)}`, font: "Arial", size: 18, color: MUTED }),
      new TextRun({ text: "\tCONFIDENTIAL", font: "Arial", size: 18, bold: true, color: "dc2626" }),
    ],
  })],
});

const footer = new Footer({
  children: [new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: BORDER_C, space: 4 } },
    spacing: { before: 80 },
    tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
    children: [
      new TextRun({ text: `${COMPANY}  ·  ${WEBSITE}`, font: "Arial", size: 18, color: MUTED }),
      new TextRun({ text: `\t${FOOTER_T}`, font: "Arial", size: 18, color: MUTED }),
    ],
  })],
});

// ── Build & output ────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, font: "Arial", color: ACCENT }, paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, font: "Arial", color: ACCENT }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 1 } },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: coverChildren,
    },
    {
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, right: 1440, bottom: 1200, left: 1440 } } },
      headers: { default: header },
      footers: { default: footer },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  process.stdout.write(buf);
});
