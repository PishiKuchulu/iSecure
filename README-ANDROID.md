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

## Branded icon + signed release (2026-11-16)

Launcher icon replaced with Farzad's approved artwork (shield, no key /
padlock / text / frame): all mipmap densities regenerated (legacy, round
and adaptive foreground), adaptive background color #02091B sampled from
the artwork, and all splash screens regenerated from the same artwork.
The leftover "PS" monogram in the loading screens became "iS".

Release signing is env-injected (`ISECURE_KEYSTORE_PATH`,
`ISECURE_KEYSTORE_PASSWORD`, `ISECURE_KEY_ALIAS`, `ISECURE_KEY_PASSWORD`;
see android/app/build.gradle) — the keystore is never committed. Local
signed build verified 2026-11-16: `assembleRelease` BUILD SUCCESSFUL,
apksigner cert SHA-256
f411316843add5339f1994f23c903b63b65a5cdd4e5d55d595bbe0bcbbd7439b
(the shared Anvex/MarbleMD release key, alias `marblemd`, RSA 3072, valid
to Oct 2056). Keystore SHA-256 of the .p12 file itself:
47db35b7beda1277763cf97c4f2e5f8582148a9cf7942f35a713e5d957c8b317.

CI: `.github/workflows/release.yml` builds the signed APK on every push
to main and publishes GitHub Release v1.0.0; the four ISECURE_* values
live in the repository's Actions secrets. The keystore is also backed up
in Farzad's Google Drive as `marblemd-release.p12` (MD5-verified upload,
2026-11-16).

## In-app updater (v1.0.1, 2026-11-16)

Anvex-style updater: Settings gains an "App Updates" card and a silent
check runs once per launch (banner when a newer release exists). Rules
ported from Anvex: the releases LIST is scanned for strict vX.Y.Z tags
(never /releases/latest); a `.sha256` sidecar asset is MANDATORY (the CI
workflow publishes one next to the APK); asset URLs must stay under this
repo's /releases/download/ prefix; the download (Filesystem.downloadFile
into the app cache) is SHA-256-verified, then the native ApkInstaller
plugin verifies the APK's signer certificate equals the installed app's
(fail-closed) before handing it to the system installer via FileProvider.
Manifest gained REQUEST_INSTALL_PACKAGES; when the unknown-apps install
permission is off, the plugin routes the user to its settings screen and
the UI offers Install again. Pure logic lives in
src/services/updateLogic.ts (unit-tested); version is now derived from
build.gradle by the workflow (tag v<versionName>, asset
iSecure-<versionName>-release.apk + .sha256).

## Native Google Drive sign-in (v1.0.2, 2026-11-17)

The Firebase `signInWithPopup` flow cannot run inside the Android
WebView: its auth handler escapes to Chrome and dies with "The requested
action is invalid" (hit on-device by Farzad on v1.0.1). On native,
`signInWithGoogleDrive()` now uses the local `GoogleDriveAuth` Capacitor
plugin (Google Identity Authorization API, play-services-auth 21.3.0) to
get an OAuth access token for the drive.file scope directly; the profile
comes from the userinfo endpoint; sign-out revokes the token. The Drive
REST layer and the in-memory-only token rule are unchanged, and the web
build keeps the popup flow. Prerequisite (done 2026-11-17): the Android
app is registered in the Firebase project (com.isecure.app, app id
1:430894955554:android:4ccf03f16b556b0948de7b) with the release cert
SHA-1 fingerprint, which creates the Android OAuth client the
Authorization API checks. Session-only by design: every app start begins
signed out until the user taps sign-in (same as web after a reload).

## Update feed, fingerprint unlock, accordion settings (v1.0.3, 2026-11-17)

Three changes, two of them driven by on-device failures of v1.0.1/1.0.2:

- **Updater source moved to a Cloudflare feed.** On-device, the update
  check worked but tapping Update failed with "Failed to fetch": the
  download path first fetched the release's .sha256 sidecar from the
  WebView, and GitHub asset URLs 302-redirect to
  release-assets.githubusercontent.com, whose response has no CORS
  headers, so the WebView killed the fetch (the native download never
  ran). The `isecure-update` Worker
  (https://isecure-update.farzad-sholeh.workers.dev) now resolves the
  newest GitHub release server-side: `/update.json` returns version,
  size and the sidecar's SHA-256 (validated strictly by
  `parseUpdateFeed`), and `/dl/<apk>` streams the APK as a direct 200.
  The in-app download itself also moved into native code
  (`ApkInstaller.download`, manual redirect following, progress events),
  so no part of the flow depends on WebView fetch semantics anymore.
  SHA-256 verification and the same-signer check are unchanged.
- **Fingerprint unlock.** New local `BiometricUnlock` plugin
  (androidx.biometric): the master secret is stored encrypted under an
  Android Keystore AES-256-GCM key bound to BIOMETRIC_STRONG with
  per-use authentication (CryptoObject), so the plaintext is released
  only inside a successful biometric prompt. Enabling it (Settings →
  App Timeout & Protections) requires typing the master secret once,
  which is verified against the vault before storing. The lock screen
  offers the prompt automatically once per lock episode plus a manual
  button; a stored secret that no longer opens the vault is wiped, and
  vault reset/erase clears it too. The secret never leaves the device.
- **Settings is an accordion.** Every settings card is now a collapsible
  section (theme open by default); the App Updates card renders bare
  inside its section. All controls keep their previous wiring.
