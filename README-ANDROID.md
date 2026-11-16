# iSecure — Android (Capacitor) Build Notes

Version 1.0.0 (versionCode 1) · package `com.isecure.app` · minSdk 23 · targetSdk 35

## What this is

The iSecure web app (originally uploaded as "PishiSecure") (React 19 + TypeScript + Vite) packaged as a native
Android app with Capacitor 7.6.10. The original uploaded web source is
untouched; this is a derivative copy. The stale pre-fix `AUDIT_REPORTS/`
folder from the upload was removed from this copy (it described an older
snapshot and no longer applies).

## Changes made for Android

1. **Capacitor shell** — `capacitor.config.ts` (appId `com.isecure.app`,
   appName `iSecure`, webDir `dist`), Android platform generated and
   synced. Only permission in the manifest: `INTERNET`.
2. **Native vault storage** — new `src/services/vaultStorage.ts`: on native,
   the AES-256-GCM encrypted vault envelope is stored as a file in the
   app-private data directory (`vault/pishisecure_vault_v2.json`, Filesystem
   plugin, `Directory.Data`) instead of WebView localStorage — removing the
   ~5 MB ceiling. On web, behaviour is unchanged (localStorage). A vault
   previously stored by a WebView-only build is migrated to the file on
   first launch. This layer only ever handles the encrypted envelope.
3. **Async storage load in `src/App.tsx`** — the vault gate now loads the
   envelope asynchronously (loading splash first), and all persist / setup /
   reset paths go through the storage adapter (writes remain queue-serialized).
4. **Lock on background** — via the Capacitor App plugin: when the app leaves
   the foreground while unlocked, the vault locks immediately and decrypted
   state is cleared (in addition to the existing inactivity auto-lock).
5. **Hardware back button** — other tab → Dashboard; Dashboard → lock vault;
   locked/setup screens → exit app.
6. **FLAG_SECURE** — `MainActivity` sets `WindowManager.LayoutParams.FLAG_SECURE`:
   screenshots, screen recording and recent-apps thumbnails are blocked at
   OS level. It is always on in the Android build (the in-app
   screenshot-protection toggle is a web-only watermark and is superseded).
7. **Identity** — package.json name `pishisecure`, version `1.0.0`;
   Android `versionName "1.0.0"`, `versionCode 1`.

## Verification performed (2026-11-14, in the build sandbox)

- `bun run test` — 8/8 unit tests pass.
- `bun run lint` (`tsc --noEmit`, strict) — clean.
- `bun run build` (Vite production) — succeeds.
- `./gradlew assembleDebug` — **BUILD SUCCESSFUL** (141 tasks).
- APK inspected with `aapt`: package `com.isecure.app`, versionName
  1.0.0, minSdk 23, targetSdk 35, label `iSecure`, only the INTERNET
  permission; both Capacitor plugins (App, Filesystem) registered;
  web assets bundled under `assets/public`.
- APK SHA-256: `29dbd4bffc299918a33828c0a42f74b6901861e18f8c74dcfd09fe687c9739c2`
  (debug build, ~4.3 MB, signed with the standard Android debug key).

## How to rebuild

Requirements: Node/Bun, JDK **21** (Capacitor 7.6 modules target Java 21 —
JDK 17 is not enough), Android SDK platform 35 + build-tools 35.

```bash
bun install
bun run build
./node_modules/.bin/cap sync android
cd android && ./gradlew assembleDebug   # or assembleRelease with your keystore
```

Note: `android/local.properties` in this copy points at the sandbox SDK path;
Android Studio / your machine will regenerate it — delete it if it conflicts.

## Known limitations (v1.0.0)

- **Not yet tested on a physical device.** First-launch behaviour, WebView
  rendering and the storage migration need an on-device pass.
- **Google Drive backup inside the Android app is not yet usable**: Firebase
  `signInWithPopup` does not work inside a WebView (Google blocks OAuth in
  embedded WebViews), so Drive sign-in will fail in the APK until it is
  replaced with a native / Custom-Tab sign-in flow. Local encrypted
  export/import (`.pishivault.json`) works and is the backup path on Android
  for now. Drive backup in the web build is unaffected.
- **Debug signing only.** A release build needs your own keystore
  (signing config + `assembleRelease` / AAB for Play Store).
- **Default Capacitor launcher icon** — a branded icon/splash is still to do.
- **No biometric unlock yet** — the next native step (Android Keystore +
  BiometricPrompt wrapping the session key), together with native Drive auth.
- The unused web dependencies (`@google/genai`, `express`, `dotenv`) are
  still in package.json, inherited from the AI Studio template; they are not
  bundled into the app (verified: not imported by any source file) and can be
  removed in a cleanup pass.

## Rename to iSecure (2026-11-16)

At the owner's order the app was renamed from PishiSecure to **iSecure**:
display name and all user-visible branding (11 locales, web title, Android
label), Capacitor `appName`, and the Android applicationId / namespace
(`com.isecure.app`, MainActivity moved to `com/isecure/app`).

Intentionally NOT renamed, for data compatibility: internal storage keys
(`pishisecure_vault_v2`, `pishisecure_settings_v1`), the on-device vault
file name, and the Google Drive backup file prefix (`pishisecure-backup-`).
These are invisible to users and keeping them means existing vaults and
Drive backups remain readable.

Repository: https://github.com/PishiKuchulu/iSecure (created empty and
private). This source is committed in the local git repository only —
**not pushed** — until the owner says otherwise.

## Forensic-audit fixes (2026-11-16)

Fixes for the verified preliminary findings P-01..P-04 of the external
forensic audit checkpoint (audited commit 973d421), plus its validator
probe. All changes verified: unit tests 10/10 (2 new regression tests),
`tsc --noEmit` clean, Vite build + Capacitor sync OK, `assembleDebug`
BUILD SUCCESSFUL.

- **P-01** — `auditVault` (src/utils.ts) counted reused passwords in a
  plain `{}` keyed by password, so a password equal to an
  Object.prototype member name (`__proto__`, `constructor`, `toString`,
  ...) crashed Dashboard/Security rendering with a TypeError. Now uses a
  `Map`. Regression test covers the inherited-name passwords.
- **Validator** — `isValidEncryptedEnvelope` (src/crypto.ts) accepted any
  PBKDF2 iteration count >= 1000, including 1e100 / Infinity / 1000.5, so
  a crafted envelope could hang key derivation at unlock. Now requires an
  integer in [1000, 10,000,000]. Regression test included.
- **P-02** — persistence failures were invisible: CRUD handlers discarded
  the save promise and the stored-envelope ref was updated before the
  write landed. The ref is now updated only after a successful write, and
  a failed save raises a dismissible red banner ("latest changes are NOT
  stored yet"); the next successful save clears it.
- **P-03** — a corrupt/unreadable vault was indistinguishable from "no
  vault" and led to setup, which overwrote the stored bytes.
  `loadVault()` now returns ok / empty / corrupt; the corrupt state shows
  a recovery screen offering a raw (still encrypted) download of the
  stored bytes, or a two-step confirmed erase before setup is offered.
  Web load path verified dynamically for all three states.
- **P-04** — clipboard auto-clear lived in component timers that died on
  unmount, cleared unconditionally (clobbering newer clipboard content),
  and copy errors were swallowed while the UI showed "Copied". New
  module-level `src/services/clipboard.ts`: the clear timer survives
  unmount, clearing only happens when the clipboard still holds the value
  this app copied (when readable), copy success/failure is reported
  honestly in both Vault and Generator views, and locking the vault also
  clears an app-copied secret.
