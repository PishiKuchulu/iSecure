/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSalt,
  bytesToBase64,
  base64ToBytes,
  deriveAesKey,
  encryptVaultPayload,
  decryptVaultEnvelope,
  isValidEncryptedEnvelope,
  VaultPayload,
} from '../crypto';
import {
  getSecureRandomInt,
  generateSecureId,
  calculateEntropy,
  getPasswordStrength,
  auditVault,
  getSafeExternalUrl,
  purgeExpiredTrashEntries,
} from '../utils';
import { localesMap } from '../locales';
import { blueprints } from '../blueprints';
import { VaultEntry } from '../types';

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  const now = new Date().toISOString();
  return {
    id: generateSecureId('test'),
    title: 'Test Service',
    username: 'user@example.com',
    password: 'Strong!Password#2025$XYZ',
    tags: [],
    category: 'Work',
    isFavorite: false,
    isTrash: false,
    createdDate: now,
    modifiedDate: now,
    entryType: 'website',
    history: [],
    ...overrides,
  };
}

test('crypto: AES-256-GCM + PBKDF2 encrypt/decrypt round-trip succeeds and rejects wrong password or tampering', async () => {
  const saltBytes = generateSalt(16);
  const saltB64 = bytesToBase64(saltBytes);
  const iterations = 10_000; // fast test cost; production uses 600_000
  const masterPassword = 'Correct-Horse-Battery-Staple!99';

  const key = await deriveAesKey(masterPassword, saltBytes, iterations);
  const payload: VaultPayload = {
    entries: [makeEntry({ title: 'GitHub', password: 'SuperSecret!Value#123' })],
    customCategories: ['DevOps'],
    lastBackupTime: '2026-01-01T00:00:00.000Z',
  };

  const envelope = await encryptVaultPayload(payload, key, saltB64, iterations);
  assert.equal(isValidEncryptedEnvelope(envelope), true);
  assert.equal(envelope.version, 2);
  assert.equal(envelope.kdf, 'PBKDF2-SHA256');

  const decrypted = await decryptVaultEnvelope(envelope, masterPassword);
  assert.equal(decrypted.payload.entries.length, 1);
  assert.equal(decrypted.payload.entries[0].title, 'GitHub');
  assert.equal(decrypted.payload.entries[0].password, 'SuperSecret!Value#123');
  assert.deepEqual(decrypted.payload.customCategories, ['DevOps']);

  // Wrong password must reject
  await assert.rejects(decryptVaultEnvelope(envelope, 'Wrong-Password!123'));

  // Tampered ciphertext must reject due to GCM tag failure
  const rawCipher = base64ToBytes(envelope.ciphertext);
  rawCipher[0] ^= 0xff;
  const tamperedEnvelope = {
    ...envelope,
    ciphertext: bytesToBase64(rawCipher),
  };
  await assert.rejects(decryptVaultEnvelope(tamperedEnvelope, masterPassword));

  // Invalid envelope validation
  assert.equal(isValidEncryptedEnvelope(null), false);
  assert.equal(isValidEncryptedEnvelope({ version: 1 }), false);
});

test('utils: CSPRNG bounds and secure ID uniqueness', () => {
  for (let i = 0; i < 200; i++) {
    const val = getSecureRandomInt(37);
    assert.ok(val >= 0 && val < 37 && Number.isInteger(val));
  }
  assert.throws(() => getSecureRandomInt(0), RangeError);
  assert.throws(() => getSecureRandomInt(-5), RangeError);

  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    ids.add(generateSecureId('item'));
  }
  assert.equal(ids.size, 50);
});

test('utils: calculateEntropy handles Unicode codepoints and penalizes repetition', () => {
  const repeated = calculateEntropy('aaaaaaaaaaaa');
  const varied = calculateEntropy('aB3$kL9!pQ2@');
  assert.ok(varied > repeated * 1.5);

  // Astral emoji codepoints should count as 4 codepoints, not 8 UTF-16 units
  const emojiEntropy = calculateEntropy('🔐🔑🛡🗝');
  assert.ok(emojiEntropy > 0 && emojiEntropy < 30);
  assert.equal(getPasswordStrength('12345'), 'weak');
});

test('utils: auditVault ignores Secure Notes and empty passwords, detects weak/reused/old', () => {
  assert.equal(auditVault([]).score, 100);

  const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const noteEntry = makeEntry({
    id: 'note-1',
    entryType: 'note',
    password: '',
    notes: 'Recovery codes here',
  });
  const weakEntry = makeEntry({ id: 'weak-1', password: 'abc' });
  const reusedA = makeEntry({ id: 'reused-1', password: 'Shared!Password#12345' });
  const reusedB = makeEntry({ id: 'reused-2', password: 'Shared!Password#12345', modifiedDate: oldDate });

  const result = auditVault([noteEntry, weakEntry, reusedA, reusedB]);
  assert.deepEqual(result.weakIds, ['weak-1']);
  assert.deepEqual(result.reusedIds.sort(), ['reused-1', 'reused-2']);
  assert.deepEqual(result.oldIds, ['reused-2']);
  // 100 - 20 (1 weak) - 20 (2 reused) - 5 (1 old) = 55
  assert.equal(result.score, 55);
});

test('utils: auditVault treats Object.prototype member names as ordinary passwords (P-01 regression)', () => {
  // Before the fix these threw "passwordCounts[pwd].push is not a function"
  // because a plain {} inherits constructor/toString/__proto__ properties.
  for (const special of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    const single = auditVault([makeEntry({ id: `special-${special}`, password: special })]);
    assert.ok(Array.isArray(single.reusedIds));
  }
  const dupA = makeEntry({ id: 'dup-a', password: 'constructor' });
  const dupB = makeEntry({ id: 'dup-b', password: 'constructor' });
  const result = auditVault([dupA, dupB]);
  assert.deepEqual(result.reusedIds.sort(), ['dup-a', 'dup-b']);
});

test('crypto: isValidEncryptedEnvelope rejects non-integer or absurd PBKDF2 iteration counts', () => {
  const base = {
    version: 2,
    kdf: 'PBKDF2-SHA256',
    salt: 'c2FsdA==',
    iv: 'aXY=',
    ciphertext: 'Y2lwaGVy',
  };
  assert.equal(isValidEncryptedEnvelope({ ...base, iterations: 600_000 }), true);
  assert.equal(isValidEncryptedEnvelope({ ...base, iterations: 10_000_000 }), true);
  assert.equal(isValidEncryptedEnvelope({ ...base, iterations: 1000.5 }), false);
  assert.equal(isValidEncryptedEnvelope({ ...base, iterations: 1e100 }), false);
  assert.equal(isValidEncryptedEnvelope({ ...base, iterations: Infinity }), false);
  assert.equal(isValidEncryptedEnvelope({ ...base, iterations: 10_000_001 }), false);
  assert.equal(isValidEncryptedEnvelope({ ...base, iterations: 999 }), false);
});

test('utils: getSafeExternalUrl restricts dangerous schemes', () => {
  assert.equal(getSafeExternalUrl('https://example.com/login'), 'https://example.com/login');
  assert.equal(getSafeExternalUrl('http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(getSafeExternalUrl('javascript:alert(1)'), null);
  assert.equal(getSafeExternalUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(getSafeExternalUrl('not a url'), null);
});

test('utils: purgeExpiredTrashEntries enforces 30-day retention', () => {
  const recentTrash = makeEntry({
    id: 'trash-recent',
    isTrash: true,
    deletedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const expiredTrash = makeEntry({
    id: 'trash-old',
    isTrash: true,
    deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const active = makeEntry({ id: 'active-1', isTrash: false });

  const remaining = purgeExpiredTrashEntries([recentTrash, expiredTrash, active], 30);
  assert.deepEqual(remaining.map(e => e.id), ['trash-recent', 'active-1']);
});

test('locales: all 11 locales share identical key sets and proper RTL/script invariants', () => {
  const localeCodes = Object.keys(localesMap);
  assert.equal(localeCodes.length, 11);

  const enKeys = Object.keys(localesMap.en).sort();
  for (const code of localeCodes) {
    const keys = Object.keys(localesMap[code]).sort();
    assert.deepEqual(keys, enKeys, `Locale ${code} key mismatch`);
  }

  assert.equal(localesMap.fa.isRTL, true);
  assert.equal(localesMap.ar.isRTL, true);
  assert.equal(localesMap.en.isRTL, false);
  assert.ok(!/[\u0590-\u05FF]/.test(localesMap.ar.launch), 'Arabic launch string must not contain Hebrew');
});

test('blueprints: SQL schema comments out ERD block cleanly', () => {
  const sqlArtifact = blueprints.find(b => b.language === 'sql');
  assert.ok(sqlArtifact);
  const erdLines = sqlArtifact.content.split('\n').filter(line => line.includes('[ custom_fields ]') || line.includes('[ entry_tags ]'));
  assert.equal(erdLines.length, 2);
  erdLines.forEach(line => assert.ok(line.startsWith('--'), `Uncommented ERD line: ${line}`));
});
