/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-app updater for the Android (Capacitor) build, modelled on Anvex:
 * check for a newer release → download the APK inside the app →
 * MANDATORY SHA-256 check → same-signer certificate check → hand off to
 * the system installer. Web builds have no updater (hidden there).
 *
 * Since 1.0.3 the source is the iSecure update feed (a Cloudflare Worker
 * that resolves GitHub releases server-side), not the GitHub API: from
 * the phone, api.github.com proved unreliable and WebView fetches of
 * release-asset URLs die on the 302 redirect to a CDN response without
 * CORS headers (the "Failed to fetch" failure). The APK download itself
 * runs in native code (ApkInstaller.download), which is not bound by
 * WebView CORS at all.
 */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import ApkInstaller from './apkInstaller';
import {
  UPDATE_FEED_ORIGIN,
  parseUpdateFeed,
  type UpdateInfo,
} from './updateLogic';

export type { UpdateInfo };

export type CheckResult =
  | { kind: 'available'; info: UpdateInfo; current: string }
  | { kind: 'up-to-date'; current: string };

let cached: { at: number; result: CheckResult } | null = null;
const CACHE_MS = 10 * 60 * 1000;

export function isUpdaterSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export async function getCurrentVersion(): Promise<string> {
  try {
    const info = await App.getInfo();
    return info.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function checkForUpdate(force = false): Promise<CheckResult> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.result;
  }
  const current = await getCurrentVersion();
  const res = await fetch(`${UPDATE_FEED_ORIGIN}/update.json`);
  if (!res.ok) {
    throw new Error(`Update check failed (feed ${res.status}).`);
  }
  const json: unknown = await res.json();
  const info = parseUpdateFeed(json, current);
  const result: CheckResult = info
    ? { kind: 'available', info, current }
    : { kind: 'up-to-date', current };
  cached = { at: Date.now(), result };
  return result;
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256OfCachedFile(fileName: string): Promise<string> {
  const { data } = await Filesystem.readFile({
    path: fileName,
    directory: Directory.Cache,
  });
  const base64 =
    typeof data === 'string' ? data : await blobToBase64(data as Blob);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    base64ToBytes(base64) as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const out = String(reader.result || '');
      resolve(out.slice(out.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function deleteCachedFile(fileName: string): Promise<void> {
  try {
    await Filesystem.deleteFile({
      path: fileName,
      directory: Directory.Cache,
    });
  } catch {
    /* best effort cleanup */
  }
}

/**
 * Download the update APK into the app cache with the native downloader,
 * verify its SHA-256 against the digest from the update feed (mandatory —
 * a missing or mismatching checksum aborts and deletes the file), then
 * verify the APK is signed with the same certificate as the installed
 * app. Returns the absolute APK path.
 */
export async function downloadAndVerifyUpdate(
  info: UpdateInfo,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const expected = (info.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error('Update checksum is missing — refusing to install.');
  }

  const fileName = `isecure-update-${info.version}.apk`;
  const listener = await ApkInstaller.addListener('downloadProgress', (p) => {
    if (p.url === info.apkUrl && p.contentLength > 0 && onProgress) {
      onProgress(
        Math.min(100, Math.floor((p.bytes / p.contentLength) * 100)),
      );
    }
  });
  let apkPath: string;
  try {
    const result = await ApkInstaller.download({
      url: info.apkUrl,
      fileName,
      // AUD-010: cap the download at ~4x the manifest's declared size so
      // a broken feed cannot fill the cache before the hash check runs.
      maxBytes: info.apkSize > 0 ? info.apkSize * 4 : undefined,
    });
    if (!result.path) throw new Error('Update download failed.');
    apkPath = result.path;
  } finally {
    await listener.remove();
  }

  const actual = await sha256OfCachedFile(fileName);
  if (actual !== expected) {
    await deleteCachedFile(fileName);
    throw new Error('Update checksum mismatch — download discarded.');
  }

  const { matches } = await ApkInstaller.verifySigner({ path: apkPath });
  if (!matches) {
    await deleteCachedFile(fileName);
    throw new Error('Update is signed with a different key — refused.');
  }
  return apkPath;
}

/** Hand the verified APK to the Android system installer. */
export async function installUpdate(apkPath: string): Promise<void> {
  await ApkInstaller.install({ path: apkPath });
}
