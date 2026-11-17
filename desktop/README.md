# iSecure — Kotlin Multiplatform edition (desktop + Android)

One shared codebase (decided 2026-11-17: «از اول مشترک بساز») that will
replace the Capacitor app on Android and provide the Windows/Linux
desktop edition. The Capacitor app stays the shipped product until
this edition reaches feature parity and passes an on-device test.

## Layout

- `src/commonMain` — everything shared: vault model, pure logic
  (generator, audit, entropy — ported 1:1 from `src/utils.ts` and
  verified against TS reference values), generated locale tables
  (11 languages × 138 keys, from `src/locales.ts`), the vault session
  state holder, and the full Compose UI (setup/unlock, vault list +
  editor, generator, audit, trash, settings, RTL for fa/ar).
- `src/jvmMain` — JVM-family code shared by both targets (wired via
  `srcDir` in build.gradle.kts): the vault crypto (PBKDF2-HMAC-SHA256
  hand-rolled over UTF-8 + AES-256-GCM) and file stores.
- `src/desktopMain` — desktop entry point, per-OS data dir, AWT
  clipboard, Swing file dialogs.
- `src/androidMain` — MainActivity (FLAG_SECURE, like the Capacitor
  build), SharedPreferences settings, Android clipboard, launcher
  icons. The vault store points at `filesDir/vault/
  pishisecure_vault_v2.json` — the exact file the Capacitor build
  uses — so an in-place upgrade keeps the user's vault.

## Compatibility invariant

The vault envelope is byte-compatible with the web/TypeScript
implementation, proven both directions by `vectors/` + the
`CryptoVectorTest` suite (TS envelope opened by Kotlin and vice
versa, Persian master secret, production 600k iterations).

Locales are generated, never hand-edited:

```
bun run desktop/tools/generate_locales.ts   # from the project root
```

## Build (this sandbox)

```
JAVA_HOME=~/workspace/.jdk21 ANDROID_HOME=~/workspace/tools/android-sdk \
JAVA_TOOL_OPTIONS="-Djava.net.preferIPv4Stack=true" \
GRADLE_USER_HOME=/home/hatch/.gradle-pishi \
./gradlew desktopTest assembleDebug compileKotlinDesktop
```

## Status (2026-11-17)

- Shared build green: 13/13 tests (3 crypto vectors + 10 logic),
  desktop target compiles, Android debug APK assembles
  (com.isecure.app, 0.1.0 dev version).
- UI is functional, not yet visually on par with the web design.

## Remaining (next phases)

- Android ports: native Drive sign-in (Authorization API code from
  the Capacitor plugins), biometric unlock, Anvex-style updater,
  SAF file picker for backup import/export.
- Desktop: Drive via system browser + loopback OAuth (needs a
  desktop OAuth client in the GCP project), updater, CI packaging
  (Deb on Ubuntu, Msi/Exe on Windows) on desktop tags.
- Parity checklist pass + Farzad's on-device test before this
  edition can ship as the Android 2.0.0.
