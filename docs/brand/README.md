# DROVE Brand Assets

Canonical brand library for DROVE — used by the Phase 3.5 rebrand (Issue #36),
the Expo React Native Technician App (ADR-0003, Issues #30–#35), the marketing
site (#23), and all social/marketing work. Full usage rules (colors, spacing,
typography) live in `Drove_Brand_Guidelines.pdf` (kept in the Perplexity Space
files; ask Kevin if you need it).

Brand ethos (decision root, per Kevin, 2026-07-17): DROVE is a STRONG brand.
Code, UI, and UX are held to a first-class bar — nothing ships as "just good
enough." The geometric, forward-charging bison is the design language the
product should speak. Tagline: **"Keep the herd moving."**

## Folder index

| Folder | Contents | Use |
| --- | --- | --- |
| `png/` | Primary horizontal lockup (400–3000w), stacked lockup (400–1200w), hero bison mark (200–2000w), bison silhouette (100–800w), plus **transparent-background versions** of each (`*_transparent.png`, verified alpha) | App UI, headers, splash screens, docs. **Prefer the `*_transparent.png` files** on any non-white surface. |
| `wordmarks/` | DROVE wordmark in black, charcoal, white-on-charcoal, and with-tagline (PNG, 1818w) | Text-only brand moments: PDFs/invoices, email, footers. |
| `favicon/` | `favicon.ico`, favicon PNGs 16–512 (dark) and `favicon_light_*` variants, `apple-touch-icon.png`, `android-chrome-*.png`, `app_icon_1024.png` + rounded | Web app favicon set (#36), iOS/Android app icons and store listings (#31, #32). |
| `monochrome/` | Bison silhouette in black, charcoal, sienna, white (PNG) | Single-color contexts: watermarks, embossing, loading states, dark/light UI accents. |
| `social/` | Platform-sized art in JPG + PNG: X, LinkedIn, Facebook, Instagram, YouTube (profiles, banners, covers, posts, stories), email signatures (400x120, 600x200), web headers (2400x800), web logo (800x300), square avatars (400–1024) | Marketing site (#23), social accounts, email signatures. |
| top level | `drove_primary_horizontal_3000w.jpg`, `hero_bison_2000w.jpg` | Original first-committed JPGs (white background), kept for compatibility; prefer `png/`. |

## Color reference (from the mark)

- Charcoal (body): dark slate/charcoal panels
- Sienna (hump/head): burnt-orange accent
- Bone (panel lines / light backgrounds)

Exact hex values, clear-space, and minimum-size rules: see
`Drove_Brand_Guidelines.pdf`.

## Notes for the app build

- iOS/Android app icons (Phase 5): start from `favicon/app_icon_1024.png`
  (Apple wants un-rounded 1024x1024; the OS applies masking).
- Web favicon (Phase 3.5): wire `favicon/favicon.ico` + PNG sizes with
  `favicon_light_*` served via `prefers-color-scheme` media queries.
- No SVG/vector exports are in the repo yet. If vector originals exist, add
  them under `svg/` — they are the ideal source for RN splash screens and
  any future print work.

## History

- 2026-07-17 — PR #72 initial two JPGs · PR #73 `png/` lockups & marks
  (Kevin, via GitHub upload) · PR #74 `favicon/`, `monochrome/`, `social/`
  (Kevin) · PR #75 wordmarks (Kevin) · PR #76 this index + `wordmarks/`
  folder organization.
