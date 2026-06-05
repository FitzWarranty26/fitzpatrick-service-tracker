# RECOVERY INDEX — Fitzpatrick Warranty Service Tracker

## Purpose

This is a **business-critical, daily-use application**: the Fitzpatrick Warranty
Service Tracker. It is used in active operations, so continuity and recoverability
of the project state matter.

**The GitHub repository is the source of truth.** If there is ever any conflict
between what a planning tool, chat session, or task list shows and what is in the
repository, trust the repository.

> ⚠️ **Perplexity Projects / task visibility may be unreliable.** Task lists,
> project boards, or session history shown in the Perplexity UI can disappear,
> desync, or fail to load. Do **not** treat them as authoritative. Always
> reconstruct state from GitHub commit history first (see Recovery Procedure).

## Repository

| Field           | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Repo URL        | https://github.com/FitzWarranty26/fitzpatrick-service-tracker          |
| Default branch  | `master`                                                               |
| Visibility      | Public                                                                 |
| Description     | Warranty service tracking app for Fitzpatrick Warranty Service, LLC    |

## Key Recent Commits

These are anchor points for reconstructing recent work. List is newest-first.

| Commit    | Description                                                              |
| --------- | ------------------------------------------------------------------------ |
| `6e42ecb` | Merge: sidebar categorization                                            |
| `b80f793` | Sidebar sections and "New Service Call" CTA                              |
| `0f4e161` | Merge: photo categorization                                              |
| `454a758` | Built-in / custom photo labels                                           |
| `7a50eeb` | Merge: tech feedback batch                                               |
| `801d170` | Lightbox nav / photo grouping / homeowner phone / internal flag          |
| `a9e0982` | Permission boundary fixes                                                |
| `d33959a` | Tier 4: schedule / visit / calendar / dashboard data flow                |
| `f03d1f7` | Tier 3: data integrity                                                   |
| `0f8e5cb` | Tier 2: fixes                                                            |
| `a858c55` | Tier 1: fixes                                                            |
| `26b0df8` | App-wide data integrity sweep                                            |

## Recovered Perplexity Session Pointers

These session IDs point to planning/research work done in Perplexity. They are
recorded here because the Perplexity UI may not surface them reliably. Use them
to locate prior context if the UI is available; otherwise treat them as
historical references only.

| Session ID | Topic                                          |
| ---------- | ---------------------------------------------- |
| `2d5f17b8` | Warranty tracker business feasibility          |
| `2251645a` | PO (purchase order) module planning            |
| `e57aa4b9` | WarrVault / FieldSeal naming                   |

## Recovery Procedure

To reconstruct project state, follow these steps **in order**:

1. **GitHub commit history first.** Clone or pull
   `https://github.com/FitzWarranty26/fitzpatrick-service-tracker` (branch
   `master`) and read the commit log. This is the authoritative record of what
   the application actually is and does.

2. **Session IDs / artifacts next.** If you need planning or research context
   beyond the code, use the recovered Perplexity session pointers above to locate
   the relevant prior work and any associated artifacts.

3. **Perplexity UI last — only if restored.** If (and only if) the Perplexity
   Projects / task UI is functioning and trustworthy again, use it to fill in
   remaining gaps. Never rely on it as the primary source.
