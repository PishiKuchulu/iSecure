/**
 * Reverse-direction proof: opens envelope-kotlin.json (written by the
 * Kotlin desktop test) with the REAL TypeScript implementation and
 * compares the payload against payload.json. Run from the project root
 * AFTER the Kotlin desktop tests:
 *
 *   bun run desktop/vectors/verify_kotlin_envelope.ts
 */
import { decryptVaultEnvelope, type EncryptedVaultEnvelope } from '../../src/crypto';

const dir = new URL('.', import.meta.url).pathname;
const meta = (await Bun.file(`${dir}meta.json`).json()) as { masterSecret: string };
const envelope = (await Bun.file(`${dir}envelope-kotlin.json`).json()) as EncryptedVaultEnvelope;
const expected = await Bun.file(`${dir}payload.json`).json();

/** Key-order-insensitive canonical form for a structural comparison. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

const { payload } = await decryptVaultEnvelope(envelope, meta.masterSecret);
if (canonical(payload) !== canonical(expected)) {
  console.error('FAIL: Kotlin envelope decrypted by TS differs from payload.json');
  process.exit(1);
}
console.log('PASS: TypeScript opens the Kotlin-written envelope, payload identical.');
