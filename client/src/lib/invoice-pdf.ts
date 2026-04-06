/**
 * Invoice PDF generation using jsPDF (same library already in the app).
 * Produces a clean, professional invoice ready to email or print.
 */

import { jsPDF } from "jspdf";

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

const BRAND_BLUE = [26, 127, 173] as const; // hsl(200, 72%, 40%) ≈ #1a7fad
const DARK_TEXT  = [30,  35,  45] as const;
const MUTED_TEXT = [100, 110, 125] as const;
const LIGHT_BG   = [245, 247, 249] as const;

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

  doc.setProperties({
    title: `Invoice ${invoice.invoiceNumber}`,
    author: "Perplexity Computer",
    subject: `Invoice for ${invoice.billToName}`,
  });

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
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(0, 0, PW, 80, "F");

  // Company name
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("FITZPATRICK WARRANTY SERVICE, LLC", margin, 32);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Fitz.warranty@fitzpatrickwarranty.com", margin, 48);

  // INVOICE label top right
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("INVOICE", PW - margin, 38, { align: "right" });

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(invoice.invoiceNumber, PW - margin, 56, { align: "right" });

  y = 100;

  // ─── Bill To / Invoice details columns ───────────────────────────────────
  const col1x = margin;
  const col2x = PW / 2 + 10;

  // Bill To
  setFont(7.5, "normal", MUTED_TEXT);
  doc.text("BILL TO", col1x, y);

  setFont(12, "bold");
  doc.text(invoice.billToName, col1x, y + 14);

  let billingY = y + 28;
  setFont(9.5);
  if (invoice.billToAddress) {
    doc.text(invoice.billToAddress, col1x, billingY); billingY += 13;
  }
  if (invoice.billToCity || invoice.billToState) {
    doc.text([invoice.billToCity, invoice.billToState].filter(Boolean).join(", "), col1x, billingY);
    billingY += 13;
  }
  if (invoice.billToEmail) {
    doc.setTextColor(...BRAND_BLUE as unknown as [number,number,number]);
    doc.text(invoice.billToEmail, col1x, billingY);
    billingY += 13;
  }
  if (invoice.billToPhone) {
    setFont(9.5);
    doc.text(invoice.billToPhone, col1x, billingY);
  }

  // Invoice meta
  const metaRows = [
    ["Invoice Number", invoice.invoiceNumber],
    ["Issue Date", fmtDate(invoice.issueDate)],
    ["Due Date", fmtDate(invoice.dueDate)],
    ["Payment Terms", invoice.paymentTerms || "Net 30"],
    ["Status", invoice.status],
  ];

  let metaY = y;
  metaRows.forEach(([label, value]) => {
    setFont(7.5, "normal", MUTED_TEXT);
    doc.text(label.toUpperCase(), col2x, metaY);
    setFont(9.5, "bold");
    doc.text(value, PW - margin, metaY, { align: "right" });
    metaY += 18;
  });

  y = Math.max(billingY + 20, metaY + 10);

  hrule(y);
  y += 20;

  // ─── Line Items header ────────────────────────────────────────────────────
  doc.setFillColor(...LIGHT_BG);
  doc.rect(margin, y - 6, contentWidth, 20, "F");

  const colW = { desc: contentWidth * 0.46, qty: contentWidth * 0.15, price: contentWidth * 0.17, amt: contentWidth * 0.22 };
  const c = {
    desc: margin,
    qty: margin + colW.desc,
    price: margin + colW.desc + colW.qty,
    amt: margin + colW.desc + colW.qty + colW.price,
  };

  setFont(7.5, "bold", MUTED_TEXT);
  doc.text("DESCRIPTION", c.desc + 4, y + 8);
  doc.text("QTY / HRS", c.qty + colW.qty - 4, y + 8, { align: "right" });
  doc.text("UNIT PRICE", c.price + colW.price - 4, y + 8, { align: "right" });
  doc.text("AMOUNT", c.amt + colW.amt - 4, y + 8, { align: "right" });

  y += 22;
  hrule(y - 4);

  // ─── Line Items rows ──────────────────────────────────────────────────────
  const ITEM_TYPES: Record<string, string> = {
    labor: "Labor", parts: "Parts / Materials", travel: "Travel / Mileage", other: "Other",
  };

  invoice.items?.forEach((item, idx) => {
    if (y > PH - 120) {
      doc.addPage();
      y = margin;
    }

    if (idx % 2 === 1) {
      doc.setFillColor(250, 251, 252);
      doc.rect(margin, y - 4, contentWidth, 22, "F");
    }

    setFont(7.5, "normal", MUTED_TEXT);
    doc.text((ITEM_TYPES[item.type] || item.type).toUpperCase(), c.desc + 4, y + 4);
    setFont(9.5, "bold");
    doc.text(item.description || "—", c.desc + 4, y + 14);

    setFont(9.5);
    doc.text(item.quantity || "1", c.qty + colW.qty - 4, y + 11, { align: "right" });
    doc.text(fmt$(item.unitPrice), c.price + colW.price - 4, y + 11, { align: "right" });
    setFont(9.5, "bold");
    doc.text(fmt$(item.amount), c.amt + colW.amt - 4, y + 11, { align: "right" });

    y += 26;
    hrule(y - 4, [235, 238, 242]);
  });

  y += 10;

  // ─── Totals ───────────────────────────────────────────────────────────────
  const totX = PW - margin - 200;
  const totWidth = 200;

  hrule(y);
  y += 14;

  // Total row
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(totX, y - 4, totWidth, 26, "F");
  setFont(11, "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL DUE", totX + 10, y + 12);
  doc.text(fmt$(invoice.total), PW - margin - 10, y + 12, { align: "right" });
  y += 36;

  // ─── Notes ────────────────────────────────────────────────────────────────
  if (invoice.notes) {
    setFont(7.5, "bold", MUTED_TEXT);
    doc.text("NOTES", margin, y);
    y += 12;
    setFont(9.5);
    const lines = doc.splitTextToSize(invoice.notes, contentWidth);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 10;
  }

  // ─── Footer ───────────────────────────────────────────────────────────────
  const footerY = PH - 36;
  doc.setFillColor(...LIGHT_BG);
  doc.rect(0, footerY - 8, PW, 44, "F");
  setFont(8, "normal", MUTED_TEXT);
  doc.text("Fitzpatrick Warranty Service, LLC  ·  Fitz.warranty@fitzpatrickwarranty.com", PW / 2, footerY + 8, { align: "center" });
  doc.setFontSize(7.5);
  doc.text(`Invoice ${invoice.invoiceNumber}  ·  ${fmtDate(invoice.issueDate)}`, PW / 2, footerY + 20, { align: "center" });

  if (returnBlob) {
    return doc.output("blob");
  } else {
    doc.save(`${invoice.invoiceNumber}.pdf`);
  }
}
