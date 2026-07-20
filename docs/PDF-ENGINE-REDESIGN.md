# DROVE — Server-Side PDF Engine (Commercial-Grade Redesign)

**Status:** PROPOSAL — propose only, no deploy
**Author:** Drafted with Perplexity Computer for Kevin Withers
**Date:** 2026-06-19
**Repo:** FitzWarranty26/fitzpatrick-service-tracker · branch target: `feature/server-pdf-engine`

---

## 1. Problem

Service-call PDF reports that include photos are **too large to email** (often 20–40 MB),
forcing a manual cloud-upload + share-link workaround for every report sent to a
customer or owner.

### Root cause (verified in code, not assumed)

There are two PDF paths today:

| Path | Where | Mechanism | Result |
|------|-------|-----------|--------|
| Download | `client/src/lib/pdf.ts` → `generatePDF()` | Opens HTML in new tab → browser **Print → Save as PDF** | Fine — real text, compressed photos |
| Share / Email | `client/src/pages/ServiceCallDetail.tsx:1158–1218` | **`html2canvas` → giant JPEG → `jsPDF`** | **Bloated** |

The share/email path is the problem, and the bloat is structural, not photo-related:

1. `html2canvas` at `scale: 2` rasterizes the **entire report** (text, tables, photos,
   whitespace) into one large canvas (`ServiceCallDetail.tsx:1182`).
2. The full canvas is re-encoded as **JPEG quality 0.92** (`:1201`).
3. **Bug:** the same full-document canvas is re-embedded **once per page** inside the
   `while (yOffset < imgHeight)` loop (`:1198–1205`). A 6-page report embeds the entire
   6-page image six times.

Photos themselves are **already correctly compressed at upload** —
`client/src/lib/image-utils.ts` resizes to max 1600px / JPEG q0.7 (~100–300 KB each).
**Do not add another photo-compression step; that is not the problem.**

### Why we are not just patching the client

A client-side patch (slice the canvas per page, lower scale/quality) would fix today's
file size, but it cannot serve the commercial roadmap:

- Screenshot PDFs have fuzzy, non-selectable, non-searchable text.
- No clean seam for **per-tenant branding** (logo/colors) required by the launch roadmap.
- No path to **emailing the PDF directly** (Postmark) or **storing in R2** — both are
  on the roadmap and both require the PDF to exist **server-side**.
- iOS-Safari-only (`navigator.share`) — inconsistent across the devices techs use.

---

## 2. Goal / Acceptance Criteria

- Photo-heavy service-call report PDFs are **≤ ~5 MB** (target 1–4 MB), comfortably under
  Outlook/Gmail's ~20–25 MB attachment limits. **No more cloud-link workaround.**
- PDFs contain **real, selectable, searchable vector text** — not screenshots.
- A **single server-side engine** produces the PDF for all consumers: download,
  email attachment, and (future) stored copy in R2.
- The engine accepts a **branding context** (logo + colors + company info) so a future
  tenant's own brand can appear on its documents — built now, even if multi-tenant data
  lands later.
- An **email-ready seam** exists from day one: the server can hand the PDF blob to an
  email sender (Postmark) and/or object storage (R2). Wiring the actual send can follow.
- `npm run check` (tsc) and `npm run build` pass. No production deploy without approval.

---

## 3. Architecture

### 3.1 Decision: separate render worker, Puppeteer + Chromium

```
┌─────────────────────────┐        report data (JSON)        ┌──────────────────────────┐
│  Web app                │ ───────────────────────────────▶ │  PDF render worker        │
│  Express 5 / (Postgres) │                                   │  Express + Puppeteer      │
│  warranty.fitz...com    │ ◀─────────  PDF (application/pdf) │  renders HTML → vector PDF│
└─────────────────────────┘                                   └──────────────────────────┘
        │                                                              ▲
        │ (future) attach + send                                      │ same HTML template
        ▼                                                              │ as today's pdf.ts
   Postmark email  ──▶ customer                                  per-tenant branding
        │
        └─▶ (future) store PDF in Cloudflare R2, return signed URL
```

**Why a separate service and not embedded in the web app:**

- Chromium needs ~300–500 MB RAM per render. The web service runs on **Render Starter
  (512 MB)** and also holds SQLite + on-disk backups (`render.yaml`). Embedding Chromium
  risks OOM-killing the business-critical app. **Unacceptable.**
- Independent scaling: report bursts (50+ tenants) scale the worker, not the live app.
- Matches the roadmap's multi-service direction (managed Postgres, R2, monitoring).

**Why Puppeteer/Chromium and not a JS PDF lib (pdfkit/jsPDF-native):**

- Reuses the **existing HTML report templates** (`pdf.ts` `buildPDFHtml`) almost verbatim
  — lowest-risk path to commercial quality, no re-authoring layouts.
- Branding = HTML/CSS injection. Trivial and per-tenant safe.
- Photos embed as their already-compressed JPEGs; Chromium produces compact vector PDFs.

**Chromium build:** use `puppeteer-core` + `@sparticuz/chromium` (slim, host-friendly
Chromium tuned for constrained/serverless Linux). In local dev, fall back to full
`puppeteer`. The worker runs as a **second Render service** (`type: web`, its own plan
sized for Chromium, e.g. Standard/2 GB).

### 3.2 Why Postgres migration does NOT affect this design

The PDF worker never touches the database driver. The web app gathers report data
(already does, via `storage.ts`) and passes **plain JSON** to the worker. Whether that
data comes from SQLite (`better-sqlite3`) today or Postgres (`drizzle` + `pg`) later is
invisible to the PDF engine. **The SQLite→Postgres migration and this PDF redesign are
independent workstreams and can proceed in either order.**

> One note for the migration: photos are currently stored as **base64 data URLs inside
> the DB** (`server/routes.ts:1067`). On Postgres these are large `text`/`bytea` columns.
> The roadmap's Phase 1 move to **R2** (store the file, keep only a key/URL) is the right
> long-term fix and will *further* shrink DB size and payloads — but it is out of scope
> for this PDF work. The PDF engine handles both forms (data URL or http(s) URL).

---

## 4. Shared template extraction (the key refactor)

Today `buildPDFHtml()` lives in `client/src/lib/pdf.ts` and depends only on data +
`@shared` helpers — it is pure string templating with **no browser APIs**. Move the pure
template into `shared/` so **both** client and the server worker import the same source.

```
shared/
  report-template/
    service-call-report.ts     # buildServiceCallReportHtml(data, branding) — pure, isomorphic
    branding.ts                # Branding type + DROVE/Fitzpatrick default; future per-tenant
    styles.ts                  # the CSS string (print-optimized; @page rules)
```

- `branding.ts` defines:
  ```ts
  export interface ReportBranding {
    companyName: string;
    logoDataUrl: string;     // data: URL or https URL
    primaryHex: string;      // header rule / titles
    accentHex: string;       // CTAs / highlights
    footerText: string;
  }
  ```
  Default export = current Fitzpatrick/DROVE branding (sourced from
  `Drove_Brand_Guidelines.pdf`: Charcoal Slate `#2B3440`, Burnt Sienna `#C65A2E`).
  Later, a tenant row supplies its own `ReportBranding` — **no template changes needed.**

- The CSS gains real print rules for crisp paged output:
  ```css
  @page { size: Letter; margin: 0.5in; }
  .page-break { break-before: page; }
  .photo-item, tr, .section { break-inside: avoid; }
  ```

The client keeps `generatePDF()` (browser print) as a **local fallback** but the primary
path becomes "ask the server for the PDF."

---

## 5. Server worker API

New service `pdf-worker/` (or a route group if we later co-locate). Endpoints:

```
POST /render/service-call
  body: { report: ServiceCallReportData, branding?: ReportBranding }
  200:  application/pdf  (binary)         ← download / attach
  - Renders shared HTML with Puppeteer page.pdf({ format: "Letter",
    printBackground: true, preferCSSPageSize: true }).
  - Chromium launched once and reused (singleton browser, new page per request).

GET  /healthz   → 200 for Render health checks
```

Security: worker accepts requests **only** from the web app via a shared secret header
(`x-pdf-secret`, `sync:false` in `render.yaml`, mirrors the existing `BACKUP_SECRET`
pattern). Never exposed publicly without auth.

### Web app side

```
GET /api/service-calls/:id/report.pdf   (requireAuth)
  - Gathers the same data generatePDF uses today (storage + visits + tech names).
  - Builds ReportBranding (default today; tenant-derived later).
  - Calls the PDF worker, streams application/pdf back to the browser with
    Content-Disposition: attachment; filename="Service-Call-<id>.pdf".
```

Client change: the "Download PDF" and "Email/Share" buttons fetch this endpoint.
- **Download:** save the returned blob.
- **Email/Share:** wrap the returned blob in a `File` and pass to `navigator.share`
  (same UX as today) — but now it's a small vector PDF, not a screenshot.

---

## 6. Email-ready seam (built now, send wired later)

Add a thin, provider-agnostic interface so email can be turned on without touching the
render code:

```ts
// server/delivery/pdf-delivery.ts
export interface PdfDelivery {
  // returns a URL if stored, or void if only attached
  deliver(args: {
    pdf: Buffer;
    filename: string;
    to?: string;             // customer/owner email
    subject?: string;
    body?: string;
  }): Promise<{ url?: string }>;
}
```

Implementations (added incrementally, behind env flags):
- `DownloadOnlyDelivery` (default now) — no-op, app streams the PDF to the browser.
- `PostmarkDelivery` (roadmap) — attaches PDF, sends via Postmark
  (`POSTMARK_SERVER_TOKEN`), per the feature plan's notification triggers.
- `R2Delivery` (roadmap) — `PutObject` to Cloudflare R2, returns a signed URL.

Because delivery is an interface, enabling email = implement one class + set env vars.
**No change to the render worker or templates.**

---

## 7. Files touched

**New**
- `shared/report-template/service-call-report.ts` — isomorphic HTML builder (moved from `pdf.ts`)
- `shared/report-template/branding.ts` — `ReportBranding` + default
- `shared/report-template/styles.ts` — print CSS
- `pdf-worker/index.ts` — Express + Puppeteer render service
- `pdf-worker/package.json` — `puppeteer-core`, `@sparticuz/chromium`, `express`
- `server/delivery/pdf-delivery.ts` — delivery interface + `DownloadOnlyDelivery`
- `docs/PDF-ENGINE-REDESIGN.md` — this document

**Modified**
- `server/routes.ts` — add `GET /api/service-calls/:id/report.pdf` (calls worker, streams)
- `client/src/lib/pdf.ts` — import shared template; keep browser-print as fallback
- `client/src/pages/ServiceCallDetail.tsx` — **remove the html2canvas/jsPDF block**
  (`:1158–1218`); download + share fetch the server PDF
- `render.yaml` — add `pdf-worker` web service + `PDF_WORKER_URL` / `PDF_SHARED_SECRET`
  env vars on the web service
- `package.json` — drop client `html2canvas` dependency once share path is migrated
- `CHANGELOG.md`, `DEPLOYMENT-LOG.md`, `RECOVERY-INDEX.md` — per operating playbook

**Deleted (after verification)**
- The `html2canvas` + per-page `addImage` loop in `ServiceCallDetail.tsx`

---

## 8. Rollout & risk

1. **Behind a flag.** New endpoint + worker ship dark; client keeps browser-print
   `generatePDF()` as fallback. Flip the buttons to the server path only after the worker
   is verified healthy in production.
2. **Worker sizing.** Chromium needs more RAM than Starter. The worker is a *separate*
   service — sizing it (e.g. Render Standard/2 GB) does **not** change the web app's plan
   or its persistent disk. The business-critical app is untouched.
3. **Cold starts.** Reuse a singleton Chromium browser; add `/healthz`. Consider min-1
   instance so the first report of the day isn't slow.
4. **Rollback.** No DB/schema changes. Rollback = revert the client buttons to
   `generatePDF()` (browser print). The worker can be left running or paused
   independently. Known-good tag: `known-good-2026-06-05` (commit 44e91ce).
5. **No customer data in logs.** Worker logs status/size only — never report bodies,
   photos, or PII.

---

## 9. Phasing inside this PR (full engine, sequenced)

- **P1 — Extract template to `shared/`** (no behavior change; `check`+`build` green).
- **P2 — Stand up `pdf-worker`** with `/render/service-call` + `/healthz`; secret-gated.
- **P3 — Web app endpoint** `GET /api/service-calls/:id/report.pdf` streaming the worker output.
- **P4 — Client refactor:** download + share fetch server PDF; remove html2canvas path.
- **P5 — Branding + delivery seam:** `ReportBranding` default + `PdfDelivery` interface
  (`DownloadOnlyDelivery`); Postmark/R2 stubs documented for the roadmap.
- **P6 — Docs + checks:** CHANGELOG / DEPLOYMENT-LOG / RECOVERY-INDEX; `check` + `build`.

**Deploy:** PROPOSE ONLY. Branch + PR + green checks. No production deploy without Kevin's
explicit approval. The new `pdf-worker` service must be provisioned on Render before the
client is flipped to the server path.
