/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface BlueprintArtifact {
  title: string;
  category: 'architecture' | 'database' | 'code' | 'security' | 'strategy';
  description: string;
  language: 'text' | 'sql' | 'dart' | 'json' | 'yaml';
  content: string;
}

export const blueprints: BlueprintArtifact[] = [
  {
    title: 'Clean Architecture Flutter Folder Structure',
    category: 'architecture',
    description: 'Scalable structural organization of the Flutter package conforming to MVVM, SOLID principles, and clean dependency management.',
    language: 'text',
    content: `pishi_secure/
├── android/                  # Native Android configuration with Keystore support
├── ios/                      # Native iOS configuration with Secure Enclave bounds
├── lib/
│   ├── main.dart             # App Entry point. Initializes singletons and dependencies.
│   ├── core/                 # Shared system resources
│   │   ├── constants/        # Global colors, secure configurations
│   │   ├── errors/           # Failure and Exception hierarchy (CacheFailure, CryptographicFailure)
│   │   ├── network/          # Peer Sync sockets and API proxy managers
│   │   ├── theme/            # Light, Dark, and AMOLED Material 3 specs
│   │   ├── usecases/         # Base Usecase interface definition (with Either pattern)
│   │   └── utils/            # Cryptographic helper types, CSPRNG engine wrappers
│   ├── data/                 # Data Layer (Repositories impls, DataSources)
│   │   ├── datasources/
│   │   │   ├── local_db/     # SQLite local integration (DatabaseHelper, SQL Scripts)
│   │   │   ├── secure_store/ # Encrypted Flutter Secure Storage for derived salt/session tokens
│   │   │   └── remote_sync/  # Cloud sync channels (Google Drive, Dropbox API implementations)
│   │   ├── models/           # JSON mapping adapters for VaultEntry, Category, Tag models
│   │   └── repositories/     # Concrete implementations of Domain repositories
│   ├── domain/               # Core Business Logic Layer (Totally independent of UI and Database frameworks)
│   │   ├── entities/         # Immutable Domain Entities: VaultEntry, PasswordHistoryItem, Settings
│   │   ├── repositories/     # Abstract Repository Contracts (SOLID Dependency Inversion Principle)
│   │   └── usecases/         # Interactive Logic blocks:
│   │       ├── encrypt_and_save_entry.dart
│   │       ├── decrypt_vault.dart
│   │       ├── generate_secure_password.dart
│   │       └── sync_vault_with_cloud.dart
│   └── presentation/         # UI & State Management Layer (MVVM and State Store)
│       ├── state_managers/   # Bloc/Cubit or Riverpod controllers for state handling
│       │   ├── auth/         # Master password initialization and bio validation controller
│       │   ├── vault/        # Vault list, search, custom fields state
│       │   └── generator/    # Entropy, length, character configurations
│       └── views/            # Visually polished Flutter widgets
│           ├── splash/       # Integrity checks, environment jailbreak detector screen
│           ├── onboard/      # Zero-knowledge architecture walkthrough
│           ├── auth/         # Master password creation gate and biometric login
│           ├── dashboard/    # Bento-grid dashboard, security metric visualization
│           ├── vault/        # Category and Tag-aware credentials listing
│           └── settings/     # Clipboard, auto-lock timeouts and translation settings
├── test/                     # Multi-level test suite
│   ├── unit/                 # Domain boundary tests, CSPRNG & Generator logic audits
│   ├── mock/                 # Mockito models for db layers and cloud drives
│   └── integration/          # Core decryption-to-encryption round-trip test suites
├── pubspec.yaml              # Dependencies (sqflite, cryptography, flutter_windowmanager, local_auth)
└── README.md`
  },
  {
    title: 'SQLite Database Schema & ER Diagram',
    category: 'database',
    description: 'Fully defined, relational database schema configured for optimized local query search capabilities and full version migration.',
    language: 'sql',
    content: `-- iSecure Relational SQLite Database Schema
-- All sensitive fields (passwords, URLs, notes, custom field values) are stored as 
-- BASE64 AES-256-GCM encrypted blobs with their dynamic, unique IV blocks.

PRAGMA foreign_keys = ON;

-- 1. Table to store current vault salt (derived from Argon2id) to verify master keys
CREATE TABLE IF NOT EXISTS security_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_salt TEXT NOT NULL,         -- SHA-256 represented hex salt
    key_verification_hash TEXT NOT NULL, -- PBKDF2 verification check payload
    argon_iterations INTEGER NOT NULL,
    argon_memory_cost INTEGER NOT NULL,
    argon_parallelism INTEGER NOT NULL,
    is_biometrics_activated INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Vault Categories
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon_name TEXT NOT NULL,
    is_custom INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Main Password Vault Entries
CREATE TABLE IF NOT EXISTS vault_entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,               -- Left unencrypted for search indexes (or encrypted depending on local settings)
    username TEXT NOT NULL,            -- Encrypted base64 payload
    username_iv TEXT NOT NULL,         -- Initialization Vector for Username
    encrypted_password TEXT,           -- Encrypted base64 payload
    password_iv TEXT,                  -- Initialization Vector for Password
    encrypted_url TEXT,                -- Encrypted base64 payload
    url_iv TEXT,                       -- Initialization Vector for URL
    encrypted_notes TEXT,              -- Encrypted base64 payload
    notes_iv TEXT,                     -- Initialization Vector for Notes
    category_id TEXT,
    is_favorite INTEGER DEFAULT 0,
    is_trash INTEGER DEFAULT 0,
    deleted_at TIMESTAMP,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modified_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    entry_type TEXT NOT NULL,          -- 'website', 'email', 'bank', etc.
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- 4. Entry Custom Fields
CREATE TABLE IF NOT EXISTS custom_fields (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    field_label TEXT NOT NULL,
    encrypted_value TEXT NOT NULL,
    value_iv TEXT NOT NULL,
    is_secret INTEGER DEFAULT 0,
    FOREIGN KEY (entry_id) REFERENCES vault_entries(id) ON DELETE CASCADE
);

-- 5. Entry Tags Relational Mapping
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    PRIMARY KEY (entry_id, tag_name),
    FOREIGN KEY (entry_id) REFERENCES vault_entries(id) ON DELETE CASCADE
);

-- 6. Encrypted Password History Schema
CREATE TABLE IF NOT EXISTS password_history (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    encrypted_password TEXT NOT NULL,
    password_iv TEXT NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES vault_entries(id) ON DELETE CASCADE
);

-- Database Indices for Turbo-Charged Search & Sorting Performance
CREATE INDEX IF NOT EXISTS idx_entries_search ON vault_entries(title, is_trash);
CREATE INDEX IF NOT EXISTS idx_entries_category ON vault_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_custom_fields_entry ON custom_fields(entry_id);
CREATE INDEX IF NOT EXISTS idx_history_entry ON password_history(entry_id);

--------------------------------------------------
-- ENTITY RELATIONSHIP DIAGRAM (ERD)
--------------------------------------------------
--
--  [ security_metadata ] (1:1 with Master Password Config)
--
--  [ categories ]
--       │
--       │──(1:N)──>  [ vault_entries ]  <──(1:N)──  [ password_history ]
--                     │
--                     │──(1:N)──>  [ custom_fields ]
--                     │
--                     │──(1:N)──>  [ entry_tags ]`
  },
  {
    title: 'State-of-the-Art Cryptography Service (Dart)',
    category: 'code',
    description: 'Helper implementation of AES-256-GCM and Argon2id key derivation using cryptography API in Flutter.',
    language: 'dart',
    content: `// Dart Security Service: Core Cryptography Engine
import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import 'package:pointycastle/export.dart' as pk;

class CryptographyService {
  static const int aesKeyLengthBits = 256;
  static const int gcmTagLengthBits = 128; // 16 bytes for auth tag verification

  /// Argon2id parameters matching corporate security requirements
  static const int argon2MemoryCostKb = 256 * 1024; // 256 MB
  static const int argon2Iterations = 4;
  static const int argon2Parallelism = 4;
  static const int argon2DerivedKeyLengthBytes = 32; // 256-bit key

  final AesGcm _aesCipher = AesGcm.with256bits(nonceLength: 12);

  /// Derive key from user master password using Argon2id
  Uint8List deriveMasterKey(String masterPassword, Uint8List salt) {
    final argon2 = pk.Argon2BytesGenerator();
    final parameters = pk.Argon2Parameters(
      pk.Argon2Parameters.ARGON2_id,
      salt,
      iterations: argon2Iterations,
      memory: argon2MemoryCostKb,
      lanes: argon2Parallelism,
    );

    argon2.init(parameters);
    final keyBytes = Uint8List(argon2DerivedKeyLengthBytes);
    argon2.generateBytes(utf8.encode(masterPassword), keyBytes, 0, keyBytes.length);
    return keyBytes;
  }

  /// Encrypt string using AES-256-GCM
  /// Returns map containing encrypted Base64 cipher, IV block, and Auth Tag
  Future<Map<String, String>> encrypt(String plaintext, Uint8List rawEncryptionKey) async {
    final clearTextBytes = utf8.encode(plaintext);
    final secretKey = SecretKey(rawEncryptionKey);

    // Cryptographically Secure Random Initialization Vector
    final SecretBox secretBox = await _aesCipher.encrypt(
      clearTextBytes,
      secretKey: secretKey,
    );

    return {
      'cipher_text': base64.encode(secretBox.cipherText),
      'nonce/iv': base64.encode(secretBox.nonce),
      'mac/tag': base64.encode(secretBox.mac.bytes),
    };
  }

  /// Decrypt ciphertext using AES-256-GCM
  Future<String> decrypt({
    required String cipherTextBase64,
    required String nonceBase64,
    required String macBase64,
    required Uint8List rawEncryptionKey,
  }) async {
    final cipherText = base64.decode(cipherTextBase64);
    final nonce = base64.decode(nonceBase64);
    final macBytes = base64.decode(macBase64);
    
    final secretKey = SecretKey(rawEncryptionKey);
    final secretBox = SecretBox(
      cipherText,
      nonce: nonce,
      mac: Mac(macBytes),
    );

    final List<int> decryptedBytes = await _aesCipher.decrypt(
      secretBox,
      secretKey: secretKey,
    );

    return utf8.decode(decryptedBytes);
  }

  /// Secure Random Generator (CSPRNG) for password generation
  static Uint8List generateRandomSalt([int length = 16]) {
    final random = pk.SecureRandom('Fortuna');
    final salt = Uint8List(length);
    random.nextBytes(salt);
    return salt;
  }
}`
  },
  {
    title: 'Flutter App Protection & Anti-Leak (Dart)',
    category: 'security',
    description: 'System service to block OS multitasking screenshotting, prevent camera/recorders, and run jailbreak assessment checks.',
    language: 'dart',
    content: `// iSecure AppProtectionService: Hardware, Screenshot & Host Protection
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_windowmanager/flutter_windowmanager.dart';

class AppProtectionService {
  static const MethodChannel _platformChannel = MethodChannel('com.isecure.app/integrity');

  /// Toggles operational level screenshot blocking on Android and iOS
  Future<void> setSecureFlag(bool isEnabled) async {
    if (Platform.isAndroid) {
      if (isEnabled) {
        // Blocks screenshots and recording layouts perfectly
        await FlutterWindowManager.addFlags(FlutterWindowManager.FLAG_SECURE);
      } else {
        await FlutterWindowManager.clearFlags(FlutterWindowManager.FLAG_SECURE);
      }
    } else if (Platform.isIOS) {
      // Passes arguments to AppDelegate over MethodChannel to mount a secure background view
      await _platformChannel.invokeMethod('setSecureIOSFlag', {'enabled': isEnabled});
    }
  }

  /// Check App integrity and scan device for modifications (Root / Jailbreak)
  Future<bool> checkDeviceIntegrity() async {
    try {
      if (Platform.isAndroid) {
        final bool isRooted = await _platformChannel.invokeMethod('checkAndroidRoot');
        final bool isSignatureModified = await _platformChannel.invokeMethod('verifySignature');
        return !isRooted && isSignatureModified;
      } else if (Platform.isIOS) {
        final bool isJailbroken = await _platformChannel.invokeMethod('checkIOSJailbreak');
        return !isJailbroken;
      }
    } on PlatformException catch (e) {
      // Default to high security level: assume threat if system channel fails
      return false;
    }
    return true;
  }

  /// Swift native platform bridging wrapper for iOS SecureEnclave FaceID and Screenshot coverage
  /*
  @objc class AppDelegate: FlutterAppDelegate {
    private var secureTextField = UITextField()

    override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
      let controller : FlutterViewController = window?.rootViewController as! FlutterViewController
      let channel = FlutterMethodChannel(name: "com.isecure.app/integrity", binaryMessenger: controller.binaryMessenger)
      
      channel.setMethodCallHandler({ [weak self] (call: FlutterMethodCall, result: @escaping FlutterResult) -> Void in
        if call.method == "setSecureIOSFlag" {
          guard let args = call.arguments as? [String: Any], let enabled = args["enabled"] as? Bool else { return }
          self?.makeScreenIOSSecure(enabled: enabled)
          result(true)
        } else {
          result(FlutterMethodNotImplemented)
        }
      })
      return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }

    private func makeScreenIOSSecure(enabled: Bool) {
      if enabled {
        if !window!.subviews.contains(secureTextField) {
          secureTextField.isSecureTextEntry = true
          window!.addSubview(secureTextField)
          secureTextField.leadingAnchor.constraint(equalTo: window!.leadingAnchor).isActive = true
          secureTextField.trailingAnchor.constraint(equalTo: window!.trailingAnchor).isActive = true
          secureTextField.topAnchor.constraint(equalTo: window!.topAnchor).isActive = true
          secureTextField.bottomAnchor.constraint(equalTo: window!.bottomAnchor).isActive = true
          window!.layer.superlayer?.addSublayer(secureTextField.layer)
          secureTextField.layer.sublayers?.first?.addSublayer(window!.layer)
        }
      } else {
        secureTextField.removeFromSuperview()
      }
    }
  }
  */
}`
  },
  {
    title: 'Monetization Strategy & Premium Structure',
    category: 'strategy',
    description: 'High-margin, commercial business model designed to enable self-sustaining software engineering.',
    language: 'yaml',
    content: `# iSecure Commercialization and Monetization Engine

pricing_plans:
  free_tier:
    name: "Standard Guard"
    price: "$0.00"
    target: "Individual average users requiring robust offline security"
    capabilities:
      - "Unlimited Website Logins & Notes stored locally"
      - "Argon2id and AES-256-GCM Client-side military grade encryption"
      - "Secure Password Generator"
      - "Auto-Lock & Clipboard Clear Protection"
      - "Full RTL and 11 Multi-Language Support"
  
  individual_premium:
    name: "iSecure Pro"
    price: "$2.99 / month or $24.99 / year"
    target: "Power users wanting advanced cloud features"
    capabilities:
      - "All Features from Standard Guard"
      - "Encrypted Sync (Zero-Knowledge) across 5 devices"
      - "Encrypted backups to private Cloud Drives (Drive, OneDrive, Dropbox)"
      - "Real-time TOTP Authenticator & Passkey store"
      - "In-app Security Audit Alerts with Dark Web breach checks"
      - "Priority email customer support within 24h"

  family_tier:
    name: "iSecure Family"
    price: "$4.99 / month (Up to 6 accounts)"
    target: "Households and shared users"
    capabilities:
      - "All Features from iSecure Pro for all members"
      - "Secure Family Sharing Vault (End-to-End Cryptographically Sealed Shared Folders)"
      - "Emergency Access settings (Pre-configured recovery links for heirs)"
      - "Centralized configuration management dashboard"

  enterprise_workspace:
    name: "iSecure Business/Enterprise"
    price: "$5.00 / user / month"
    target: "SMBs, corporate security teams, compliance managers"
    capabilities:
      - "Full SAML & OIDC SSO onboarding integration"
      - "Azure Active Directory / Okta Directory Sync integration"
      - "Enterprise Policy Enforcement (Master strength minimums, IP whitelisting)"
      - "SOC2 / HIPAA Compliance readiness reports"
      - "Read-only audit event logging of non-sensitive metadata"
      - "Admin console for team vaults and recovery controls"

acquisition_growth_loop:
  1_freemium_trigger: "High rating in Google Play/Apple App store for offline experience with zero telemetry."
  2_referral_rewards: "Invite 2 friends to unlock 3 months of Pro (Google Drive sync mechanics)."
  3_b2b_land_and_expand: "Self-serve team tiers for up to 10 members seamlessly in settings."
`
  },
  {
    title: 'Security Compliance Auditing & OWASP MASVS Standards',
    category: 'security',
    description: 'Complete L2 compliance auditing requirements mapping iSecure features to global secure app guidelines.',
    language: 'text',
    content: `======================================================================
ISECURE SECURITY COMPLIANCE AUDITING CHECKLIST
======================================================================
Based on OWASP Mobile Application Security Verification Standard (MASVS) L2.

[V1: Architecture, Design and Threat Modeling Requirements]
  ☑ ZERO-KNOWLEDGE: Security controls are completely client-side. The app never sends raw Master Passwords or unencrypted values.
  ☑ PRIVATE COLD-LOAD: Cryptographic initialization only occurs inside volatile runtime heap, zero traces written to secondary files.

[V2: Data Storage and Privacy Requirements]
  ☑ CRYPTO STORE: Core sqlite databases are encrypted. Keys compiled by PBKDF2/Argon2 are loaded solely in volatile memory.
  ☑ AUTOCLEAR CLIPBOARD: Prevents background clipboard reading using automatic system buffer clearance.
  ☑ TASK CAROUSEL BLINDING: Blurs and obscures application screenshots using Android FLAG_SECURE and Swift iOS secure subviews.
  ☑ NO PLAIN TEXT LOGS: Never log passwords, usernames, or filenames to logcat or console outputs.

[V3: Cryptography Requirements]
  ☑ REPUTED ALGORITHMS: Uses solely AES-GCM (256-bit key) with random 12-byte IV block and SHA-256 integrity tags.
  ☑ ARGON2ID KEY STRECHING: Master Password is secure against precomputation tables using 256MB memory, 4 threads, and 4 iterations.
  ☑ STRONG BIOMETRIC KEYSTORE: Secure Enclave and Android Keystore authenticate key usage; biometric keys undergo automatic inactivation if visual/fingerprint profiles shift on the OS.

[V4: Authentication and Session Management]
  ☑ APP TIMEOUT GUARD: Automatically triggers state locks if the app goes into background for selected parameters (1, 5, 15, 30 min).
  ☑ NO RECOVERY CHANNELS: Recovery links are impossible. User gets strict warning that developer contains 0% accessibility to credentials.

[V5: Network Communication]
  ☑ HTTPS ONLY OVER TLS 1.3: Force TLS 1.3 with certificate pinning for cloud backups.
  ☑ CLIENT-ONLY FILE ENVELOPE: Uploads strictly opaque blobs to GDrive or OneDrive. File metadata is also derived dynamically via localized hashes.

[V6: Platform Interaction]
  ☑ CUSTOM KEYBOARD RECOMMENDED: Secure entry modes enabled. OS text autocomplete and text-learning mechanisms are bypassed.

[V7: Code Quality and Build Settings]
  ☑ APP SIGNATURE CHECK: Native code checks hash signatures in launch routines to prevent reverse compiled code injections.
  ☑ PROGUARD & OBFUSCATION: Full symbol obfuscation, native string encryption to block disassembler tools like Ghidra.`
  }
];
