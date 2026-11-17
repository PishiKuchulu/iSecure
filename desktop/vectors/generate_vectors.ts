/**
 * Generates the cross-implementation test vectors in this folder using
 * the REAL TypeScript vault crypto (src/crypto.ts) — run from the
 * project root:
 *
 *   bun run desktop/vectors/generate_vectors.ts
 *
 * The master secret deliberately mixes Persian and Latin characters and
 * the payload carries Persian content: PBKDF2 password encoding (UTF-8)
 * and JSON Unicode handling are exactly where a naive port diverges.
 */
import {
  bytesToBase64,
  decryptVaultEnvelope,
  deriveAesKey,
  encryptVaultPayload,
  generateSalt,
  type VaultPayload,
} from '../../src/crypto';

const masterSecret = 'رمز-اصلی-۱۴۰۳ Test!234';

const payload: VaultPayload = {
  entries: [
    {
      id: 'entry-vector-1',
      title: 'حساب بانک ملت',
      username: 'farzad.sh',
      password: 'S3cret!نمونه',
      url: 'https://bank.example.ir',
      notes: 'حساب اصلی حقوقی',
      tags: ['مالی'],
      category: 'bank',
      isFavorite: true,
      isTrash: false,
      createdDate: '2026-01-01T00:00:00.000Z',
      modifiedDate: '2026-11-17T00:00:00.000Z',
      entryType: 'bank',
      history: [
        {
          id: 'hist-1',
          password: 'OldPass!1',
          changedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      customFields: [
        { label: 'شماره شبا', value: 'IR120170000000123456789001', isSecret: false },
      ],
    },
    {
      id: 'entry-vector-2',
      title: 'یادداشت امن',
      username: '',
      notes: 'متن محرمانهٔ فارسی بدون رمز عبور',
      tags: [],
      category: 'note',
      isFavorite: false,
      isTrash: false,
      createdDate: '2026-02-01T00:00:00.000Z',
      modifiedDate: '2026-02-01T00:00:00.000Z',
      entryType: 'note',
      history: [],
    },
  ],
  customCategories: ['بانک'],
  lastBackupTime: '2026-11-17T00:00:00.000Z',
};

const salt = generateSalt();
const key = await deriveAesKey(masterSecret, salt);
const envelope = await encryptVaultPayload(payload, key, bytesToBase64(salt));

// Sanity: the TS implementation must open its own envelope.
const back = await decryptVaultEnvelope(envelope, masterSecret);
if (JSON.stringify(back.payload) !== JSON.stringify(payload)) {
  throw new Error('TS self-check failed: decrypted payload differs.');
}

const dir = new URL('.', import.meta.url).pathname;
await Bun.write(`${dir}envelope.json`, JSON.stringify(envelope, null, 2));
await Bun.write(`${dir}payload.json`, JSON.stringify(payload, null, 2));
await Bun.write(`${dir}meta.json`, JSON.stringify({ masterSecret }, null, 2));
console.log('vectors written:', Object.keys(envelope).join(','));
