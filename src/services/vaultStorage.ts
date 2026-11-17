/**
 * Vault envelope persistence.
 *
 * Web: localStorage (unchanged behaviour).
 * Native (Capacitor/Android): the encrypted envelope is stored as a file in
 * the app-private data directory via the Filesystem plugin, which removes
 * the ~5 MB localStorage ceiling and keeps the vault out of WebView storage.
 * The stored bytes are always the AES-256-GCM encrypted envelope — this layer
 * never sees plaintext or keys.
 *
 * A vault previously written to localStorage by a WebView-only build is
 * migrated to the file on first native launch.
 *
 * Load results distinguish three states (P-03): a readable vault, no vault
 * at all (first run), and a vault that EXISTS but cannot be read or parsed
 * (corrupt). Corruption must never be silently treated as "no vault",
 * because the setup flow would then overwrite the existing bytes.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { EncryptedVaultEnvelope, isValidEncryptedEnvelope } from '../crypto';

const LOCAL_STORAGE_KEY_VAULT = 'pishisecure_vault_v2';
const VAULT_DIR = 'vault';
const VAULT_FILE = 'pishisecure_vault_v2.json';
const VAULT_PATH = `${VAULT_DIR}/${VAULT_FILE}`;

export type VaultLoadResult =
  | { status: 'ok'; envelope: EncryptedVaultEnvelope }
  | { status: 'empty' }
  | { status: 'corrupt' };

type RawVaultData =
  | { kind: 'absent' }
  | { kind: 'present'; raw: string }
  | { kind: 'unreadable' };

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

function classifyRaw(raw: string): VaultLoadResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidEncryptedEnvelope(parsed)
      ? { status: 'ok', envelope: parsed }
      : { status: 'corrupt' };
  } catch {
    return { status: 'corrupt' };
  }
}

function readLocalStorageRaw(): RawVaultData {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_VAULT);
    return raw === null ? { kind: 'absent' } : { kind: 'present', raw };
  } catch {
    return { kind: 'unreadable' };
  }
}

async function nativeFileExists(): Promise<boolean> {
  try {
    await Filesystem.stat({ path: VAULT_PATH, directory: Directory.Data });
    return true;
  } catch {
    return false;
  }
}

async function readNativeRaw(): Promise<RawVaultData> {
  if (!(await nativeFileExists())) return { kind: 'absent' };
  try {
    const result = await Filesystem.readFile({
      path: VAULT_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return typeof result.data === 'string'
      ? { kind: 'present', raw: result.data }
      : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

export async function loadVault(): Promise<VaultLoadResult> {
  if (!isNativePlatform()) {
    const stored = readLocalStorageRaw();
    if (stored.kind === 'absent') return { status: 'empty' };
    if (stored.kind === 'unreadable') return { status: 'corrupt' };
    return classifyRaw(stored.raw);
  }

  const fromFile = await readNativeRaw();
  if (fromFile.kind === 'present') return classifyRaw(fromFile.raw);
  if (fromFile.kind === 'unreadable') return { status: 'corrupt' };

  // No vault file yet: fall back to the one-time migration path from a
  // previous WebView-storage build.
  const legacy = readLocalStorageRaw();
  if (legacy.kind === 'absent') return { status: 'empty' };
  if (legacy.kind === 'unreadable') return { status: 'corrupt' };
  const classified = classifyRaw(legacy.raw);
  if (classified.status !== 'ok') return classified;

  // Valid legacy vault: migrate it to the file, then drop the old copy.
  // If the migration write fails, the localStorage copy stays authoritative
  // and the vault still loads.
  try {
    await saveVaultEnvelope(classified.envelope);
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY_VAULT);
    } catch {
      // ignore storage errors
    }
  } catch {
    // Keep the localStorage copy as the source of truth.
  }
  return classified;
}

/** Backwards-compatible helper: envelope when readable, otherwise null. */
export async function loadVaultEnvelope(): Promise<EncryptedVaultEnvelope | null> {
  const result = await loadVault();
  return result.status === 'ok' ? result.envelope : null;
}

/**
 * Raw stored vault bytes for the corruption-recovery export. Returns the
 * exact stored string (still encrypted) so the user can keep a copy before
 * deciding to erase and start over.
 */
export async function readRawVaultData(): Promise<string | null> {
  if (isNativePlatform()) {
    const fromFile = await readNativeRaw();
    if (fromFile.kind === 'present') return fromFile.raw;
  }
  const stored = readLocalStorageRaw();
  return stored.kind === 'present' ? stored.raw : null;
}

export async function saveVaultEnvelope(envelope: EncryptedVaultEnvelope): Promise<void> {
  const raw = JSON.stringify(envelope);
  if (!isNativePlatform()) {
    localStorage.setItem(LOCAL_STORAGE_KEY_VAULT, raw);
    return;
  }

  try {
    await Filesystem.mkdir({
      path: VAULT_DIR,
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    // Directory already exists.
  }

  // Atomic replace (AUD-007): write the complete envelope to a tmp file
  // first, then rename it over the vault file. A same-directory rename is
  // atomic on Android, so a process kill at any point leaves either the
  // old or the new COMPLETE envelope — never a truncated one. This mirrors
  // the KMP edition's FileVaultStore (write-then-rename).
  const tmpPath = `${VAULT_PATH}.tmp`;
  await Filesystem.writeFile({
    path: tmpPath,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: raw,
    recursive: true,
  });
  try {
    await Filesystem.rename({
      from: tmpPath,
      to: VAULT_PATH,
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  } catch {
    // Some filesystems refuse to rename over an existing file. The tmp
    // file is fully written at this point, so dropping the old file and
    // renaming again is still crash-safe.
    try {
      await Filesystem.deleteFile({ path: VAULT_PATH, directory: Directory.Data });
    } catch {
      // File already absent.
    }
    await Filesystem.rename({
      from: tmpPath,
      to: VAULT_PATH,
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  }

  // The file is authoritative on native; drop any stale WebView copy.
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_VAULT);
  } catch {
    // ignore storage errors
  }
}

export async function deleteVaultEnvelope(): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_VAULT);
  } catch {
    // ignore storage errors
  }

  if (!isNativePlatform()) return;

  try {
    await Filesystem.deleteFile({
      path: VAULT_PATH,
      directory: Directory.Data,
    });
  } catch {
    // File already absent.
  }
  try {
    await Filesystem.deleteFile({
      path: `${VAULT_PATH}.tmp`,
      directory: Directory.Data,
    });
  } catch {
    // No staged write pending.
  }
}
