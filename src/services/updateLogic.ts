/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure update-check logic (no Capacitor imports, unit-testable).
 * Mirrors the Anvex updater rules:
 *  - scan the releases LIST for strict vX.Y.Z tags (never /releases/latest)
 *  - a .sha256 sidecar asset is MANDATORY — a release without one is skipped
 *  - asset URLs must stay under this repo's /releases/download/ prefix
 */

export interface ReleaseAssetLike {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface ReleaseLike {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  body?: string | null;
  published_at?: string | null;
  assets: ReleaseAssetLike[];
}

export interface UpdateInfo {
  version: string;
  tag: string;
  apkUrl: string;
  apkSize: number;
  sha256Url: string;
  /** Expected SHA-256 of the APK when the source provides it inline
   *  (update feed). Empty for the GitHub-list path, where the digest
   *  comes from the .sha256 sidecar instead. */
  sha256: string;
  notes: string;
  publishedAt: string;
}

/** Numeric dotted-version compare: negative if a<b, 0 if equal, positive if a>b. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Pick the newest release strictly newer than `currentVersion`, or null.
 * Releases missing an .apk asset or its .sha256 sidecar are ignored.
 */
export function parseLatestRelease(
  releases: unknown,
  currentVersion: string,
  repo: string,
): UpdateInfo | null {
  if (!Array.isArray(releases)) return null;
  const prefix = `https://github.com/${repo}/releases/download/`;
  let best: UpdateInfo | null = null;
  for (const raw of releases as ReleaseLike[]) {
    if (!raw || raw.draft || raw.prerelease) continue;
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(raw.tag_name || '');
    if (!m) continue;
    const version = `${m[1]}.${m[2]}.${m[3]}`;
    if (compareVersions(version, currentVersion) <= 0) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    const assets = Array.isArray(raw.assets) ? raw.assets : [];
    const apk = assets.find((a) => a && a.name && a.name.toLowerCase().endsWith('.apk'));
    const sha = assets.find(
      (a) => a && a.name && a.name.toLowerCase().endsWith('.apk.sha256'),
    );
    if (!apk || !sha) continue;
    if (
      !apk.browser_download_url.startsWith(prefix) ||
      !sha.browser_download_url.startsWith(prefix)
    ) {
      continue;
    }
    best = {
      version,
      tag: raw.tag_name,
      apkUrl: apk.browser_download_url,
      apkSize: apk.size || 0,
      sha256Url: sha.browser_download_url,
      sha256: '',
      notes: raw.body || '',
      publishedAt: raw.published_at || '',
    };
  }
  return best;
}

/** Extract the first 64-char hex digest from a sha256sum sidecar text. */
export function parseSha256Sidecar(text: string): string | null {
  const m = /([0-9a-fA-F]{64})/.exec(text || '');
  return m ? m[1].toLowerCase() : null;
}

/**
 * The update feed (Cloudflare Worker) is the primary update source since
 * 1.0.3. It resolves the newest GitHub release server-side and serves a
 * small JSON manifest plus the APK itself from one stable origin, because
 * from the phone both api.github.com reachability and WebView fetches of
 * release-asset URLs (302 → CDN response without CORS headers) proved
 * unreliable. The manifest is validated as strictly as the release list:
 * strict semver, a full 64-hex SHA-256, and a download URL that must stay
 * under the feed's own /dl/ prefix.
 */
export const UPDATE_FEED_ORIGIN =
  'https://isecure-update.farzad-sholeh.workers.dev';

interface UpdateFeedLike {
  version?: unknown;
  tag?: unknown;
  sizeBytes?: unknown;
  sha256?: unknown;
  downloadUrl?: unknown;
}

export function parseUpdateFeed(
  feed: unknown,
  currentVersion: string,
): UpdateInfo | null {
  if (!feed || typeof feed !== 'object') return null;
  const f = feed as UpdateFeedLike;
  const version = typeof f.version === 'string' ? f.version : '';
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  if (compareVersions(version, currentVersion) <= 0) return null;
  const sha256 = typeof f.sha256 === 'string' ? f.sha256.toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const apkUrl = typeof f.downloadUrl === 'string' ? f.downloadUrl : '';
  if (!apkUrl.startsWith(`${UPDATE_FEED_ORIGIN}/dl/`)) return null;
  return {
    version,
    tag: typeof f.tag === 'string' ? f.tag : `v${version}`,
    apkUrl,
    apkSize: typeof f.sizeBytes === 'number' ? f.sizeBytes : 0,
    sha256Url: '',
    sha256,
    notes: '',
    publishedAt: '',
  };
}
