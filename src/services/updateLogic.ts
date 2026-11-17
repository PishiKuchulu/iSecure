/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure update-check logic (no Capacitor imports, unit-testable).
 * The update feed is the only update source (see parseUpdateFeed below);
 * the legacy GitHub-release-list parser was removed in 1.0.5 (AUD-009) —
 * it had no production callers left and its two trust models side by side
 * invited mistakes.
 */

export interface UpdateInfo {
  version: string;
  tag: string;
  apkUrl: string;
  apkSize: number;
  /** Expected SHA-256 of the APK, provided inline by the update feed. */
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
    sha256,
    notes: '',
    publishedAt: '',
  };
}
