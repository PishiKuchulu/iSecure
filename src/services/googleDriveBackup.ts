/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { EncryptedVaultEnvelope, isValidEncryptedEnvelope } from '../crypto';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const BACKUP_FILE_PREFIX = 'pishisecure-backup-';
const BACKUP_FILE_EXT = '.pishivault.json';

export interface DriveBackupFile {
  id: string;
  name: string;
  size?: string;
  modifiedTime?: string;
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach(scope => provider.addScope(scope));

// Strictly in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export function initDriveAuth(
  onAuthSuccess: (user: User, token: string) => void,
  onAuthFailure: () => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure();
    }
  });
}

export async function signInWithGoogleDrive(): Promise<{ user: User; accessToken: string }> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain a Google Drive access token from sign-in.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function signOutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  await signOut(auth);
}

export function getCachedDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearCachedDriveAccessToken(): void {
  cachedAccessToken = null;
}

async function handleDriveResponseError(res: Response): Promise<never> {
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('DRIVE_AUTH_EXPIRED');
  }
  let detail = `Google Drive request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) {
      detail = body.error.message;
    }
  } catch {
    // ignore JSON parse error
  }
  throw new Error(detail);
}

export async function listDriveBackups(accessToken: string): Promise<DriveBackupFile[]> {
  const query = "trashed = false and name contains 'pishisecure-backup'";
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&fields=${encodeURIComponent('files(id,name,size,modifiedTime)')}&spaces=drive`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    await handleDriveResponseError(res);
  }

  const data = (await res.json()) as { files?: DriveBackupFile[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function uploadEncryptedBackupToDrive(
  accessToken: string,
  envelope: EncryptedVaultEnvelope,
  existingFileId?: string,
  existingFileName?: string
): Promise<DriveBackupFile> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = existingFileName || `${BACKUP_FILE_PREFIX}${timestamp}${BACKUP_FILE_EXT}`;

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    description: 'iSecure AES-256-GCM Zero-Knowledge Encrypted Vault Backup',
  };

  const boundary = `pishisecure_boundary_${Date.now().toString(36)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(envelope, null, 2)}\r\n` +
    `--${boundary}--`;

  const isUpdate = Boolean(existingFileId);
  const endpoint = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId!)}?uploadType=multipart&fields=id,name,size,modifiedTime`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,modifiedTime`;

  const res = await fetch(endpoint, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    await handleDriveResponseError(res);
  }

  return (await res.json()) as DriveBackupFile;
}

export async function downloadDriveBackupEnvelope(
  accessToken: string,
  fileId: string
): Promise<EncryptedVaultEnvelope> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    await handleDriveResponseError(res);
  }

  const parsed: unknown = await res.json();
  if (!isValidEncryptedEnvelope(parsed)) {
    throw new Error('Downloaded Google Drive file is not a valid iSecure encrypted backup.');
  }
  return parsed;
}

export async function deleteDriveBackup(accessToken: string, fileId: string): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    await handleDriveResponseError(res);
  }
}
