# Cross-implementation test vectors

The files in this directory are **synthetic test fixtures** that prove the
TypeScript and Kotlin vault implementations can open each other's
encrypted envelopes (see `generate_vectors.ts` and
`verify_kotlin_envelope.ts`).

The master secret recorded in `meta.json` is a **throwaway fixture value
invented for these vectors only**. It has never been used for a real vault
and protects nothing of value — the payload it decrypts is the synthetic
sample data in `payload.json`, visible in plain text right next to it.
Secret scanners flagging `meta.json` are seeing this documented fixture,
not a leaked credential.

Never reuse this fixture secret (or this pattern) for real data.
