/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VaultEntry } from './types';

export interface VaultPayload {
  entries: VaultEntry[];
  customCategories: string[];
  lastBackupTime: string | null;
}

export interface EncryptedVaultEnvelope {
  version: 2;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // Base64
  iv: string; // Base64 (12-byte GCM nonce)
  ciphertext: string; // Base64 (AES-256-GCM ciphertext + 128-bit auth tag)
}

export const DEFAULT_KDF_ITERATIONS = 600_000;

function getWebCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API (crypto.subtle) is unavailable in this environment.');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return view;
}

export function generateSalt(byteLength = 16): Uint8Array<ArrayBuffer> {
  const cryptoApi = getWebCrypto();
  const buffer = new ArrayBuffer(byteLength);
  const salt = new Uint8Array(buffer);
  cryptoApi.getRandomValues(salt);
  return salt;
}

export async function deriveAesKey(
  masterPassword: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number = DEFAULT_KDF_ITERATIONS
): Promise<CryptoKey> {
  const cryptoApi = getWebCrypto();
  const encoded = new TextEncoder().encode(masterPassword);
  const baseKey = await cryptoApi.subtle.importKey(
    'raw',
    encoded,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptVaultPayload(
  payload: VaultPayload,
  key: CryptoKey,
  saltBase64: string,
  iterations: number = DEFAULT_KDF_ITERATIONS
): Promise<EncryptedVaultEnvelope> {
  const cryptoApi = getWebCrypto();
  const ivBuffer = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuffer);
  cryptoApi.getRandomValues(iv);

  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encryptedBuffer = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes
  );

  return {
    version: 2,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: saltBase64,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
}

export async function decryptVaultEnvelope(
  envelope: EncryptedVaultEnvelope,
  masterPassword: string
): Promise<{ payload: VaultPayload; key: CryptoKey }> {
  const cryptoApi = getWebCrypto();
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  const key = await deriveAesKey(masterPassword, salt, envelope.iterations);
  const decryptedBuffer = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const decodedJson = new TextDecoder().decode(decryptedBuffer);
  const parsed: unknown = JSON.parse(decodedJson);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Decrypted vault payload is malformed.');
  }

  const obj = parsed as Partial<VaultPayload>;
  return {
    key,
    payload: {
      entries: Array.isArray(obj.entries) ? obj.entries : [],
      customCategories: Array.isArray(obj.customCategories)
        ? obj.customCategories.filter((c): c is string => typeof c === 'string')
        : [],
      lastBackupTime: typeof obj.lastBackupTime === 'string' ? obj.lastBackupTime : null,
    },
  };
}

export function isValidEncryptedEnvelope(value: unknown): value is EncryptedVaultEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 2 &&
    v.kdf === 'PBKDF2-SHA256' &&
    typeof v.iterations === 'number' &&
    v.iterations >= 1000 &&
    typeof v.salt === 'string' &&
    v.salt.length > 0 &&
    typeof v.iv === 'string' &&
    v.iv.length > 0 &&
    typeof v.ciphertext === 'string' &&
    v.ciphertext.length > 0
  );
}
