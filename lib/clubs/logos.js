/**
 * Club logos — the 17 organization marks shown on the clubs directory and
 * the club profile hero.
 *
 * Why this is a code-side table and not a database column: the logos are
 * platform assets reviewed once, not user content. The marks are hosted as
 * public Drive files (shared "anyone with the link — viewer") and referenced
 * as lh3.googleusercontent.com thumbnails, so each club's <img> loads
 * straight from Google's CDN — no application server in the path, nothing
 * to keep running, no environment variables.
 *
 * Every ID was mapped file-name → slug (verified against the mark images)
 * and the public links were shared by the operator on 2026-11-28. Clubs
 * with an empty ID — or whose thumbnail fails to load — keep the
 * deterministic ClubMonogram fallback.
 *
 * src shape: https://lh3.googleusercontent.com/d/<FILE_ID>=w256
 * (256 px wide — sharp at 58/64 px display sizes even on 2× screens.)
 *
 * Replacing a mark: right-click the Drive file → Manage versions → Upload
 * new version keeps the ID. Registering a new file means a new ID: paste it
 * into the matching entry below and deploy.
 *
 * Alternative private setup: the repository also carries
 * `/api/public/club-logo/[slug]` (same-origin streaming from the private
 * Campus+ storage gateway — see docs/CLUB-LOGOS.md § "Private delivery").
 * It is intentionally not wired to the components; flip `clubLogoSrc` to
 * `/api/public/club-logo/<slug>` and register the files via
 * `npm run club-logos:register` to go back to fully private delivery.
 */

export const CLUB_LOGO_FILES = {
  // Department student associations
  ciesa: '16hYaVj5QMW_91b3xnd7uZAe6bNlq9nuC', // 11.28.34 (1).jpeg — Civil Engineering Students Association
  aimsa: '1p0BvI1yDxmOcbI_vRzvIOrO6EFQl46Lz', // 11.28.34.jpeg — AI & Machine Learning Students Association
  etsa: '1PQwfS8fcOLG_hOmB30tIh2mAuUY0t3hN', // 11.28.35 (2).jpeg — Electronics & Telecommunication Students Association
  cresa: '11hkEmc89PKGzvNnxDJh2R0LJ4Rz2GH9_', // 11.28.35.jpeg — CRESA
  itsa: '16vqrvsJJ5cs84DmvToUx18GrhmFt9Cke', // 11.28.37 (2).jpeg — Information Technology Students Association
  mesa: '1yhZAcmE8Y-KDkAZYYsK-jtiln3sEmVmo', // 11.28.37.jpeg — Mechanical Engineering Students Association
  // Professional chapters and technology communities
  'gdg-campus': '1T1bX3GPerXXBrBhmoGgcH0P-7uKn7Q7O', // 11.28.37 (1).jpeg — GDG on Campus (Google Developer Groups)
  'owasp-pccoe': '1KKNar1JmPIrrGzMkxBMufDmYaY_QTM3E', // 11.28.38 (1).jpeg — OWASP PCCOE (wasp over fingerprint)
  'acm-w-pccoe': '1Nw0jJPoqzBgLvPKZCawWLvLvruz4MnBV', // 11.28.38 (2).jpeg — ACM-W PCCOE
  'acm-pccoe': '1aJ1RuK-WxOsiMEeHIsQwnyH_Z3NToJ_c', // 11.28.39 (1).jpeg — ACM PCCOE
  // Collegiate teams
  'team-solarium': '18B4EljR9HAkwZzGYoHLb3URv0PHL66NZ', // 11.28.38.jpeg — Team Solarium (sun/gear)
  'team-ambush': '10jjrAxSf6abaFOuF7sB8ZVHTqMbbUpoz', // 11.28.39.jpeg — Team Ambush (tractor)
  'team-anantam': '1nu1R9TB4_gVvKZnbX8GyFobJRKBJXuyS', // 11.28.40 (1).jpeg — Team Anantam (motorsports)
  'team-kratos-racing-electric': '1YidrmxXfIIgsp2bJYPMkaAv7KaJuYyX9', // 11.28.40 (2).jpeg — Kratos Racing
  'team-automatons': '1Lyox-3hgjqKs4u16bEzReovMKTdiJYef', // 11.28.40.jpeg — Team Automatons
  // 11.28.41.jpeg — Team Maverick: file not yet shared publicly; wire its ID here to enable the logo.
  'team-maverick-india': '', // 11.28.41.jpeg — Team Maverick (motorsports)
  // Microsoft Learn Student Club — not yet listed in the club catalogue, so
  // this is inert until an `mlsc-pccoe` row lands (see docs/CLUB-LOGOS.md).
  'mlsc-pccoe': '1KmV1gvpvOOuG_aESvoJPhB-gS_G9KdNK', // 11.28.35 (1).jpeg — Microsoft Learn Student Club
};

export const CLUB_LOGO_SLUGS = Object.freeze(Object.keys(CLUB_LOGO_FILES));

const isWellFormedId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id);

/** Public Google thumbnail URL for a Drive file ID. */
export function clubLogoThumbnailUrl(fileId) {
  return `https://lh3.googleusercontent.com/d/${fileId}=w256`;
}

export function isClubLogoSlug(slug) {
  return typeof slug === 'string' && slug in CLUB_LOGO_FILES;
}

/** Pure table logic, exported for tests: configured = slug known + a real file ID present. */
export function clubLogoSrcFromMap(map, slug) {
  if (typeof slug !== 'string') return null;
  const fileId = map[slug];
  if (!isWellFormedId(fileId)) return null;
  return clubLogoThumbnailUrl(fileId);
}

/**
 * The public URL for a club's logo, or null when none is configured.
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
