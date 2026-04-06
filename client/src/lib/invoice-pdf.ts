/**
 * Invoice PDF generation using jsPDF (same library already in the app).
 * Produces a clean, professional invoice ready to email or print.
 */

import { jsPDF } from "jspdf";
import { LOGO_WHITE_DATA_URL } from "@/lib/logo-data";

interface InvoiceItem {
  type: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  billToType: string;
  billToName: string;
  billToAddress: string | null;
  billToCity: string | null;
  billToState: string | null;
  billToEmail: string | null;
  billToPhone: string | null;
  issueDate: string;
  dueDate: string | null;
  paymentTerms: string | null;
  status: string;
  notes: string | null;
  subtotal: string;
  total: string;
  items: InvoiceItem[];
}

const BRAND_BLUE = [26, 127, 173] as const;
const NAVY       = [22,  29,  42] as const;
const DARK_TEXT  = [30,  35,  45] as const;
const MUTED_TEXT = [100, 110, 125] as const;
const LIGHT_BG   = [238, 242, 247] as const;
const ACCENT_MID = [143, 168, 200] as const;

function fmt$(v: string | null | undefined): string {
  const n = parseFloat(String(v || "0"));
  if (isNaN(n)) return "$0.00";
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    const [y, m, day] = d.split("-");
    return `${m}/${day}/${y}`;
  } catch { return d; }
}

export async function generateInvoicePdf(invoice: Invoice, returnBlob = false): Promise<Blob | void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  doc.setProperties({ title: `Invoice ${invoice.invoiceNumber}`, author: "Perplexity Computer" });

  const PW = 612, PH = 792;
  const margin = 48;
  const contentWidth = PW - margin * 2;
  let y = margin;

  function setFont(size: number, style: "normal" | "bold" = "normal", rgb = DARK_TEXT) {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    doc.setTextColor(...rgb);
  }

  function hrule(yy: number, color = [220, 225, 230] as const) {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.5);
    doc.line(margin, yy, PW - margin, yy);
  }

  // ─── Header bar ──────────────────────────────────────────────────────────
  const HEADER_H = 110;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PW, HEADER_H, "F");
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(0, 0, PW, 4, "F");

  // Logo — transparent PNG (shield + white text on transparent bg)
  // Source: LLC logo 2278×589 → aspect ~3.87:1 — displayed at 210pt wide
  const logoW = 210;
  const logoH = Math.round(logoW * 589 / 2278);
  const logoY = (HEADER_H - logoH) / 2;
  doc.addImage(LOGO_WHITE_DATA_URL, "PNG", margin - 4, logoY, logoW, logoH);

  // INVOICE + number
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("INVOICE", PW - margin, 38, { align: "right" });
  setFont(11, "normal", ACCENT_MID);
  doc.text(invoice.invoiceNumber, PW - margin, 56, { align: "right" });

  y = HEADER_H + 22;

  // ─── From / Bill To ──────────────────────────────────────────────────────
  const col1x = margin;
  const col2x = PW / 2 + 10;

  setFont(7.5, "normal", MUTED_TEXT);
  doc.text("FROM", col1x, y);
  doc.text(`BILL TO — ${invoice.billToType.toUpperCase()}`, col2x, y);

  y += 14;
  setFont(12, "bold");
  doc.text("Fitzpatrick Warranty Service, LLC", col1x, y);
  doc.text(invoice.billToName, col2x, y);

  y += 14;
  setFont(9.5, "normal", DARK_TEXT);
  doc.text("PO Box 157", col1x, y);

  let billY = y;
  if (invoice.billToAddress) { doc.text(invoice.billToAddress, col2x, billY); billY += 13; }
  if (invoice.billToCity || invoice.billToState) {
    doc.text([invoice.billToCity, invoice.billToState].filter(Boolean).join(", "), col2x, billY);
    billY += 13;
  }

  y += 13;
  doc.text("West Jordan, Utah 84088", col1x, y);

  if (invoice.billToEmail) {
    doc.setTextColor(...BRAND_BLUE as unknown as [number,number,number]);
    doc.text(invoice.billToEmail, col2x, billY);
    billY += 13;
    setFont(9.5, "normal", DARK_TEXT);
  }
  if (invoice.billToPhone) { doc.text(invoice.billToPhone, col2x, billY); }

  y = Math.max(y + 22, billY + 16);
  hrule(y);

  // ─── Invoice meta ─────────────────────────────────────────────────────────
  y += 20;
  const metaRows = [
    ["INVOICE #", invoice.invoiceNumber],
    ["ISSUE DATE", fmtDate(invoice.issueDate)],
    ["DUE DATE", fmtDate(invoice.dueDate)],
    ["PAYMENT TERMS", invoice.paymentTerms || "Net 30"],
    ["STATUS", invoice.status],
  ];
  const metaColW = contentWidth / metaRows.length;
  metaRows.forEach(([label, value], i) => {
    const x = margin + i * metaColW;
    setFont(7, "normal", MUTED_TEXT);
    doc.text(label, x, y);
    const isStatus = label === "STATUS";
    setFont(9.5, "bold", isStatus ? BRAND_BLUE : DARK_TEXT);
    doc.text(value, x, y + 13);
  });

  y += 36;
  hrule(y);
  y += 20;

  // ─── Column headers ───────────────────────────────────────────────────────
  const cw = contentWidth;
  const colW = { desc: cw * 0.46, qty: cw * 0.15, price: cw * 0.17, amt: cw * 0.22 };
  const c = {
    desc: margin,
    qty: margin + colW.desc,
    price: margin + colW.desc + colW.qty,
    amt: margin + colW.desc + colW.qty + colW.price,
  };

  const COL_H = 22;
  doc.setFillColor(...LIGHT_BG);
  doc.rect(margin, y, cw, COL_H, "F");
  doc.setDrawColor(...[220, 225, 230] as unknown as [number,number,number]);
  doc.setLineWidth(0.5);
  doc.line(margin, y + COL_H, PW - margin, y + COL_H);
  doc.line(margin, y, PW - margin, y);

  const textY = y + COL_H / 2 - 3;
  setFont(7.5, "bold", NAVY);
  doc.text("DESCRIPTION", c.desc + 4, textY);
  doc.text("QTY / HRS", c.qty + colW.qty - 4, textY, { align: "right" });
  doc.text("UNIT PRICE", c.price + colW.price - 4, textY, { align: "right" });
  doc.text("AMOUNT", c.amt + colW.amt - 4, textY, { align: "right" });

  y += COL_H + 8;

  // ─── Line items ───────────────────────────────────────────────────────────
  const ITEM_TYPES: Record<string, string> = {
    labor: "Labor", parts: "Parts / Materials", travel: "Travel / Mileage", other: "Other",
  };
  const ROW_H = 40;

  invoice.items?.forEach((item, idx) => {
    if (y > PH - 140) { doc.addPage(); y = margin; }

    if (idx % 2 === 1) {
      doc.setFillColor(250, 251, 252);
      doc.rect(margin, y - ROW_H + 4, cw, ROW_H, "F");
    }

    setFont(7, "bold", BRAND_BLUE);
    doc.text((ITEM_TYPES[item.type] || item.type).toUpperCase(), c.desc + 4, y);
    setFont(9.5, "bold");
    doc.text(item.description || "—", c.desc + 4, y + 12);

    setFont(9.5, "normal", DARK_TEXT);
    doc.text(item.quantity || "1", c.qty + colW.qty - 4, y + 12, { align: "right" });
    doc.text(fmt$(item.unitPrice), c.price + colW.price - 4, y + 12, { align: "right" });
    setFont(9.5, "bold");
    doc.text(fmt$(item.amount), c.amt + colW.amt - 4, y + 12, { align: "right" });

    doc.setDrawColor(232, 236, 240);
    doc.setLineWidth(0.4);
    doc.line(margin, y - ROW_H + 4 + ROW_H, PW - margin, y - ROW_H + 4 + ROW_H);

    y += ROW_H + 4;
  });

  y += 10;
  hrule(y);
  y += 14;

  // ─── Total ────────────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(PW - margin - 220, y - 6, 220, 30, "F");
  setFont(11, "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL DUE", PW - margin - 210, y + 9);
  doc.text(fmt$(invoice.total), PW - margin - 10, y + 9, { align: "right" });
  y += 46;

  // ─── Notes ────────────────────────────────────────────────────────────────
  if (invoice.notes && y < PH - 120) {
    setFont(7.5, "bold", MUTED_TEXT);
    doc.text("NOTES", margin, y);
    y += 12;
    setFont(9.5);
    const lines = doc.splitTextToSize(invoice.notes, contentWidth);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 10;
  }

  // ─── Remittance block ─────────────────────────────────────────────────────
  if (y < PH - 100) {
    doc.setFillColor(...LIGHT_BG);
    doc.rect(margin, y, contentWidth, 58, "F");
    setFont(8, "bold", NAVY);
    doc.text("REMIT PAYMENT TO:", margin + 12, y + 14);
    setFont(9.5, "normal", DARK_TEXT);
    doc.text("Fitzpatrick Warranty Service, LLC", margin + 12, y + 27);
    doc.text("PO Box 157, West Jordan, Utah 84088", margin + 12, y + 40);
    setFont(8.5, "normal", MUTED_TEXT);
    const remitNote = `Please reference invoice ${invoice.invoiceNumber} on your remittance. Accepted: Check, ACH.`;
    const remitLines = doc.splitTextToSize(remitNote, contentWidth - 24);
    doc.text(remitLines, margin + 12, y + 52);
  }

  // ─── Footer ───────────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, PH - 42, PW, 42, "F");
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(0, PH - 42, PW, 2, "F");
  setFont(8, "normal", ACCENT_MID);
  doc.text("Fitzpatrick Warranty Service, LLC  ·  PO Box 157, West Jordan, UT 84088", PW / 2, PH - 22, { align: "center" });
  setFont(7.5, "normal", ACCENT_MID);
  doc.text(`Invoice ${invoice.invoiceNumber}  ·  ${fmtDate(invoice.issueDate)}${invoice.dueDate ? "  ·  Due " + fmtDate(invoice.dueDate) : ""}`, PW / 2, PH - 10, { align: "center" });

  if (returnBlob) return doc.output("blob");
  doc.save(`${invoice.invoiceNumber}.pdf`);
}
