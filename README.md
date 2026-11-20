# 🔐 iSecure

**A vault only you can open — zero-knowledge password manager for Android.**  
**گاوصندوقی که فقط خودت می‌تونی بازش کنی — مدیر رمز عبور دانش‌صفر برای اندروید.**

**[📥 Download the latest signed APK | دانلود آخرین APK امضاشده](https://github.com/PishiKuchulu/iSecure/releases)**

---

## 🇬🇧 English

**iSecure** is a zero-knowledge password manager. Your vault is encrypted on your device with **AES-256-GCM** (key derived from your master secret via PBKDF2) — the plaintext never leaves your phone, and no one but you can open it. Not even the developer. There is no vault account, no server of ours, no backdoor.

Originally a React 19 + TypeScript + Vite web app, packaged as a **native Android app with Capacitor** — with a Kotlin Multiplatform (KMP) desktop edition in `desktop/` that opens the same vault format.

### 🛡️ Security model

* 🔑 **Zero-knowledge by design** — the encrypted envelope is all that ever touches storage. Your master secret is never stored, never sent.
* 🧬 **Biometric unlock, done right** — the master secret is wrapped by an **Android Keystore AES-256-GCM key bound to biometric authentication (BIOMETRIC_STRONG preferred)** with per-use auth (CryptoObject). The plaintext is released only inside a successful fingerprint prompt, and is wiped on vault reset.
* 🚫 **OS-level screen protection** — `FLAG_SECURE` blocks screenshots, screen recording and recent-apps thumbnails. Secure by default, with a real in-app toggle.
* ⏱️ **Locks the moment you leave** — going to background instantly locks the vault and clears decrypted state, on top of the inactivity auto-lock.
* 📋 **Smart clipboard hygiene** — copied passwords auto-clear after a timeout; the clear only fires if the clipboard still holds *your* copied value, and locking the vault clears it too. Copy failures are reported honestly.
* 💾 **Atomic writes with crash recovery** — the vault is written to a temp file and renamed over the old one, and the load path recovers the staged copy if a crash lands mid-rename. A crash mid-save can never truncate your only copy.
* 🧯 **Corrupt-vault recovery** — a damaged vault is never silently overwritten: you get a recovery screen with a raw (still encrypted) download, or a two-step confirmed erase.
* 📵 **No Android Auto Backup leakage** — `allowBackup=false`. The only sanctioned backup paths are your own Google Drive and encrypted file export.
* 🧪 **Forensically audited** — two external audit waves (P-01..P-04 and AUD-001..013), all findings fixed and verified; CI gates every release on tests + type checks.

### ✨ Features

* 🗄️ **Native vault storage** — encrypted file in app-private storage (no WebView 5 MB ceiling), with automatic migration from older builds.
* 🎲 **Password generator** — strong, customizable secrets on demand.
* 📊 **Security dashboard** — spot weak and reused passwords at a glance.
* ☁️ **Google Drive backup (manual)** — native Google sign-in with the minimal `drive.file` scope; tokens live in memory only. Backups are manual and labeled as such — no pretend automation.
* 📦 **Encrypted file export/import** — your vault as a portable encrypted file, compatible across the Android and KMP desktop editions.
* 🔄 **Honest in-app updater** — native download, strict **SHA-256 verification + same-signer check**, size caps, and real error reporting (never a fake "up to date").
* 🎛️ **Clean accordion settings & themes** — everything one tap away.
* 🪶 **Tiny & minimal** — ~7 MB APK, and only three system permissions: `INTERNET`, biometric unlock, and `REQUEST_INSTALL_PACKAGES` for its own in-app updates.

### 📲 Install

1. Download `iSecure-<version>-release.apk` from [Releases](https://github.com/PishiKuchulu/iSecure/releases).
2. Install (Android 6.0+ / minSdk 23).
3. Set your master secret — and remember it: **there is no recovery email, because there is no server.** 🔑

Signing certificate SHA-256 (shared Anvex/MarbleMD release key):
`f411316843add5339f1994f23c903b63b65a5cdd4e5d55d595bbe0bcbbd7439b`

### 🛠️ Build from source

Requirements: Node/Bun, **JDK 21**, Android SDK 35 + build-tools 35.

```bash
bun install
bun run build
./node_modules/.bin/cap sync android
cd android && ./gradlew assembleDebug   # or assembleRelease with your keystore
```

Every push to `main` builds the signed APK in CI (tests + type check gated); a release is published whenever the version changes. 🤖

---

<div dir="rtl">

## 🇮🇷 فارسی

برنامه‌ی **iSecure** یک مدیر رمز عبور «دانش‌صفر» (Zero-Knowledge) است. گاوصندوق شما روی خود دستگاه با **AES-256-GCM** رمزنگاری می‌شود (کلید از رمز اصلی شما با PBKDF2 مشتق می‌شود) — متن رمزنگاری‌نشده هرگز از گوشی خارج نمی‌شود و هیچ‌کس جز شما نمی‌تواند آن را باز کند؛ حتی سازنده‌ی برنامه. بدون اکانت، بدون سرورِ سازنده، بدون درِ پشتی.

این پروژه در ابتدا یک وب‌اپ React 19 + TypeScript + Vite بود که با **Capacitor به اپ نیتیو اندروید** تبدیل شده — به‌همراه یک نسخه‌ی دسکتاپ Kotlin Multiplatform (KMP) در پوشه‌ی `desktop/` که همان فرمت گاوصندوق را باز می‌کند.

### 🛡️ مدل امنیتی

* 🔑 **دانش‌صفر از پایه** — فقط پاکتِ رمزنگاری‌شده روی حافظه ذخیره می‌شود. رمز اصلی هرگز ذخیره و هرگز ارسال نمی‌شود.
* 🧬 **باز شدن با اثر انگشت، به روش درست** — رمز اصلی با کلید **Android Keystore (AES-256-GCM مقید به احراز هویت بیومتریک، ترجیحاً BIOMETRIC_STRONG)** و احراز هویت per-use محافظت می‌شود؛ متن اصلی فقط داخل پرامپت موفق بیومتریک آزاد می‌شود و با ریست گاوصندوق پاک می‌گردد.
* 🚫 **محافظت صفحه در سطح سیستم‌عامل** — `FLAG_SECURE` جلوی اسکرین‌شات، ضبط صفحه و تصویر بندانگشتی برنامه‌های اخیر را می‌گیرد؛ پیش‌فرض روشن، با کلید واقعی داخل برنامه.
* ⏱️ **قفل فوری هنگام خروج** — به محض رفتن به پس‌زمینه، گاوصندوق قفل و حالت رمزگشایی‌شده پاک می‌شود؛ علاوه بر قفل خودکارِ بی‌تحرکی.
* 📋 **کلیپ‌بورد بهداشتی** — رمز کپی‌شده بعد از زمان مشخص خودکار پاک می‌شود؛ پاک‌سازی فقط وقتی انجام می‌شود که کلیپ‌بورد هنوز همان مقدارِ کپی‌شده‌ی برنامه را داشته باشد، و قفل شدن گاوصندوق هم آن را پاک می‌کند. خطای کپی صادقانه گزارش می‌شود.
* 💾 **نوشتن اتمیک با بازیابی هنگام کرش** — گاوصندوق اول در فایل موقت نوشته و سپس جایگزین می‌شود و اگر کرش دقیقاً وسط جایگزینی رخ دهد، موقع باز شدن همان نسخه‌ی موقت بازیابی می‌شود؛ کرش وسط ذخیره هرگز تنها نسخه‌ی شما را خراب نمی‌کند.
* 🧯 **بازیابی گاوصندوق خراب** — گاوصندوق آسیب‌دیده هرگز بی‌صدا بازنویسی نمی‌شود: صفحه‌ی بازیابی با دانلود خام (همچنان رمزنگاری‌شده) یا پاک‌سازی دومرحله‌ای با تأیید.
* 📵 **بدون نشت از Auto Backup اندروید** — `allowBackup=false`. تنها مسیرهای مجاز بکاپ: گوگل درایو خودتان و خروجی فایل رمزنگاری‌شده.
* 🧪 **ممیزی فارنزیک‌شده** — دو موج ممیزی خارجی (P-01..P-04 و AUD-001..013)؛ همه‌ی یافته‌ها رفع و راستی‌آزمایی شده‌اند و CI هر ریلیز را به تست و type-check گیت می‌کند.

### ✨ ویژگی‌ها

* 🗄️ **ذخیره‌سازی نیتیو گاوصندوق** — فایل رمزنگاری‌شده در حافظه‌ی خصوصی برنامه (بدون سقف ۵ مگابایتی WebView) با مهاجرت خودکار از نسخه‌های قدیمی.
* 🎲 **تولیدکننده‌ی رمز** — رمزهای قوی و قابل‌تنظیم در لحظه.
* 📊 **داشبورد امنیتی** — رمزهای ضعیف و تکراری را یک‌نگاهی پیدا کنید.
* ☁️ **بکاپ گوگل درایو (دستی)** — لاگین نیتیو گوگل با حداقل دسترسی `drive.file`؛ توکن فقط در حافظه (RAM) نگه داشته می‌شود. بکاپ‌ها دستی‌اند و صادقانه همین‌طور برچسب خورده‌اند — بدون اتوماسیونِ نمایشی.
* 📦 **خروجی/ورودی فایل رمزنگاری‌شده** — گاوصندوق شما به صورت یک فایل قابل‌حمل، سازگار بین نسخه‌ی اندروید و دسکتاپ KMP.
* 🔄 **آپدیتر داخلی صادق** — دانلود نیتیو، **بررسی دقیق SHA-256 + تطابق امضا**، سقف حجم، و گزارش خطای واقعی (هیچ‌وقت «به‌روز است»ِ دروغین نمی‌گوید).
* 🎛️ **تنظیمات آکاردئونی و تم‌ها** — همه‌چیز با یک ضربه در دسترس.
* 🪶 **سبک و حداقلی** — APK حدود ۷ مگابایت، و فقط سه مجوز سیستمی: `INTERNET`، باز شدن با اثر انگشت، و `REQUEST_INSTALL_PACKAGES` برای آپدیت داخلی خودش.

### 📲 نصب

۱. فایل `iSecure-<version>-release.apk` را از [Releases](https://github.com/PishiKuchulu/iSecure/releases) دانلود کنید.
۲. نصب کنید (اندروید ۶.۰ به بالا / minSdk 23).
۳. رمز اصلی‌تان را بسازید — و به خاطر بسپارید: **ایمیل بازیابی وجود ندارد، چون سروری وجود ندارد.** 🔑

### 🛠️ ساخت از سورس

پیش‌نیازها: Node/Bun، **JDK 21**، اندروید SDK 35 + build-tools 35.

```bash
bun install
bun run build
./node_modules/.bin/cap sync android
cd android && ./gradlew assembleDebug
```

هر push به `main` در CI، APK امضاشده را می‌سازد (گیت‌شده با تست و type-check) و با هر تغییر نسخه، یک ریلیز تازه در Releases منتشر می‌شود. 🤖

</div>

---

**Developed with ❤️ by Farzad Sholeh**
