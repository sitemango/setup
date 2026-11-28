# Club logos — public Drive thumbnails

The clubs directory (`/clubs`) and each club's public page (`/c/<slug>`) show a
club's official mark, falling back to the deterministic `ClubMonogram` (initials
on a brand-safe gradient) for any club without one, or whenever the thumbnail
cannot be loaded. Nothing about the fallback is an error state.

## How delivery works

The 17 marks are hosted as **public Drive files** (shared *anyone with the
link — viewer*) and referenced from `<img>` tags directly via Google's CDN:

```
https://lh3.googleusercontent.com/d/<FILE_ID>=w256
```

No application server is in the image path: nothing to run, no environment
variables, no upload step, and the monogram fallback covers every failure
mode. The file IDs live in a code-side table (`lib/clubs/logos.js`) — the
IDs are not secrets (the files are public by design), but keeping them in one
reviewed table means a mark can be swapped or flipped to the monogram with a
one-line change.

The images are ≤ 100 KB JPEGs at ~1280 px; the `=w256` suffix asks Google for
a 256 px thumbnail, which stays sharp at the 58 px (card) and 64 px (hero)
render sizes even on 2× screens.

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
| `11.28.41.jpeg` | `team-maverick-india` — Team Maverick *(ID pending — file not shared yet)* |

File-name → slug was verified image-by-image in the 2026-11-28 review. The
Drive ID for each mark was recorded from the operator's public-link sharing
pass the same day (`name-descending` order of the `WhatsApp Image…` files
matches the pasted link order exactly).

## Adding or replacing a mark

- **New or replacement file**: upload the JPEG to Drive, share it *anyone with
  the link — viewer*, copy the ID from `https://drive.google.com/file/d/<ID>/view`,
  paste it into the matching entry in `lib/clubs/logos.js`, deploy.
- **Replacing in place** (same Drive file): *Manage versions → Upload new
  version* — the ID is unchanged and the new mark appears on next load.
- **Flipping a club back to the monogram**: empty the entry in the table and
  deploy. No migration, no deletion.
- **Never** hotlink anything but `lh3.googleusercontent.com` (or
  `drive.google.com/thumbnail?id=<ID>&sz=w256` as an equivalent fallback) —
  mixed content and unreliable viewers aside, other hosts are unreviewed
  change surfaces.

## Private delivery (alternative, not currently wired)

The repository still carries `/api/public/club-logo/[slug]` — a same-origin,
server-only endpoint that streams bytes from the private Campus+ storage
gateway (`upload_v3`-registered files only, checksum-verified, ETag/304),
and `npm run club-logos:register` (`scripts/register-club-logos.mjs`) which
registers a folder of marks through that gateway instead of sharing them
publicly. To switch to that model (e.g. if a mark becomes non-public):

1. `npm run club-logos:register -- --from /folder/with/the/17/jpegs --apply`
2. Point `clubLogoSrc` in `lib/clubs/logos.js` at
   `/api/public/club-logo/<slug>` again (the route and its tests were kept
   deliberately).
3. Keep `GOOGLE_APPS_SCRIPT_URL` and `GOOGLE_APPS_SCRIPT_SHARED_SECRET` set
   in Vercel (they already are — the rest of Campus+ storage uses them).

The trade-off is explicit: public thumbnails need no infrastructure and no
env vars, but the files are world-viewable via an opaque URL; private
delivery keeps the bytes off Google's public endpoints at the cost of one
gateway round-trip per cold render.

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

## Note on the original 2026-11-28 upload set

The marks were uploaded to Drive by hand; the gateway registers only
`campus-upload-v3-*` files, so hand-uploaded files can never back the private
route without re-registration (that is what `npm run club-logos:register`
does). The current public-thumbnail setup deliberately bypasses the gateway,
so the hand-uploaded files are now exactly what the site uses.
