/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VaultEntry } from './types';

/**
 * Cryptographically secure uniform random integer in [0, max) using rejection sampling.
 */
export function getSecureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError('max must be a positive integer');
  }
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('CSPRNG (crypto.getRandomValues) is unavailable.');
  }

  const range = 0x1_0000_0000;
  const limit = Math.floor(range / max) * max;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    cryptoApi.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);

  return value % max;
}

/**
 * Generates a cryptographically random UUID or ID string.
 */
export function generateSecureId(prefix = 'item'): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  const bytes = new Uint8Array(12);
  cryptoApi.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${hex}`;
}

/**
 * Calculates repetition-aware information entropy of a string (in bits)
 * using Unicode codepoints rather than UTF-16 code units.
 */
export function calculateEntropy(pwd: string): number {
  if (!pwd) return 0;

  const chars = Array.from(pwd);
  const length = chars.length;
  if (length === 0) return 0;

  let poolSize = 0;
  if (/[a-z]/.test(pwd)) poolSize += 26;
  if (/[A-Z]/.test(pwd)) poolSize += 26;
  if (/[0-9]/.test(pwd)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(pwd)) poolSize += 33;

  if (poolSize === 0) return 0;

  const uniqueRatio = new Set(chars).size / length;
  // Penalize repeated identical characters (e.g. "aaaaaaaaaaaa" or repeated emoji)
  const effectiveLength = length * (0.25 + 0.75 * uniqueRatio);
  const entropy = effectiveLength * (Math.log(poolSize) / Math.log(2));
  return Math.round(entropy);
}

/**
 * Assesses a password and returns strength category.
 */
export function getPasswordStrength(pwd: string): 'weak' | 'fair' | 'good' | 'excellent' {
  const length = Array.from(pwd).length;
  const entropy = calculateEntropy(pwd);
  if (entropy < 40 || length < 8) return 'weak';
  if (entropy < 60 || length < 12) return 'fair';
  if (entropy < 80 || length < 16) return 'good';
  return 'excellent';
}

/**
 * Audits active vault entries. Excludes passwordless entries (such as Secure Notes)
 * from weak/reused checks. Outputs Security Score clamped to [15, 100].
 */
export function auditVault(entries: VaultEntry[]) {
  const activeEntries = entries.filter(e => !e.isTrash);

  const weakIds: string[] = [];
  const reusedIds: string[] = [];
  const oldIds: string[] = [];

  // Find weak passwords (only for entries that have a password and are not passwordless notes)
  activeEntries.forEach(entry => {
    const pwd = entry.password || '';
    if (!pwd || entry.entryType === 'note') return;
    if (getPasswordStrength(pwd) === 'weak') {
      weakIds.push(entry.id);
    }
  });

  // Find reused passwords. A Map is used (not a plain object) so that
  // passwords colliding with Object.prototype member names such as
  // "__proto__", "constructor" or "toString" are treated as ordinary
  // values instead of crashing on inherited properties.
  const passwordCounts = new Map<string, string[]>();
  activeEntries.forEach(entry => {
    const pwd = entry.password || '';
    if (pwd && entry.entryType !== 'note') {
      const ids = passwordCounts.get(pwd);
      if (ids) {
        ids.push(entry.id);
      } else {
        passwordCounts.set(pwd, [entry.id]);
      }
    }
  });

  passwordCounts.forEach(ids => {
    if (ids.length > 1) {
      reusedIds.push(...ids);
    }
  });

  // Find old passwords (> 90 days unmodified)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  activeEntries.forEach(entry => {
    const modDate = new Date(entry.modifiedDate);
    if (!Number.isNaN(modDate.getTime()) && modDate < ninetyDaysAgo) {
      oldIds.push(entry.id);
    }
  });

  if (activeEntries.length === 0) {
    return { weakIds, reusedIds: [], oldIds, score: 100 };
  }

  // Start with 100%. Deduct 20% per weak, 10% per reused, 5% per old; clamp [15, 100].
  const uniqueReused = Array.from(new Set(reusedIds));
  let calculatedScore = 100;

  calculatedScore -= weakIds.length * 20;
  calculatedScore -= uniqueReused.length * 10;
  calculatedScore -= oldIds.length * 5;

  const finalScore = Math.max(15, Math.min(100, calculatedScore));

  return {
    weakIds,
    reusedIds: uniqueReused,
    oldIds,
    score: finalScore,
  };
}

/**
 * Dynamically computes a suggested Master Password's entropy and validation checklist.
 */
export function validateMasterPassword(pwd: string) {
  const length = Array.from(pwd).length;
  return {
    hasMinLength: length >= 12,
    hasUpper: /[A-Z]/.test(pwd),
    hasLower: /[a-z]/.test(pwd),
    hasNumber: /[0-9]/.test(pwd),
    hasSymbol: /[^a-zA-Z0-9]/.test(pwd),
    entropy: calculateEntropy(pwd),
  };
}

/**
 * Validates and sanitizes an external entry URL, allowing only http: and https: schemes.
 */
export function getSafeExternalUrl(rawUrl?: string): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Purges trashed entries older than `retentionDays` (default 30 days).
 */
export function purgeExpiredTrashEntries(entries: VaultEntry[], retentionDays = 30): VaultEntry[] {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return entries.filter(entry => {
    if (!entry.isTrash) return true;
    if (!entry.deletedAt) return true;
    const deletedMs = new Date(entry.deletedAt).getTime();
    if (Number.isNaN(deletedMs)) return true;
    return deletedMs > cutoffMs;
  });
}
