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
