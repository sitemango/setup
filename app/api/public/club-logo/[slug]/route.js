import { CLUB_SLUG_REGEX } from '@/lib/constants';
import { clubLogoFileId, isClubLogoSlug } from '@/lib/clubs/logos';
import { getPublicClubBySlug, isPubliclyListedClub } from '@/lib/data/public';
import { getFileMetadata, downloadFile } from '@/lib/storage';

/**
 * Public streaming endpoint for the 17 club marks.
 *
 * These are platform assets, not user content: every visible club page is
 * already public, and the marks are no more sensitive than the public club
 * directory itself. The images are served exclusively through Campus+ — the
 * Drive folder stays private, no Drive URL or file ID is ever emitted, and
 * access patterns don't double as a private-storage oracle.
 *
 * Freshness vs. load: a short process-local cache (5 minutes, bounded to the
 * configured marks) holds the verified bytes. The ETag is the SHA-256 of the
 * bytes, so browsers and edges revalidate cheaply; a replaced file keeps its
 * ID and simply yields a new checksum — stale entries expire on their own.
 * Errors are never cached: a mark that fails to load falls back to the
 * monogram on the client and is retried on the next request.
 */

const CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 24;
const cache = new Map(); // slug -> { bytes, mime, etag, expires }
const inflight = new Map(); // slug -> Promise<entry>

function imageResponse(entry, request) {
  const etag = `"${entry.checksum}"`;
  const headers = {
    'Content-Type': entry.mime,
    'Content-Length': String(entry.bytes.length),
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    // Revalidate every load so a replaced mark appears promptly; the ETag
    // keeps those revalidations as 304s instead of re-downloads.
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: etag,
  };
  if (request?.headers?.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(entry.bytes, { status: 200, headers });
}

const failure = (status) => new Response(null, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

async function load(slug) {
  const fileId = clubLogoFileId(slug);
  if (!fileId) return null;
  const metadata = await getFileMetadata(fileId); // { size, mime, checksum } — throws when unconfigured/unavailable
  if (!CONTENT_TYPES.has(metadata?.mime)) return null;
  const bytes = await downloadFile(fileId, metadata); // re-verified byte-for-byte against the checksum
  return { bytes, mime: metadata.mime, checksum: metadata.checksum, expires: Date.now() + CACHE_TTL_MS };
}

async function loadShared(slug) {
  const cached = cache.get(slug);
  if (cached && cached.expires > Date.now()) return cached;
  let pending = inflight.get(slug);
  if (!pending) {
    pending = load(slug).finally(() => inflight.delete(slug));
    inflight.set(slug, pending);
  }
  const entry = await pending; // throws on gateway/storage failure
  if (entry) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(slug, entry);
  }
  return entry;
}

/** Test hook: drop the process-local cache/in-flight map so unit tests start clean. */
export function __resetClubLogoCache() {
  cache.clear();
  inflight.clear();
}

export async function GET(request, { params }) {
  const { slug } = await params;
  if (!CLUB_SLUG_REGEX.test(slug) || !isClubLogoSlug(slug)) return failure(404);

  const { item, unavailable } = await getPublicClubBySlug(slug);
  if (unavailable) return failure(503);
  if (!isPubliclyListedClub(item)) return failure(404);

  const fileId = clubLogoFileId(slug);
  if (!fileId) return failure(404);

  try {
    const entry = await loadShared(slug);
    if (!entry) return failure(404);
    return imageResponse(entry, request);
  } catch {
    return failure(503);
  }
}
