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
 *
 * Crash-window recovery (AUD-015): saves stage the complete new envelope in
 * a `.tmp` file and rename it over the vault file. The Filesystem plugin's
 * rename is NOT atomic on Android — it deletes the destination before
 * moving the tmp file into place — so a process death during a save can
 * leave the vault path absent (or the old file already deleted) with the
 * only complete copy sitting in `.tmp`. The load path therefore consults
 * the staged tmp file whenever the main file is missing, unreadable or
 * corrupt: a valid tmp envelope is the newest vault state and is promoted
 * back to the vault path. "Empty" is only ever reported when neither the
 * vault file nor any staged tmp bytes exist.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { EncryptedVaultEnvelope, isValidEncryptedEnvelope } from '../crypto';

const LOCAL_STORAGE_KEY_VAULT = 'pishisecure_vault_v2';
const VAULT_DIR = 'vault';
const VAULT_FILE = 'pishisecure_vault_v2.json';
const VAULT_PATH = `${VAULT_DIR}/${VAULT_FILE}`;
const TMP_PATH = `${VAULT_PATH}.tmp`;

export type VaultLoadResult =
  | { status: 'ok'; envelope: EncryptedVaultEnvelope }
  | { status: 'empty' }
  | { status: 'corrupt' };

type RawVaultData =
  | { kind: 'absent' }
  | { kind: 'present'; raw: string }
  | { kind: 'unreadable' };

/**
 * The filesystem operations the native store relies on, abstracted so the
 * load/save state machine can be exercised in tests with a fake. The
 * production implementation delegates to the Capacitor Filesystem plugin.
 */
export interface VaultFileSystem {
  exists(path: string): Promise<boolean>;
  /** File contents as text; throws when the file is absent or unreadable. */
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Deletes a file; throws when it does not exist. */
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

const capacitorFs: VaultFileSystem = {
  async exists(path) {
    try {
      await Filesystem.stat({ path, directory: Directory.Data });
      return true;
    } catch {
      return false;
    }
  },
  async read(path) {
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    if (typeof result.data !== 'string') {
      throw new Error('Vault file did not read back as text');
    }
    return result.data;
  },
  async write(path, data) {
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data,
      recursive: true,
    });
  },
  async rename(from, to) {
    await Filesystem.rename({
      from,
      to,
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  },
  async remove(path) {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  },
  async mkdir(path) {
    await Filesystem.mkdir({
      path,
      directory: Directory.Data,
      recursive: true,
    });
  },
};

/** Optional dependency overrides, used by tests. */
export interface VaultStorageDeps {
  fs?: VaultFileSystem;
  native?: boolean;
}

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
    if (typeof localStorage === 'undefined') return { kind: 'absent' };
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_VAULT);
    return raw === null ? { kind: 'absent' } : { kind: 'present', raw };
  } catch {
    return { kind: 'unreadable' };
  }
}

async function readRaw(fs: VaultFileSystem, path: string): Promise<RawVaultData> {
  if (!(await fs.exists(path))) return { kind: 'absent' };
  try {
    return { kind: 'present', raw: await fs.read(path) };
  } catch {
    return { kind: 'unreadable' };
  }
}

/**
 * Rename the staged tmp file over the vault path. The plugin rename can
 * refuse to replace an existing destination, so on failure the destination
 * is dropped and the rename retried — the tmp file is complete at this
 * point, and the load path recovers from the tmp file if the process dies
 * anywhere inside this sequence (AUD-015).
 */
async function renameOverVault(fs: VaultFileSystem): Promise<void> {
  try {
    await fs.rename(TMP_PATH, VAULT_PATH);
  } catch {
    try {
      await fs.remove(VAULT_PATH);
    } catch {
      // File already absent.
    }
    await fs.rename(TMP_PATH, VAULT_PATH);
  }
}

/**
 * If a staged tmp envelope exists and is valid, promote it to the vault
 * path (best effort) and return it. Returns null when there is no valid
 * tmp envelope to recover.
 */
async function recoverFromTmp(
  fs: VaultFileSystem,
): Promise<{ status: 'ok'; envelope: EncryptedVaultEnvelope } | null> {
  const tmp = await readRaw(fs, TMP_PATH);
  if (tmp.kind !== 'present') return null;
  const classified = classifyRaw(tmp.raw);
  if (classified.status !== 'ok') return null;
  try {
    await renameOverVault(fs);
  } catch {
    // The envelope is in hand; the next successful save rewrites the file.
  }
  return classified;
}

export async function loadVault(deps: VaultStorageDeps = {}): Promise<VaultLoadResult> {
  const fs = deps.fs ?? capacitorFs;
  const native = deps.native ?? isNativePlatform();

  if (!native) {
    const stored = readLocalStorageRaw();
    if (stored.kind === 'absent') return { status: 'empty' };
    if (stored.kind === 'unreadable') return { status: 'corrupt' };
    return classifyRaw(stored.raw);
  }

  const fromFile = await readRaw(fs, VAULT_PATH);
  if (fromFile.kind === 'present') {
    const classified = classifyRaw(fromFile.raw);
    if (classified.status === 'ok') return classified;
    // The main file is corrupt, but a staged tmp envelope is a complete
    // newer vault state (AUD-015) — recover it before declaring corruption.
    const recovered = await recoverFromTmp(fs);
    return recovered ?? classified;
  }

  if (fromFile.kind === 'unreadable') {
    const recovered = await recoverFromTmp(fs);
    return recovered ?? { status: 'corrupt' };
  }

  // No vault file: a staged tmp file is the signature of a save that died
  // inside the plugin rename window (AUD-015). A valid tmp envelope is
  // recovered; invalid tmp bytes still count as an existing (corrupt)
  // vault, never as "empty".
  const tmpState = await readRaw(fs, TMP_PATH);
  if (tmpState.kind === 'present') {
    const recovered = await recoverFromTmp(fs);
    return recovered ?? { status: 'corrupt' };
  }

  // No vault bytes anywhere: fall back to the one-time migration path from
  // a previous WebView-storage build.
  const legacy = readLocalStorageRaw();
  if (legacy.kind === 'absent') return { status: 'empty' };
  if (legacy.kind === 'unreadable') return { status: 'corrupt' };
  const classified = classifyRaw(legacy.raw);
  if (classified.status !== 'ok') return classified;

  // Valid legacy vault: migrate it to the file, then drop the old copy.
  // If the migration write fails, the localStorage copy stays authoritative
  // and the vault still loads.
  try {
    await saveVaultEnvelope(classified.envelope, { fs, native });
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
export async function loadVaultEnvelope(
  deps: VaultStorageDeps = {},
): Promise<EncryptedVaultEnvelope | null> {
  const result = await loadVault(deps);
  return result.status === 'ok' ? result.envelope : null;
}

/**
 * Raw stored vault bytes for the corruption-recovery export. Returns the
 * exact stored string (still encrypted) so the user can keep a copy before
 * deciding to erase and start over. Falls back to the staged tmp bytes
 * when the vault file itself is gone (AUD-015 window).
 */
export async function readRawVaultData(
  deps: VaultStorageDeps = {},
): Promise<string | null> {
  const fs = deps.fs ?? capacitorFs;
  const native = deps.native ?? isNativePlatform();
  if (native) {
    const fromFile = await readRaw(fs, VAULT_PATH);
    if (fromFile.kind === 'present') return fromFile.raw;
    const fromTmp = await readRaw(fs, TMP_PATH);
    if (fromTmp.kind === 'present') return fromTmp.raw;
  }
  const stored = readLocalStorageRaw();
  return stored.kind === 'present' ? stored.raw : null;
}

export async function saveVaultEnvelope(
  envelope: EncryptedVaultEnvelope,
  deps: VaultStorageDeps = {},
): Promise<void> {
  const fs = deps.fs ?? capacitorFs;
  const native = deps.native ?? isNativePlatform();
  const raw = JSON.stringify(envelope);
  if (!native) {
    localStorage.setItem(LOCAL_STORAGE_KEY_VAULT, raw);
    return;
  }

  try {
    await fs.mkdir(VAULT_DIR);
  } catch {
    // Directory already exists.
  }

  // Atomic replace (AUD-007): write the complete envelope to a tmp file
  // first, then rename it over the vault file. The plugin rename is not
  // itself atomic on Android (AUD-015), but the load path recovers from
  // the staged tmp file if the process dies mid-rename, so at every
  // instant at least one complete envelope is recoverable.
  await fs.write(TMP_PATH, raw);
  await renameOverVault(fs);

  // The file is authoritative on native; drop any stale WebView copy.
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_VAULT);
  } catch {
    // ignore storage errors
  }
}

export async function deleteVaultEnvelope(
  deps: VaultStorageDeps = {},
): Promise<void> {
  const fs = deps.fs ?? capacitorFs;
  const native = deps.native ?? isNativePlatform();
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_VAULT);
  } catch {
    // ignore storage errors
  }

  if (!native) return;

  try {
    await fs.remove(VAULT_PATH);
  } catch {
    // File already absent.
  }
  try {
    await fs.remove(TMP_PATH);
  } catch {
    // No staged write pending.
  }
}
