import type { ServiceCall, Photo, Part } from "@shared/schema";
import { LOGO_DARK_DATA_URL } from "./logo-data";

interface ServiceCallFull extends ServiceCall {
  photos: Photo[];
  parts: Part[];
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
  } catch { return dateStr; }
}

export async function generatePDF(call: ServiceCallFull): Promise<void> {
  // Build an HTML report and open in a new window for print-to-PDF
  const manufacturerDisplay = call.manufacturer === "Other"
    ? (call.manufacturerOther ?? "Other")
    : call.manufacturer;

  const photosHtml = call.photos.length > 0
    ? `
      <div class="section">
        <h2>Photos (${call.photos.length})</h2>
        <div class="photo-grid">
          ${call.photos.map(p => `
            <div class="photo-item">
              <img src="${p.photoUrl}" alt="${p.caption || "Photo"}" />
              <div class="photo-label">
                <strong>${p.photoType}</strong>
                ${p.caption ? `<br/>${p.caption}` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `
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
                <td><code>${p.partNumber}</code></td>
                <td>${p.partDescription}</td>
                <td style="text-align:center">${p.quantity}</td>
                <td>${p.source ?? "—"}</td>
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
          <span class="value">${call.claimStatus}</span>
        </div>
        ${call.claimNotes ? `
          <div class="field full-width">
            <label>Claim Notes</label>
            <p class="value">${call.claimNotes}</p>
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
    
    /* Table */
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; text-align: left; padding: 8px 10px; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; font-weight: 600; }
    td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; font-size: 10pt; }
    code { font-family: monospace; font-size: 9pt; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
    
    /* Photos */
    .photo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .photo-item { break-inside: avoid; page-break-inside: avoid; margin-bottom: 8px; }
    .photo-item img { width: 100%; height: auto; border-radius: 6px; border: 1px solid #e2e8f0; display: block; }
    .photo-label { font-size: 8pt; color: #64748b; margin-top: 4px; }
    
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
      .section { break-inside: avoid; page-break-inside: avoid; }
      .photo-item { break-inside: avoid; page-break-inside: avoid; }
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
      <span class="badge ${getStatusBadgeClass(call.status)}">${call.status}</span>
    </div>
    <div class="status-item">
      <span class="status-label">Claim Status</span>
      <span class="badge ${getClaimBadgeClass(call.claimStatus)}">${call.claimStatus}</span>
    </div>
    <div class="status-item">
      <span class="status-label">Manufacturer</span>
      <span class="status-value">${manufacturerDisplay}</span>
    </div>
    <div class="status-item">
      <span class="status-label">Model</span>
      <span class="status-value" style="font-family:monospace">${call.productModel}</span>
    </div>
    ${call.productSerial ? `
    <div class="status-item">
      <span class="status-label">Serial #</span>
      <span class="status-value" style="font-family:monospace">${call.productSerial}</span>
    </div>
    ` : ""}
  </div>

  <!-- Customer & Site -->
  <div class="section">
    <h2>Customer &amp; Job Site</h2>
    <div class="field-grid">
      <div class="field">
        <label>Customer / Distributor</label>
        <span class="value">${call.customerName}</span>
      </div>
      <div class="field">
        <label>Job Site / Project</label>
        <span class="value">${call.jobSiteName}</span>
      </div>
      <div class="field">
        <label>Address</label>
        <span class="value">${call.jobSiteAddress}, ${call.jobSiteCity}, ${call.jobSiteState}</span>
      </div>
      <div class="field">
        <label>Installation Date</label>
        <span class="value">${formatDate(call.installationDate)}</span>
      </div>
      ${call.contactName ? `
      <div class="field">
        <label>Installing Contractor</label>
        <span class="value">${call.contactName}</span>
      </div>
      ` : ""}
      ${call.contactPhone ? `
      <div class="field">
        <label>Contractor Phone</label>
        <span class="value">${call.contactPhone}</span>
      </div>
      ` : ""}
      ${call.contactEmail ? `
      <div class="field">
        <label>Contractor Email</label>
        <span class="value">${call.contactEmail}</span>
      </div>
      ` : ""}
      ${call.siteContactName ? `
      <div class="field">
        <label>On-Site Contact</label>
        <span class="value">${call.siteContactName}</span>
      </div>
      ` : ""}
      ${call.siteContactPhone ? `
      <div class="field">
        <label>Site Contact Phone</label>
        <span class="value">${call.siteContactPhone}</span>
      </div>
      ` : ""}
      ${call.siteContactEmail ? `
      <div class="field">
        <label>Site Contact Email</label>
        <span class="value">${call.siteContactEmail}</span>
      </div>
      ` : ""}
    </div>
  </div>

  <!-- Issue Description -->
  <div class="section">
    <h2>Issue Description</h2>
    <div class="narrative"><p>${call.issueDescription}</p></div>
  </div>

  ${call.diagnosis ? `
  <div class="section">
    <h2>Diagnosis</h2>
    <div class="narrative"><p>${call.diagnosis}</p></div>
  </div>
  ` : ""}

  ${call.resolution ? `
  <div class="section">
    <h2>Resolution</h2>
    <div class="narrative"><p>${call.resolution}</p></div>
  </div>
  ` : ""}

  ${call.techNotes ? `
  <div class="section">
    <h2>Technician Notes</h2>
    <div class="narrative"><p>${call.techNotes}</p></div>
  </div>
  ` : ""}

  ${partsHtml}
  ${claimSection}
  ${photosHtml}

  <!-- Footer -->
  <div class="footer">
    <div class="footer-left">
      Fitzpatrick Warranty Service, LLC<br/>
      Utah &amp; Southern Idaho · kevin@fitzpatricksales.com
    </div>
    <div class="footer-right">
      Service Call #${call.id} · ${formatDate(call.callDate)}<br/>
      Generated by Fitzpatrick Service Tracker
    </div>
  </div>

</div>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("Popup blocked. Please allow popups for this site.");
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
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
