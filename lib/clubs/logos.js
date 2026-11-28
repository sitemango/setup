/**
 * Club logos — the 17 organization marks shown on the clubs directory and
 * the club profile hero.
 *
 * Why this is a code-side table and not a database column: the logos are
 * platform assets reviewed once, not user content. They are registered once
 * by the platform operator through the SAME private Campus+ Apps Script
 * gateway used for all storage (the `upload_v3` operation — see
 * integrations/google-apps-script/Code.gs): the script at
 * scripts/register-club-logos.mjs re-uploads the marks from local files and
 * writes the returned Drive IDs into this table. The gateway only serves
 * `campus-upload-v3-*` files that live in the Campus+ storage folder, so an
 * ID recorded here is fetchable via `/api/public/club-logo/<slug>`; the ID
 * itself is never sent to the browser, and there is no database column, no
 * feature flag and nothing user-supplied involved.
 *
 * Registration procedure (see docs/CLUB-LOGOS.md for the full runbook):
 *   npm run club-logos:register -- --from /path/to/folder-of-logos --apply
 *
 * The command validates the 17 files locally (presence, size, MIME magic),
 * uploads them sequentially, and rewrites the IDs below atomically. Run it
 * without --apply for a dry-run preflight. Clubs with an empty ID — or whose
 * mark fails to load for any reason — keep the deterministic ClubMonogram
 * fallback. Deleting an entry (empty string) flips the club back to the
 * monogram; no migration.
 *
 * New uploads change the file, not the ID, only when the file itself is
 * replaced in place (Manage versions → Upload new version). Registering the
 * marks again produces NEW IDs and rewrites this file.
 */

export const CLUB_LOGO_FILES = {
  // Department student associations
  ciesa: '', // 11.28.34 (1).jpeg — Civil Engineering Students Association
  aimsa: '', // 11.28.34.jpeg — AI & Machine Learning Students Association
  etsa: '', // 11.28.35 (2).jpeg — Electronics & Telecommunication Students Association
  cresa: '', // 11.28.35.jpeg — CRESA
  itsa: '', // 11.28.37 (2).jpeg — Information Technology Students Association
  mesa: '', // 11.28.37.jpeg — Mechanical Engineering Students Association
  // Professional chapters and technology communities
  'gdg-campus': '', // 11.28.37 (1).jpeg — GDG on Campus (Google Developer Groups)
  'owasp-pccoe': '', // 11.28.38 (1).jpeg — OWASP PCCOE (wasp over fingerprint)
  'acm-w-pccoe': '', // 11.28.38 (2).jpeg — ACM-W PCCOE
  'acm-pccoe': '', // 11.28.39 (1).jpeg — ACM PCCOE
  // Collegiate teams
  'team-solarium': '', // 11.28.38.jpeg — Team Solarium (sun/gear)
  'team-ambush': '', // 11.28.39.jpeg — Team Ambush (tractor)
  'team-anantam': '', // 11.28.40 (1).jpeg — Team Anantam (motorsports)
  'team-kratos-racing-electric': '', // 11.28.40 (2).jpeg — Kratos Racing
  'team-automatons': '', // 11.28.40.jpeg — Team Automatons
  'team-maverick-india': '', // 11.28.41.jpeg — Team Maverick (motorsports)
  // Microsoft Learn Student Club — not yet listed in the club catalogue, so
  // this is inert until an `mlsc-pccoe` row lands (see docs/CLUB-LOGOS.md).
  'mlsc-pccoe': '', // 11.28.35 (1).jpeg — Microsoft Learn Student Club
};

export const CLUB_LOGO_SLUGS = Object.freeze(Object.keys(CLUB_LOGO_FILES));

const isWellFormedId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id);

export function isClubLogoSlug(slug) {
  return typeof slug === 'string' && slug in CLUB_LOGO_FILES;
}

/** Pure table logic, exported for tests: configured = slug known + a real file ID present. */
export function clubLogoSrcFromMap(map, slug) {
  if (typeof slug !== 'string') return null;
  const fileId = map[slug];
  if (!isWellFormedId(fileId)) return null;
  return `/api/public/club-logo/${encodeURIComponent(slug)}`;
}

/**
 * The same-origin URL for a club's logo, or null when none is configured.
 * Always null-safe: callers fall back to ClubMonogram.
 */
export function clubLogoSrc(slug) {
  return clubLogoSrcFromMap(CLUB_LOGO_FILES, slug);
}

/** Server-side helper for the streaming route. Never exposed to the client. */
export function clubLogoFileId(slug) {
  const fileId = typeof slug === 'string' ? CLUB_LOGO_FILES[slug] : null;
  return isWellFormedId(fileId) ? fileId : null;
}
