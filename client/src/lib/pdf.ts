import type { ServiceCall, Photo, Part, ServiceCallVisit } from "@shared/schema";
import { parseMoney, formatMoney } from "@shared/datetime";

interface ServiceCallFull extends ServiceCall {
  photos: Photo[];
  parts: Part[];
}

// Optional payload — callers that have visits + tech display names pass them
// in so the PDF includes a per-visit notes/hours section. Older callers that
// don't pass anything still work (no Visit History section is rendered).
export interface PdfExtras {
  visits?: ServiceCallVisit[];
  techNamesById?: Record<number, string>;
}

// Escape user-provided strings before injecting into PDF HTML
function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
  } catch { return dateStr; }
}

function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return "";
  try {
    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return timeStr;
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
  } catch { return timeStr; }
}

// Generate the PDF HTML string (reusable for share/email)
export async function generatePDFHtml(call: ServiceCallFull, extras: PdfExtras = {}): Promise<string> {
  const { LOGO_DARK_DATA_URL } = await import("./logo-data");
  return buildPDFHtml(call, LOGO_DARK_DATA_URL, extras);
}

export async function generatePDF(call: ServiceCallFull, extras: PdfExtras = {}): Promise<void> {
  const html = await generatePDFHtml(call, extras);
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("Popup blocked. Please allow popups for this site.");
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function buildPDFHtml(call: ServiceCallFull, LOGO_DARK_DATA_URL: string, extras: PdfExtras = {}): string {
  const manufacturerDisplay = call.manufacturer === "Other"
    ? (call.manufacturerOther ?? "Other")
    : call.manufacturer;

  // Build per-visit history: Visit 1 (synthesized from the call itself) plus
  // every return visit stored in service_call_visits. Sorted ascending by
  // visit_number so the PDF reads chronologically.
  const techNamesById = extras.techNamesById ?? {};
  const returnVisits = [...(extras.visits ?? [])].sort((a, b) => a.visitNumber - b.visitNumber);
  const hasAnyReturnVisit = returnVisits.length > 0;
  const visitsHtml = hasAnyReturnVisit
    ? (() => {
        const visit1Row = `
          <tr>
            <td class="v-num">Visit 1</td>
            <td class="v-date">${formatDate(call.callDate)}</td>
            <td class="v-tech">—</td>
            <td class="v-status">${esc(call.status || "")}</td>
            <td class="v-hours">${call.hoursOnJob ? esc(String(call.hoursOnJob)) + " hrs" : "—"}</td>
            <td class="v-miles">${call.milesTraveled ? esc(String(call.milesTraveled)) + " mi" : "—"}</td>
          </tr>
          <tr><td colspan="6" class="v-notes-cell">
            <div class="v-notes-label">Notes</div>
            <div class="v-notes-body">${
              call.techNotes
                ? esc(call.techNotes)
                : (call.resolution ? esc(call.resolution) : "<em>No notes recorded.</em>")
            }</div>
          </td></tr>
        `;
        const returnRows = returnVisits.map((v) => {
          const techName = v.technicianId && techNamesById[v.technicianId] ? techNamesById[v.technicianId] : null;
          return `
            <tr>
              <td class="v-num">Visit ${v.visitNumber}</td>
              <td class="v-date">${formatDate(v.visitDate)}</td>
              <td class="v-tech">${techName ? esc(techName) : "Unassigned"}</td>
              <td class="v-status">${esc(v.status || "")}</td>
              <td class="v-hours">${v.hoursOnJob ? esc(String(v.hoursOnJob)) + " hrs" : "—"}</td>
              <td class="v-miles">${v.milesTraveled ? esc(String(v.milesTraveled)) + " mi" : "—"}</td>
            </tr>
            <tr><td colspan="6" class="v-notes-cell">
              <div class="v-notes-label">Notes</div>
              <div class="v-notes-body">${v.notes ? esc(v.notes) : "<em>No notes recorded.</em>"}</div>
            </td></tr>
          `;
        }).join("");
        return `
          <div class="section">
            <h2>Visit History (${returnVisits.length + 1})</h2>
            <table class="v-table">
              <thead>
                <tr>
                  <th>Visit</th>
                  <th>Date</th>
                  <th>Technician</th>
                  <th>Status</th>
                  <th>Hours</th>
                  <th>Miles</th>
                </tr>
              </thead>
              <tbody>
                ${visit1Row}
                ${returnRows}
              </tbody>
            </table>
          </div>
        `;
      })()
    : "";

  // Group photos into rows of 3, with page breaks between groups
  // Each row is ~200px tall (180px image + 20px label/gap)
  // A letter page has ~900px usable height, so we can fit ~4 rows per page
  const PHOTOS_PER_ROW = 3;
  const ROWS_PER_PAGE = 2;
  const PHOTOS_PER_PAGE = PHOTOS_PER_ROW * ROWS_PER_PAGE; // 6 photos per page — safe for any aspect ratio

  const photosHtml = call.photos.length > 0
    ? (() => {
        let html = `<div class="page-break"></div><div class="section"><h2>Photos (${call.photos.length})</h2>`;
        
        for (let i = 0; i < call.photos.length; i++) {
          // Start a new grid for each page-worth of photos
          if (i % PHOTOS_PER_PAGE === 0) {
            if (i > 0) {
              html += `</div><div class="page-break"></div>`; // close previous grid, page break
            }
            html += `<div class="photo-grid">`;
          }
          
          const p = call.photos[i];
          html += `
            <div class="photo-item">
              <img src="${p.photoUrl}" alt="${esc(p.caption) || "Photo"}" />
              <div class="photo-label">
                <strong>${esc(p.photoType)}</strong>
                ${p.caption ? `<br/>${esc(p.caption)}` : ""}
              </div>
            </div>`;
        }
        
        html += `</div></div>`; // close last grid and section
        return html;
      })()
    : "";

  const partsHtml = call.parts.length > 0
    ? `
      <div class="section">
        <h2>Parts Used</h2>
        <table>
          <thead>
            <tr>
              <th>Part Number</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${call.parts.map(p => `
              <tr>
                <td><code>${esc(p.partNumber)}</code></td>
                <td>${esc(p.partDescription)}</td>
                <td style="text-align:center">${p.quantity}</td>
                <td>${esc(p.source) || "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : "";

  const claimSection = `
    <div class="section">
      <h2>Warranty Claim</h2>
      <div class="field-grid">
        <div class="field">
          <label>Claim Status</label>
          <span class="value">${esc(call.claimStatus)}</span>
        </div>
        ${call.claimNotes ? `
          <div class="field full-width">
            <label>Claim Notes</label>
            <p class="value">${esc(call.claimNotes)}</p>
          </div>
        ` : ""}
        ${call.partsCost ? `
          <div class="field">
            <label>Parts Cost</label>
            <span class="value">${formatMoney(call.partsCost)}</span>
          </div>
        ` : ""}
        ${call.laborCost ? `
          <div class="field">
            <label>Labor Cost</label>
            <span class="value">${formatMoney(call.laborCost)}</span>
          </div>
        ` : ""}
        ${call.otherCost ? `
          <div class="field">
            <label>Other Cost</label>
            <span class="value">${formatMoney(call.otherCost)}</span>
          </div>
        ` : ""}
        ${call.claimAmount ? `
          <div class="field">
            <label>Claim Amount</label>
            <span class="value" style="font-weight:700;color:#16a34a;">${formatMoney(call.claimAmount)}</span>
          </div>
        ` : ""}
      </div>
    </div>
  `;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Warranty Service Report — Call #${call.id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
      font-size: 11pt;
      color: #1e293b;
      background: white;
      line-height: 1.5;
    }
    .page { max-width: 800px; margin: 0 auto; padding: 30px; }
    
    /* Header */
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 20px;
      border-bottom: 3px solid #1d4ed8;
      margin-bottom: 24px;
    }
    .logo-area { display: flex; align-items: center; }
    .logo-area img { height: 56px; width: auto; }
    .report-info { text-align: right; }
    .call-number { font-size: 14pt; font-weight: 700; color: #1d4ed8; }
    .call-date { font-size: 9pt; color: #64748b; margin-top: 2px; }
    
    /* Status bar */
    .status-bar {
      display: flex; gap: 16px; flex-wrap: wrap;
      padding: 12px 16px;
      background: #f1f5f9;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .status-item { display: flex; flex-direction: column; }
    .status-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
    .status-value { font-size: 10pt; font-weight: 600; color: #1e293b; }
    .badge {
      display: inline-block; padding: 2px 8px;
      border-radius: 100px; font-size: 9pt; font-weight: 600;
    }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-amber { background: #fef3c7; color: #92400e; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-orange { background: #fed7aa; color: #9a3412; }
    .badge-gray { background: #f1f5f9; color: #475569; }
    .badge-purple { background: #f3e8ff; color: #6b21a8; }

    /* Sections */
    .section { margin-bottom: 24px; }
    .section h2 {
      font-size: 10pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #1d4ed8;
      font-weight: 700;
      padding-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 12px;
    }
    
    /* Field grid */
    .field-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px;
    }
    .field.full-width { grid-column: 1 / -1; }
    .field label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; display: block; margin-bottom: 2px; }
    .field .value { font-size: 10pt; color: #1e293b; }
    .field p.value { margin-top: 4px; white-space: pre-wrap; }
    
    /* Narrative fields */
    .narrative { background: #f8fafc; border-left: 3px solid #e2e8f0; padding: 12px; border-radius: 0 6px 6px 0; margin-top: 8px; }
    .narrative p { font-size: 10pt; white-space: pre-wrap; color: #334155; }
    /* Visit history table */
    .v-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9.5pt; }
    .v-table thead th {
      background: #f1f5f9;
      color: #475569;
      text-align: left;
      padding: 8px 10px;
      border-bottom: 2px solid #cbd5e1;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .v-table tbody td {
      padding: 8px 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    .v-table .v-num { font-weight: 700; color: #0f172a; white-space: nowrap; }
    .v-table .v-date, .v-table .v-tech, .v-table .v-status,
    .v-table .v-hours, .v-table .v-miles { color: #334155; white-space: nowrap; }
    .v-table .v-notes-cell { background: #f8fafc; padding: 10px 14px 12px; }
    .v-table .v-notes-label {
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .v-table .v-notes-body { font-size: 10pt; color: #334155; white-space: pre-wrap; line-height: 1.55; }
    
    /* Table */
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; text-align: left; padding: 8px 10px; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; font-weight: 600; }
    td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; font-size: 10pt; }
    code { font-family: monospace; font-size: 9pt; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
    
    /* Photos — 3-column grid, small thumbnails */
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .photo-item { overflow: hidden; }
    .photo-item img { 
      width: 100%; 
      height: auto;
      border-radius: 6px; 
      border: 1px solid #e2e8f0; 
      display: block; 
    }
    .photo-label { font-size: 7pt; color: #64748b; margin-top: 3px; }
    .page-break { page-break-before: always; break-before: page; height: 0; margin: 0; padding: 0; }

    /* Page-break guards — keep semantically related blocks together when
       printing so a visit row + its notes don't split across pages, and a
       table row doesn't break mid-cell. */
    .section { page-break-inside: avoid; break-inside: avoid; }
    .v-table tr { page-break-inside: avoid; break-inside: avoid; }
    .v-table .v-notes-cell { page-break-inside: avoid; break-inside: avoid; }
    .photo-item { page-break-inside: avoid; break-inside: avoid; }
    .narrative { page-break-inside: avoid; break-inside: avoid; }
    h2 { page-break-after: avoid; break-after: avoid; }

    /* Footer */
    .footer {
      margin-top: 32px; padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      display: flex; justify-content: space-between; align-items: center;
    }
    .footer-left { font-size: 8pt; color: #94a3b8; }
    .footer-right { font-size: 8pt; color: #94a3b8; text-align: right; }
    
    @media print {
      .page { padding: 20px; }
      .page-break { page-break-before: always; break-before: page; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="logo-area">
      <img src="${LOGO_DARK_DATA_URL}" alt="Fitzpatrick Warranty Service, LLC" />
    </div>
    <div class="report-info">
      <div class="call-number">Service Call #${call.id}</div>
      <div class="call-date">Date: ${formatDate(call.callDate)}</div>
      <div class="call-date">Report generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
    </div>
  </div>

  <!-- Status Bar -->
  <div class="status-bar">
    <div class="status-item">
      <span class="status-label">Call Status</span>
      <span class="badge ${getStatusBadgeClass(call.status)}">${esc(call.status)}</span>
    </div>
    <div class="status-item">
      <span class="status-label">Claim Status</span>
      <span class="badge ${getClaimBadgeClass(call.claimStatus)}">${esc(call.claimStatus)}</span>
    </div>
    <div class="status-item">
      <span class="status-label">Manufacturer</span>
      <span class="status-value">${esc(manufacturerDisplay)}</span>
    </div>
    <div class="status-item">
      <span class="status-label">Model</span>
      <span class="status-value" style="font-family:monospace">${esc(call.productModel)}</span>
    </div>
    ${call.productSerial ? `
    <div class="status-item">
      <span class="status-label">Serial #</span>
      <span class="status-value" style="font-family:monospace">${esc(call.productSerial)}</span>
    </div>
    ` : ""}
    ${call.scheduledDate ? `
    <div class="status-item">
      <span class="status-label">Scheduled</span>
      <span class="status-value">${formatDate(call.scheduledDate)}${call.scheduledTime ? ` at ${formatTime(call.scheduledTime)}` : ""}</span>
    </div>
    ` : ""}
  </div>

  <!-- Customer & Site -->
  <div class="section">
    <h2>Customer &amp; Job Site</h2>
    <div class="field-grid">
      <div class="field">
        <label>Customer / Distributor</label>
        <span class="value">${esc(call.customerName)}</span>
      </div>
      <div class="field">
        <label>Job Site / Project</label>
        <span class="value">${esc(call.jobSiteName)}</span>
      </div>
      <div class="field">
        <label>Address</label>
        <span class="value">${esc(call.jobSiteAddress)}, ${esc(call.jobSiteCity)}, ${esc(call.jobSiteState)}</span>
      </div>
      <div class="field">
        <label>Installation Date</label>
        <span class="value">${formatDate(call.installationDate)}</span>
      </div>
      ${call.contactName ? `
      <div class="field">
        <label>Installing Contractor</label>
        <span class="value">${esc(call.contactName)}</span>
      </div>
      ` : ""}
      ${call.contactPhone ? `
      <div class="field">
        <label>Contractor Phone</label>
        <span class="value">${esc(call.contactPhone)}</span>
      </div>
      ` : ""}
      ${call.contactEmail ? `
      <div class="field">
        <label>Contractor Email</label>
        <span class="value">${esc(call.contactEmail)}</span>
      </div>
      ` : ""}
      ${call.siteContactName ? `
      <div class="field">
        <label>On-Site Contact</label>
        <span class="value">${esc(call.siteContactName)}</span>
      </div>
      ` : ""}
      ${call.siteContactPhone ? `
      <div class="field">
        <label>Site Contact Phone</label>
        <span class="value">${esc(call.siteContactPhone)}</span>
      </div>
      ` : ""}
      ${call.siteContactEmail ? `
      <div class="field">
        <label>Site Contact Email</label>
        <span class="value">${esc(call.siteContactEmail)}</span>
      </div>
      ` : ""}
    </div>
  </div>

  ${(call.hoursOnJob || call.milesTraveled) ? `
  <!-- Job Logistics -->
  <div class="section">
    <h2>Job Logistics</h2>
    <div class="field-grid">
      ${call.hoursOnJob ? `
      <div class="field">
        <label>Hours on Job</label>
        <span class="value">${esc(call.hoursOnJob)} hrs</span>
      </div>
      ` : ""}
      ${call.milesTraveled ? `
      <div class="field">
        <label>Miles Traveled</label>
        <span class="value">${esc(call.milesTraveled)} mi</span>
      </div>
      ` : ""}
    </div>
  </div>
  ` : ""}

  <!-- Issue Description -->
  <div class="section">
    <h2>Issue Description</h2>
    <div class="narrative"><p>${esc(call.issueDescription)}</p></div>
  </div>

  ${call.diagnosis ? `
  <div class="section">
    <h2>Diagnosis</h2>
    <div class="narrative"><p>${esc(call.diagnosis)}</p></div>
  </div>
  ` : ""}

  ${call.resolution ? `
  <div class="section">
    <h2>Resolution</h2>
    <div class="narrative"><p>${esc(call.resolution)}</p></div>
  </div>
  ` : ""}

  ${call.techNotes && !hasAnyReturnVisit ? `
  <div class="section">
    <h2>Technician Notes</h2>
    <div class="narrative"><p>${esc(call.techNotes)}</p></div>
  </div>
  ` : ""}

  ${visitsHtml}

  ${partsHtml}
  ${claimSection}
  ${photosHtml}

  <!-- Footer -->
  <div class="footer">
    <div class="footer-left">
      Copyright Fitzpatrick Warranty Service, LLC. 2026
    </div>
    <div class="footer-right">
      Service Call #${call.id} · ${formatDate(call.callDate)}
    </div>
  </div>

</div>
</body>
</html>`;

  return html;
}

function getStatusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    "Scheduled": "badge-blue",
    "In Progress": "badge-amber",
    "Completed": "badge-green",
    "Pending Parts": "badge-orange",
    "Escalated": "badge-red",
  };
  return map[status] ?? "badge-gray";
}

function getClaimBadgeClass(status: string): string {
  const map: Record<string, string> = {
    "Not Filed": "badge-gray",
    "Submitted": "badge-blue",
    "Approved": "badge-green",
    "Denied": "badge-red",
    "Pending Review": "badge-purple",
  };
  return map[status] ?? "badge-gray";
}
