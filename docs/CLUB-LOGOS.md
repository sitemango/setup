# Club logos — registration runbook

The clubs directory (`/clubs`) and each club's public page (`/c/<slug>`) show a
club's official mark, falling back to the deterministic `ClubMonogram` (initials
on a brand-safe gradient) for any club without one, or whenever the mark
cannot be served. Nothing about the fallback is an error state.

## The model, briefly

- The logos are **platform assets**, not user content. They are registered once
  by the platform operator and reviewed like the catalogue itself.
- Files are registered **through the same private Apps Script gateway as every
  other Campus+ upload** (`upload_v3` — see `integrations/google-apps-script/Code.gs`).
  They land in the private `Campus+ Uploads` Drive folder, are **not shared**,
  and no "anyone with the link" or public Drive URL is ever needed.
- The public site serves each mark through **one same-origin endpoint**,
  `GET /api/public/club-logo/<slug>`, which resolves the slug → Drive file ID
  from a code-side table (`lib/clubs/logos.js`), reads the bytes through the
  server-only gateway (`metadata` + checksum-verified `download`), and streams
  them with a strong ETag (the SHA-256 of the bytes) and
  `Cache-Control: public, max-age=0, must-revalidate`. A 100 KB JPEG is
  revalidated as a 304, never re-downloaded, until it changes.
- The Drive file ID **never reaches the browser**. There is no feature flag
  and no database column; nothing user-supplied can make the gateway read an
  arbitrary file. The gateway only serves `campus-upload-v3-*` files from the
  storage folder, which is why the marks must be registered through it rather
  than uploaded by hand.
- Clubs are public pages, so the marks are public assets (like the OG images
  from `app/api/public/club-image`). They carry no personal data; serving
  them without a session is deliberate.

> **Why not just use the Drive links?** The gateway only streams files that
> live in the Campus+ storage folder under its `campus-upload-v3-*` naming, so
> files uploaded to an arbitrary Drive folder cannot be served by the site.
> The direct-upload copies made on 2026-11-28 are therefore not referenced by
> the app and can be moved or deleted; registering via the command below
> creates fresh, gateway-servable copies and IDs.

## The 17 marks

| File (`WhatsApp Image 2026-11-28 at …`) | `lib/clubs/logos.js` slug |
| --- | --- |
| `11.28.34 (1).jpeg` | `ciesa` — Civil Engineering Students Association |
| `11.28.34.jpeg` | `aimsa` — AI & Machine Learning Students Association |
| `11.28.35 (1).jpeg` | `mlsc-pccoe` — Microsoft Learn Student Club *(inert — see below)* |
| `11.28.35 (2).jpeg` | `etsa` — Electronics & Telecommunication Students Association |
| `11.28.35.jpeg` | `cresa` — CRESA |
| `11.28.37 (1).jpeg` | `gdg-campus` — GDG on Campus |
| `11.28.37 (2).jpeg` | `itsa` — Information Technology Students Association |
| `11.28.37.jpeg` | `mesa` — Mechanical Engineering Students Association |
| `11.28.38 (1).jpeg` | `owasp-pccoe` — OWASP PCCOE |
| `11.28.38 (2).jpeg` | `acm-w-pccoe` — ACM-W PCCOE |
| `11.28.38.jpeg` | `team-solarium` — Team Solarium |
| `11.28.39 (1).jpeg` | `acm-pccoe` — ACM PCCOE |
| `11.28.39.jpeg` | `team-ambush` — Team Ambush |
| `11.28.40 (1).jpeg` | `team-anantam` — Team Anantam |
| `11.28.40 (2).jpeg` | `team-kratos-racing-electric` — Kratos Racing |
| `11.28.40.jpeg` | `team-automatons` — Team Automatons |
| `11.28.41.jpeg` | `team-maverick-india` — Team Maverick |

The filenames above are the exact names of the JPEGs as uploaded on
2026-11-28; every row was verified against the image contents. The registration
script maps **file name → slug** exactly as listed here and aborts before
uploading anything if a file is missing or fails its JPEG signature check.

## Registering (one command)

Prerequisites:

- The 17 files, with the exact names above, in one folder on your machine.
- `GOOGLE_APPS_SCRIPT_URL` and `GOOGLE_APPS_SCRIPT_SHARED_SECRET` in the
  environment or in `.env.local` (the same values already used by Campus+
  storage; the deployed Apps Script stays as-is — no redeploy needed).
- The existing storage integration working (the script calls the same
  signed `upload_v3` operation profile photos use).

```bash
# 1. Preflight only — validates presence, size and JPEG signatures. Uploads nothing.
npm run club-logos:register -- --from /path/to/folder

# 2. Apply — uploads the 17 marks sequentially and rewrites lib/clubs/logos.js atomically.
npm run club-logos:register -- --from /path/to/folder --apply
```

What `--apply` does, in order:

1. Validates all 17 files locally; aborts **before any upload** on the first problem.
2. Uploads each file with a fresh v3 key. If any upload fails it stops and
   prints the IDs that were already uploaded (the table is left untouched), so
   a re-run or a manual fix can account for every file.
3. Rewrites only the 17 ID strings in `lib/clubs/logos.js` (atomic
   write-then-rename) and verifies the result before saving.

Then:

4. `git diff lib/clubs/logos.js` — you should see 17 one-line ID changes.
5. Commit and deploy. On Vercel, `GOOGLE_APPS_SCRIPT_URL` and
   `GOOGLE_APPS_SCRIPT_SHARED_SECRET` must be set for the endpoint to stream.
   Any failure — missing env, unreachable gateway, replaced file with a
   mismatched checksum — degrades to the monogram, never to a broken `<img>`.
6. Smoke-test after deploy: `curl -i https://<host>/api/public/club-logo/team-automatons`
   should return `200 image/jpeg` (or 304 on revalidation).

## Notes

- **Replacing a logo**: right-click → *Manage versions* → *Upload new version*
  on the registered Drive file keeps the ID — the next revalidation serves the
  new mark automatically. Re-running the registration script creates **new**
  IDs and rewrites the table.
- **Freshness**: browsers revalidate every load (the ETag answers 304); the
  server keeps the verified bytes for 5 minutes per process, so a swap may
  take up to 5 minutes to appear everywhere.
- **Flipping a club off its logo**: empty the entry — no migration, no
  deletion, deploy, and the club is back on its monogram.
- The images are ≤ 100 KB JPEGs; the gateway enforces the storage layer's
  3 MiB cap and image-only MIME types. Never register non-image files.

## MLSC is not in the catalogue yet

The Microsoft Learn Student Club mark is wired for slug `mlsc-pccoe`, but the
seeded catalogue (migration 032) has no `mlsc-pccoe` row, so there is no page
to render it on yet. To add it, a migration is required (for example an
`insert ... on conflict do nothing` for `mlsc-pccoe`, name `MLSC — Microsoft
Learn Student Club PCCOE`, organization type `collegiate_team` or
`professional_chapter`, verification `pending`) — do **not** let an automated
tool apply migrations to the production project; have the authorized operator
review it first. Until the row exists, the `mlsc-pccoe` entry stays inert and
the card/hero simply show monograms.
