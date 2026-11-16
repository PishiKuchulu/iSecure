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
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { EncryptedVaultEnvelope, isValidEncryptedEnvelope } from '../crypto';

const LOCAL_STORAGE_KEY_VAULT = 'pishisecure_vault_v2';
const VAULT_DIR = 'vault';
const VAULT_FILE = 'pishisecure_vault_v2.json';
const VAULT_PATH = `${VAULT_DIR}/${VAULT_FILE}`;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

function parseEnvelope(raw: string | null): EncryptedVaultEnvelope | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidEncryptedEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readLocalStorageEnvelope(): EncryptedVaultEnvelope | null {
  try {
    return parseEnvelope(localStorage.getItem(LOCAL_STORAGE_KEY_VAULT));
  } catch {
    return null;
  }
}

export async function loadVaultEnvelope(): Promise<EncryptedVaultEnvelope | null> {
  if (!isNativePlatform()) {
    return readLocalStorageEnvelope();
  }

  try {
    const result = await Filesystem.readFile({
      path: VAULT_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const fromFile = parseEnvelope(typeof result.data === 'string' ? result.data : null);
    if (fromFile) return fromFile;
  } catch {
    // File does not exist yet (first run) or is unreadable: fall through to
    // the localStorage migration path below.
  }

  // One-time migration from a previous WebView-storage build.
  const legacy = readLocalStorageEnvelope();
  if (legacy) {
    try {
      await saveVaultEnvelope(legacy);
    } catch {
      // Keep the localStorage copy as the source of truth if migration fails.
      return legacy;
    }
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY_VAULT);
    } catch {
      // ignore storage errors
    }
  }
  return legacy;
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

  await Filesystem.writeFile({
    path: VAULT_PATH,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: raw,
    recursive: true,
  });

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
}
