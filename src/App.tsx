/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Key, Shield, AlertTriangle, Settings, Eye, EyeOff,
  LogOut, Layers, LayoutDashboard, Database, Lock, RotateCcw
} from 'lucide-react';
import { VaultEntry, UserSettings } from './types';
import { localesMap } from './locales';
import {
  validateMasterPassword,
  generateSecureId,
  purgeExpiredTrashEntries,
} from './utils';
import {
  DEFAULT_KDF_ITERATIONS,
  EncryptedVaultEnvelope,
  VaultPayload,
  bytesToBase64,
  decryptVaultEnvelope,
  deriveAesKey,
  encryptVaultPayload,
  generateSalt,
  isValidEncryptedEnvelope,
} from './crypto';
import type { User } from 'firebase/auth';
import {
  DriveBackupFile,
  clearCachedDriveAccessToken,
  deleteDriveBackup,
  downloadDriveBackupEnvelope,
  initDriveAuth,
  listDriveBackups,
  signInWithGoogleDrive,
  signOutGoogleDrive,
  uploadEncryptedBackupToDrive,
} from './services/googleDriveBackup';
import {
  deleteVaultEnvelope,
  isNativePlatform,
  loadVault,
  loadVaultEnvelope,
  readRawVaultData,
  saveVaultEnvelope,
} from './services/vaultStorage';
import { clearClipboardIfOurs } from './services/clipboard';
import { App as CapacitorApp } from '@capacitor/app';

const DashboardView = lazy(() => import('./components/DashboardView'));
const VaultView = lazy(() => import('./components/VaultView'));
const GeneratorView = lazy(() => import('./components/GeneratorView'));
const SecurityView = lazy(() => import('./components/SecurityView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const BlueprintsView = lazy(() => import('./components/BlueprintsView'));

const LOCAL_STORAGE_KEY_SETTINGS = 'pishisecure_settings_v1';

// Legacy plaintext keys from v1 to purge
const LEGACY_KEYS = [
  'secure_vault_passwords_v1',
  'secure_vault_master_configured',
  'secure_vault_settings_v1',
];

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  language: 'en',
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
  screenshotProtection: true,
  backupMode: 'manual',
};

const VALID_THEMES: ReadonlySet<UserSettings['theme']> = new Set(['light', 'dark', 'amoled', 'system']);
const VALID_AUTOLOCK = new Set([0, 1, 5, 15, 30]);
const VALID_CLIPBOARD = new Set([0, 15, 30, 60]);
const VALID_BACKUP_MODES: ReadonlySet<UserSettings['backupMode']> = new Set(['manual', 'auto', 'wifi']);

function parseValidatedSettings(raw: string | null): UserSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SETTINGS;
    const obj = parsed as Record<string, unknown>;

    const theme = typeof obj.theme === 'string' && VALID_THEMES.has(obj.theme as UserSettings['theme'])
      ? (obj.theme as UserSettings['theme'])
      : DEFAULT_SETTINGS.theme;

    const language = typeof obj.language === 'string' && Object.prototype.hasOwnProperty.call(localesMap, obj.language)
      ? obj.language
      : DEFAULT_SETTINGS.language;

    const autoLockMinutes = typeof obj.autoLockMinutes === 'number' && VALID_AUTOLOCK.has(obj.autoLockMinutes)
      ? obj.autoLockMinutes
      : DEFAULT_SETTINGS.autoLockMinutes;

    const clipboardClearSeconds = typeof obj.clipboardClearSeconds === 'number' && VALID_CLIPBOARD.has(obj.clipboardClearSeconds)
      ? obj.clipboardClearSeconds
      : DEFAULT_SETTINGS.clipboardClearSeconds;

    const screenshotProtection = typeof obj.screenshotProtection === 'boolean'
      ? obj.screenshotProtection
      : DEFAULT_SETTINGS.screenshotProtection;

    const backupMode = typeof obj.backupMode === 'string' && VALID_BACKUP_MODES.has(obj.backupMode as UserSettings['backupMode'])
      ? (obj.backupMode as UserSettings['backupMode'])
      : DEFAULT_SETTINGS.backupMode;

    return {
      theme,
      language,
      autoLockMinutes,
      clipboardClearSeconds,
      screenshotProtection,
      backupMode,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function SystemClock({ localeCode }: { localeCode: string }) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <span>{new Date(now).toLocaleString(localeCode)}</span>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  // Vault gate state
  const [isSetupState, setIsSetupState] = useState<boolean>(true);
  const [isStorageReady, setIsStorageReady] = useState<boolean>(false);
  // P-03: an existing-but-unreadable vault gets a recovery screen instead
  // of being silently treated as "no vault" (which led to setup).
  const [isStorageCorrupt, setIsStorageCorrupt] = useState<boolean>(false);
  const [confirmEraseCorrupt, setConfirmEraseCorrupt] = useState<boolean>(false);
  // P-02: user-visible persistence failure (null = last save succeeded).
  const [persistError, setPersistError] = useState<string | null>(null);
  const storedEnvelopeRef = useRef<EncryptedVaultEnvelope | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isDeriving, setIsDeriving] = useState(false);
  const [masterPasswordInput, setMasterPasswordInput] = useState('');
  const [masterPasswordConfirmInput, setMasterPasswordConfirmInput] = useState('');
  const [showMasterPw, setShowMasterPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [decryptError, setDecryptError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [showResetModal, setShowResetModal] = useState(false);

  // Decrypted volatile vault state (cleared when locked)
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [selectedEntryFromOutside, setSelectedEntryFromOutside] = useState<VaultEntry | null>(null);

  // Settings persisted outside vault (non-sensitive UI preferences)
  const [settings, setSettings] = useState<UserSettings>(() => {
    const existing = localStorage.getItem(LOCAL_STORAGE_KEY_SETTINGS);
    if (existing) return parseValidatedSettings(existing);
    const legacy = localStorage.getItem('secure_vault_settings_v1');
    return parseValidatedSettings(legacy);
  });

  // Volatile Google Drive Auth & Backup state (access token stored strictly in memory)
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [driveBackups, setDriveBackups] = useState<DriveBackupFile[]>([]);
  const [isDriveBusy, setIsDriveBusy] = useState(false);

  // Volatile cryptographic session references (never persisted)
  const sessionKeyRef = useRef<CryptoKey | null>(null);
  const sessionSaltRef = useRef<string>('');
  const sessionIterationsRef = useRef<number>(DEFAULT_KDF_ITERATIONS);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastActivityRef = useRef<number>(Date.now());

  const strings = localesMap[settings.language] || localesMap.en;
  const isRTL = strings.isRTL;

  // Initialize Firebase Auth listener for Google Drive access token
  useEffect(() => {
    const unsubscribe = initDriveAuth(
      (user, token) => {
        setDriveUser(user);
        setDriveAccessToken(token);
      },
      () => {
        setDriveUser(null);
        setDriveAccessToken(null);
        setDriveBackups([]);
      }
    );
    return () => unsubscribe();
  }, []);

  // Purge any legacy plaintext v1 storage keys on startup
  useEffect(() => {
    LEGACY_KEYS.forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore storage errors
      }
    });
  }, []);

  // Load the encrypted vault envelope from platform storage
  // (app-private file on Android, localStorage on web)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadVault();
      if (cancelled) return;
      if (result.status === 'ok') {
        storedEnvelopeRef.current = result.envelope;
        setIsSetupState(false);
      } else if (result.status === 'empty') {
        storedEnvelopeRef.current = null;
        setIsSetupState(true);
      } else {
        // 'corrupt': a vault exists but cannot be read/parsed. Never fall
        // into setup here — that would overwrite the stored bytes (P-03).
        storedEnvelopeRef.current = null;
        setIsSetupState(false);
        setIsStorageCorrupt(true);
      }
      setIsStorageReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Theme application (Light / Dark / AMOLED / System)
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = () => {
      root.classList.remove('dark');
      let targetTheme = settings.theme;
      if (targetTheme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        targetTheme = prefersDark ? 'dark' : 'light';
      }

      if (targetTheme === 'amoled') {
        root.classList.add('dark');
        root.style.backgroundColor = '#000000';
      } else if (targetTheme === 'dark') {
        root.classList.add('dark');
        root.style.backgroundColor = '#09090b';
      } else {
        root.style.backgroundColor = '#f9fafb';
      }
    };

    applyTheme();

    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', applyTheme);
      return () => mq.removeEventListener('change', applyTheme);
    }
    return undefined;
  }, [settings.theme]);

  const handleLockVault = useCallback(() => {
    // Locking also drops any secret this app left in the clipboard (P-04).
    void clearClipboardIfOurs();
    sessionKeyRef.current = null;
    sessionSaltRef.current = '';
    sessionIterationsRef.current = DEFAULT_KDF_ITERATIONS;
    setIsUnlocked(false);
    setEntries([]);
    setCustomCategories([]);
    setLastSyncTime('');
    setSelectedEntryFromOutside(null);
    setMasterPasswordInput('');
    setMasterPasswordConfirmInput('');
    setShowMasterPw(false);
    setShowConfirmPw(false);
    setDecryptError('');
  }, []);

  const isUnlockedRef = useRef(false);
  useEffect(() => {
    isUnlockedRef.current = isUnlocked;
  }, [isUnlocked]);
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Native (Android) behaviours: lock the vault when the app goes to the
  // background, and give the hardware back button app-appropriate semantics
  // (other tab -> dashboard, dashboard -> lock, locked/setup -> exit).
  useEffect(() => {
    if (!isNativePlatform()) return undefined;
    let removed = false;
    const handles: { remove: () => Promise<void> }[] = [];
    (async () => {
      const stateHandle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive && isUnlockedRef.current) {
          handleLockVault();
        }
      });
      const backHandle = await CapacitorApp.addListener('backButton', () => {
        if (!isUnlockedRef.current) {
          void CapacitorApp.exitApp();
        } else if (activeTabRef.current !== 'dashboard') {
          setActiveTab('dashboard');
        } else {
          handleLockVault();
        }
      });
      if (removed) {
        void stateHandle.remove();
        void backHandle.remove();
      } else {
        handles.push(stateHandle, backHandle);
      }
    })();
    return () => {
      removed = true;
      handles.forEach(h => void h.remove());
    };
  }, [handleLockVault]);

  // Auto-lock inactivity monitor (no state re-renders on pointer/key events)
  useEffect(() => {
    if (!isUnlocked || settings.autoLockMinutes === 0) return undefined;

    const tick = setInterval(() => {
      const inactiveMs = Date.now() - lastActivityRef.current;
      const allowedMs = settings.autoLockMinutes * 60 * 1000;
      if (inactiveMs >= allowedMs) {
        handleLockVault();
      }
    }, 5000);

    return () => clearInterval(tick);
  }, [isUnlocked, settings.autoLockMinutes, handleLockVault]);

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Serialize encrypted writes to localStorage so rapid edits never race
  const persistVaultState = useCallback(
    (nextEntries: VaultEntry[], nextCategories: string[], nextBackupTime: string | null): Promise<void> => {
      const key = sessionKeyRef.current;
      const salt = sessionSaltRef.current;
      const iterations = sessionIterationsRef.current;
      if (!key || !salt) return Promise.resolve();

      const payload: VaultPayload = {
        entries: nextEntries,
        customCategories: nextCategories,
        lastBackupTime: nextBackupTime,
      };

      const task = saveQueueRef.current.then(async () => {
        const envelope = await encryptVaultPayload(payload, key, salt, iterations);
        await saveVaultEnvelope(envelope);
        // Only mark the new envelope authoritative after the write has
        // actually landed (P-02).
        storedEnvelopeRef.current = envelope;
      });
      saveQueueRef.current = task.catch(err => {
        console.error('Failed to encrypt and persist vault:', err);
      });
      // Surface failures to the user instead of leaving the optimistic UI
      // pretending the change is durable (P-02). A later successful save
      // clears the warning.
      void task.then(
        () => setPersistError(null),
        () =>
          setPersistError(
            'Saving failed — your latest changes are NOT stored yet. Keep the app open, check available storage, then make any change to retry saving, or export a backup from Settings.'
          )
      );
      return task;
    },
    []
  );

  const handleUpdateSettings = (newSettings: Partial<UserSettings>) => {
    recordActivity();
    setSettings(prev => {
      const updated: UserSettings = { ...prev, ...newSettings };
      localStorage.setItem(LOCAL_STORAGE_KEY_SETTINGS, JSON.stringify(updated));
      return updated;
    });
  };

  // Initial Master Password Setup (Zero-Knowledge PBKDF2 + AES-256-GCM)
  const handleSetupMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDeriving) return;

    const validation = validateMasterPassword(masterPasswordInput);
    if (!validation.hasMinLength) {
      setDecryptError('Master Password must be at least 12 characters.');
      return;
    }
    if (masterPasswordInput !== masterPasswordConfirmInput) {
      setDecryptError('Passwords do not match.');
      return;
    }

    setIsDeriving(true);
    setDecryptError('');
    try {
      const saltBytes = generateSalt(16);
      const saltBase64 = bytesToBase64(saltBytes);
      const key = await deriveAesKey(masterPasswordInput, saltBytes, DEFAULT_KDF_ITERATIONS);

      const initialPayload: VaultPayload = {
        entries: [],
        customCategories: [],
        lastBackupTime: null,
      };
      const envelope = await encryptVaultPayload(
        initialPayload,
        key,
        saltBase64,
        DEFAULT_KDF_ITERATIONS
      );

      storedEnvelopeRef.current = envelope;
      await saveVaultEnvelope(envelope);
      LEGACY_KEYS.forEach(k => localStorage.removeItem(k));

      sessionKeyRef.current = key;
      sessionSaltRef.current = saltBase64;
      sessionIterationsRef.current = DEFAULT_KDF_ITERATIONS;

      setEntries([]);
      setCustomCategories([]);
      setLastSyncTime('');
      setIsSetupState(false);
      setIsUnlocked(true);
      setMasterPasswordInput('');
      setMasterPasswordConfirmInput('');
      setShowMasterPw(false);
      setShowConfirmPw(false);
      lastActivityRef.current = Date.now();
    } catch (err) {
      console.error('Vault setup error:', err);
      setDecryptError('Cryptographic initialization failed in this browser.');
    } finally {
      setIsDeriving(false);
    }
  };

  // Unlock existing encrypted vault using Web Crypto AES-256-GCM decryption
  const handleUnlockVault = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isDeriving || !masterPasswordInput) return;

    const envelope = storedEnvelopeRef.current ?? (await loadVaultEnvelope());
    if (envelope) storedEnvelopeRef.current = envelope;
    if (!envelope) {
      setIsSetupState(true);
      setDecryptError('');
      return;
    }

    setIsDeriving(true);
    setDecryptError('');
    try {
      const { payload, key } = await decryptVaultEnvelope(envelope, masterPasswordInput);

      sessionKeyRef.current = key;
      sessionSaltRef.current = envelope.salt;
      sessionIterationsRef.current = envelope.iterations;

      // Enforce 30-day Trash retention policy on unlock
      const purgedEntries = purgeExpiredTrashEntries(payload.entries, 30);
      const nextBackupTime = payload.lastBackupTime || '';

      setEntries(purgedEntries);
      setCustomCategories(payload.customCategories);
      setLastSyncTime(nextBackupTime);
      setIsUnlocked(true);
      setFailedAttempts(0);
      setMasterPasswordInput('');
      setShowMasterPw(false);
      lastActivityRef.current = Date.now();

      if (purgedEntries.length !== payload.entries.length) {
        await persistVaultState(purgedEntries, payload.customCategories, nextBackupTime || null);
      }
    } catch {
      setFailedAttempts(prev => prev + 1);
      setDecryptError(strings.wrongPassword);
    } finally {
      setIsDeriving(false);
    }
  };

  // Reset local vault (wipes encrypted storage after explicit modal confirmation)
  const handleConfirmResetVault = async () => {
    storedEnvelopeRef.current = null;
    await deleteVaultEnvelope();
    LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
    handleLockVault();
    setFailedAttempts(0);
    setShowResetModal(false);
    setIsSetupState(true);
  };

  // P-03 recovery: export the raw (still encrypted) stored bytes so the
  // user keeps a copy of the unreadable vault before deciding anything.
  const handleExportCorruptVault = async () => {
    const raw = await readRawVaultData();
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `isecure-unreadable-vault-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // P-03 recovery: deliberate, confirmed erase of the unreadable vault.
  const handleEraseCorruptVault = async () => {
    await deleteVaultEnvelope();
    storedEnvelopeRef.current = null;
    setIsStorageCorrupt(false);
    setConfirmEraseCorrupt(false);
    setIsSetupState(true);
  };

  // Vault CRUD operations (always encrypted before persisting)
  const handleAddEntry = (payload: Omit<VaultEntry, 'id' | 'createdDate' | 'modifiedDate' | 'history' | 'isTrash'>) => {
    recordActivity();
    const now = new Date().toISOString();
    const newEntry: VaultEntry = {
      ...payload,
      id: generateSecureId('item'),
      createdDate: now,
      modifiedDate: now,
      isTrash: false,
      history: [],
    };
    const updated = [newEntry, ...entries];
    setEntries(updated);
    void persistVaultState(updated, customCategories, lastSyncTime || null);
  };

  const handleEditEntry = (id: string, payload: Partial<VaultEntry>) => {
    recordActivity();
    const now = new Date().toISOString();
    const updated = entries.map(entry => {
      if (entry.id !== id) return entry;
      const passwordChanged = typeof payload.password === 'string' && payload.password !== entry.password;
      const newHistory = [...entry.history];
      if (passwordChanged && entry.password) {
        newHistory.push({
          id: generateSecureId('hist'),
          password: entry.password,
          changedAt: now,
        });
      }
      return {
        ...entry,
        ...payload,
        history: newHistory,
        modifiedDate: now,
      };
    });
    setEntries(updated);
    void persistVaultState(updated, customCategories, lastSyncTime || null);
  };

  const handleDeleteEntry = (id: string) => {
    recordActivity();
    const now = new Date().toISOString();
    const updated = entries.map(entry =>
      entry.id === id ? { ...entry, isTrash: true, deletedAt: now } : entry
    );
    setEntries(updated);
    void persistVaultState(updated, customCategories, lastSyncTime || null);
  };

  const handleRestoreEntry = (id: string) => {
    recordActivity();
    const updated = entries.map(entry =>
      entry.id === id ? { ...entry, isTrash: false, deletedAt: undefined } : entry
    );
    setEntries(updated);
    void persistVaultState(updated, customCategories, lastSyncTime || null);
  };

  const handlePermanentlyDelete = (id: string) => {
    recordActivity();
    const updated = entries.filter(e => e.id !== id);
    setEntries(updated);
    void persistVaultState(updated, customCategories, lastSyncTime || null);
  };

  const handlePurgeTrash = () => {
    recordActivity();
    const updated = entries.filter(e => !e.isTrash);
    setEntries(updated);
    void persistVaultState(updated, customCategories, lastSyncTime || null);
  };

  const handleAddCustomCategory = (name: string) => {
    recordActivity();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (customCategories.some(c => c.toLowerCase() === trimmed.toLowerCase())) return;
    const updated = [...customCategories, trimmed];
    setCustomCategories(updated);
    void persistVaultState(entries, updated, lastSyncTime || null);
  };

  // Real AES-256-GCM Encrypted Backup Export (.pishivault.json)
  const handleExportBackup = async (): Promise<void> => {
    recordActivity();
    const key = sessionKeyRef.current;
    const salt = sessionSaltRef.current;
    const iterations = sessionIterationsRef.current;
    if (!key || !salt) {
      throw new Error('Vault session is locked.');
    }

    const nowIso = new Date().toISOString();
    const payload: VaultPayload = {
      entries,
      customCategories,
      lastBackupTime: nowIso,
    };
    const envelope = await encryptVaultPayload(payload, key, salt, iterations);

    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pishisecure-backup-${nowIso.slice(0, 10)}.pishivault.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setLastSyncTime(nowIso);
    await persistVaultState(entries, customCategories, nowIso);
  };

  const mergeAndPersistDecryptedPayload = useCallback(
    async (payload: VaultPayload): Promise<void> => {
      const mergedMap = new Map<string, VaultEntry>();
      entries.forEach(item => mergedMap.set(item.id, item));
      payload.entries.forEach(incoming => {
        const existing = mergedMap.get(incoming.id);
        if (!existing) {
          mergedMap.set(incoming.id, incoming);
        } else {
          const incTime = new Date(incoming.modifiedDate).getTime();
          const extTime = new Date(existing.modifiedDate).getTime();
          if (!Number.isNaN(incTime) && (Number.isNaN(extTime) || incTime >= extTime)) {
            mergedMap.set(incoming.id, incoming);
          }
        }
      });

      const mergedEntries = purgeExpiredTrashEntries(Array.from(mergedMap.values()), 30);

      const mergedCategories = [...customCategories];
      payload.customCategories.forEach(cat => {
        const trimmed = cat.trim();
        if (trimmed && !mergedCategories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
          mergedCategories.push(trimmed);
        }
      });

      setEntries(mergedEntries);
      setCustomCategories(mergedCategories);
      await persistVaultState(mergedEntries, mergedCategories, lastSyncTime || null);
    },
    [entries, customCategories, lastSyncTime, persistVaultState]
  );

  // Real Encrypted Backup Import & Decryption
  const handleImportBackup = async (file: File, backupPassword: string): Promise<void> => {
    recordActivity();
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Selected file is not valid JSON.');
    }

    if (!isValidEncryptedEnvelope(parsed)) {
      throw new Error('File is not a valid iSecure encrypted backup envelope.');
    }

    const { payload } = await decryptVaultEnvelope(parsed, backupPassword);
    await mergeAndPersistDecryptedPayload(payload);
  };

  // Google Drive Auth & Encrypted Backup Handlers
  const handleDriveAuthFailureCleanup = useCallback(() => {
    clearCachedDriveAccessToken();
    setDriveAccessToken(null);
    setDriveBackups([]);
  }, []);

  const handleDriveSignIn = async (): Promise<void> => {
    recordActivity();
    setIsDriveBusy(true);
    try {
      const { user, accessToken } = await signInWithGoogleDrive();
      setDriveUser(user);
      setDriveAccessToken(accessToken);
      const files = await listDriveBackups(accessToken);
      setDriveBackups(files);
    } finally {
      setIsDriveBusy(false);
    }
  };

  const handleDriveSignOut = async (): Promise<void> => {
    recordActivity();
    setIsDriveBusy(true);
    try {
      await signOutGoogleDrive();
      setDriveUser(null);
      setDriveAccessToken(null);
      setDriveBackups([]);
    } finally {
      setIsDriveBusy(false);
    }
  };

  const handleDriveRefresh = async (): Promise<void> => {
    recordActivity();
    if (!driveAccessToken) {
      throw new Error('Google Drive session expired. Please sign in with Google.');
    }
    setIsDriveBusy(true);
    try {
      const files = await listDriveBackups(driveAccessToken);
      setDriveBackups(files);
    } catch (err) {
      if (err instanceof Error && err.message === 'DRIVE_AUTH_EXPIRED') {
        handleDriveAuthFailureCleanup();
        throw new Error('Google Drive session expired. Please sign in with Google again.');
      }
      throw err;
    } finally {
      setIsDriveBusy(false);
    }
  };

  const handleBackupToDrive = async (
    existingFileId?: string,
    existingFileName?: string
  ): Promise<void> => {
    recordActivity();
    if (!driveAccessToken) {
      throw new Error('Sign in with Google first to back up to Google Drive.');
    }
    const key = sessionKeyRef.current;
    const salt = sessionSaltRef.current;
    const iterations = sessionIterationsRef.current;
    if (!key || !salt) {
      throw new Error('Vault session is locked.');
    }

    setIsDriveBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const payload: VaultPayload = {
        entries,
        customCategories,
        lastBackupTime: nowIso,
      };
      const envelope = await encryptVaultPayload(payload, key, salt, iterations);
      await uploadEncryptedBackupToDrive(
        driveAccessToken,
        envelope,
        existingFileId,
        existingFileName
      );

      setLastSyncTime(nowIso);
      await persistVaultState(entries, customCategories, nowIso);

      const files = await listDriveBackups(driveAccessToken);
      setDriveBackups(files);
    } catch (err) {
      if (err instanceof Error && err.message === 'DRIVE_AUTH_EXPIRED') {
        handleDriveAuthFailureCleanup();
        throw new Error('Google Drive session expired. Please sign in with Google again.');
      }
      throw err;
    } finally {
      setIsDriveBusy(false);
    }
  };

  const handleRestoreFromDrive = async (
    fileId: string,
    backupPassword: string
  ): Promise<void> => {
    recordActivity();
    if (!driveAccessToken) {
      throw new Error('Sign in with Google first to restore from Google Drive.');
    }
    setIsDriveBusy(true);
    try {
      const envelope = await downloadDriveBackupEnvelope(driveAccessToken, fileId);
      const { payload } = await decryptVaultEnvelope(envelope, backupPassword);
      await mergeAndPersistDecryptedPayload(payload);
    } catch (err) {
      if (err instanceof Error && err.message === 'DRIVE_AUTH_EXPIRED') {
        handleDriveAuthFailureCleanup();
        throw new Error('Google Drive session expired. Please sign in with Google again.');
      }
      throw err;
    } finally {
      setIsDriveBusy(false);
    }
  };

  const handleDeleteDriveBackup = async (fileId: string): Promise<void> => {
    recordActivity();
    if (!driveAccessToken) {
      throw new Error('Sign in with Google first to manage Drive backups.');
    }
    setIsDriveBusy(true);
    try {
      await deleteDriveBackup(driveAccessToken, fileId);
      setDriveBackups(prev => prev.filter(f => f.id !== fileId));
    } catch (err) {
      if (err instanceof Error && err.message === 'DRIVE_AUTH_EXPIRED') {
        handleDriveAuthFailureCleanup();
        throw new Error('Google Drive session expired. Please sign in with Google again.');
      }
      throw err;
    } finally {
      setIsDriveBusy(false);
    }
  };

  const validationCheck = validateMasterPassword(masterPasswordInput);

  return (
    <div
      className={`min-h-screen text-gray-900 dark:text-zinc-100 flex flex-col font-sans transition-colors duration-300 ${
        settings.theme === 'amoled' ? 'bg-black' : 'bg-gray-50 dark:bg-zinc-950'
      }`}
      dir={isRTL ? 'rtl' : 'ltr'}
      onMouseMove={recordActivity}
      onKeyDown={recordActivity}
      id="pishisecure_root_element"
    >
      {/* Dynamic Watermark alerting Screenshot Protection if configured */}
      {settings.screenshotProtection && isUnlocked && (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden opacity-[0.015] select-none dark:opacity-[0.01] flex items-center justify-center rotate-12">
          <span className="text-3xl font-black tracking-widest uppercase">ISECURE ANTI-CAP BUFFER LIVE</span>
        </div>
      )}

      {persistError && isUnlocked && (
        <div className="fixed top-0 inset-x-0 z-[90] bg-rose-600 text-white text-[11px] font-bold px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg">
          <span>{persistError}</span>
          <button
            type="button"
            onClick={() => setPersistError(null)}
            className="shrink-0 px-2 py-1 bg-white/20 rounded-md cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!isStorageReady ? (
          /* CASE 0: LOADING ENCRYPTED ENVELOPE FROM PLATFORM STORAGE */
          <motion.div
            key="storage-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4"
          >
            <div className="w-14 h-14 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl flex items-center justify-center font-black text-base italic shadow-md">
              iS
            </div>
            <div className="w-7 h-7 rounded-full border-2 border-gray-300 dark:border-zinc-700 border-t-blue-500 animate-spin" />
          </motion.div>
        ) : isStorageCorrupt ? (
          /* CASE A0: VAULT EXISTS BUT IS UNREADABLE — RECOVERY (P-03) */
          <motion.div
            key="storage-corrupt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto p-6 text-center space-y-6"
          >
            <div className="w-14 h-14 bg-rose-600 text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-md">
              !
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-black">Vault data is unreadable</h2>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
                A vault exists on this device but it could not be read or parsed, so it was
                NOT treated as a new vault and nothing has been overwritten. You can download
                the raw stored data (still encrypted) for safekeeping. Erasing is permanent
                and only makes sense if you have a separate backup.
              </p>
            </div>
            <div className="w-full space-y-3">
              <button
                type="button"
                onClick={handleExportCorruptVault}
                className="w-full py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl text-xs font-black cursor-pointer"
              >
                Download raw vault data
              </button>
              {confirmEraseCorrupt ? (
                <button
                  type="button"
                  onClick={handleEraseCorruptVault}
                  className="w-full py-3 bg-rose-600 text-white rounded-xl text-xs font-black cursor-pointer"
                >
                  Tap again to permanently erase and start over
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmEraseCorrupt(true)}
                  className="w-full py-3 bg-white dark:bg-zinc-900 border border-rose-300 dark:border-rose-900 text-rose-600 rounded-xl text-xs font-black cursor-pointer"
                >
                  Erase vault and start over
                </button>
              )}
            </div>
          </motion.div>
        ) : isSetupState ? (
          /* CASE A: FIRST-TIME ZERO-KNOWLEDGE VAULT SETUP */
          <motion.div
            key="setup-guard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto p-6 text-center space-y-6"
          >
            <div className="w-full flex justify-end">
              <select
                aria-label="Select Language"
                value={settings.language}
                onChange={(e) => handleUpdateSettings({ language: e.target.value })}
                className="text-xs px-3 py-1.5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none"
              >
                {Object.values(localesMap).map(loc => (
                  <option key={loc.code} value={loc.code}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-14 h-14 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl flex items-center justify-center font-black text-base italic shadow-md">
              iS
            </div>

            <div>
              <h1 className="text-xl font-black text-gray-900 dark:text-white">{strings.appName}</h1>
              <p className="text-xs text-gray-400 mt-1">{strings.setupVault}</p>
            </div>

            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 rounded-2xl text-[11px] leading-relaxed text-start flex gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{strings.masterPasswordSetupText}</span>
            </div>

            <form onSubmit={handleSetupMasterPassword} className="w-full space-y-4 text-start">
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                  {strings.masterPassword}
                </label>
                <div className="relative">
                  <input
                    type={showMasterPw ? 'text' : 'password'}
                    required
                    minLength={12}
                    autoComplete="new-password"
                    placeholder="12+ characters..."
                    value={masterPasswordInput}
                    onChange={(e) => setMasterPasswordInput(e.target.value)}
                    className="w-full text-xs p-3 pe-10 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    aria-label={showMasterPw ? 'Hide master password' : 'Show master password'}
                    onClick={() => setShowMasterPw(prev => !prev)}
                    className="absolute inset-y-0 end-0 px-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
                  >
                    {showMasterPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                  {strings.masterPasswordConfirm}
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    required
                    minLength={12}
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    value={masterPasswordConfirmInput}
                    onChange={(e) => setMasterPasswordConfirmInput(e.target.value)}
                    className="w-full text-xs p-3 pe-10 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    aria-label={showConfirmPw ? 'Hide confirmation password' : 'Show confirmation password'}
                    onClick={() => setShowConfirmPw(prev => !prev)}
                    className="absolute inset-y-0 end-0 px-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
                  >
                    {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {masterPasswordInput.length > 0 && (
                <div className="p-3 bg-gray-100 dark:bg-zinc-900 rounded-xl space-y-1.5 text-[10px] font-mono">
                  <div className="flex gap-2 items-center">
                    <span className={validationCheck.hasMinLength ? 'text-emerald-500' : 'text-gray-400'}>✔</span>
                    <span>12+ characters ({Array.from(masterPasswordInput).length})</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className={validationCheck.hasUpper ? 'text-emerald-500' : 'text-gray-400'}>✔</span>
                    <span>A-Z</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className={validationCheck.hasLower ? 'text-emerald-500' : 'text-gray-400'}>✔</span>
                    <span>a-z</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className={validationCheck.hasNumber ? 'text-emerald-500' : 'text-gray-400'}>✔</span>
                    <span>0-9</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className={validationCheck.hasSymbol ? 'text-emerald-500' : 'text-gray-400'}>✔</span>
                    <span>!@#$...</span>
                  </div>
                  <div className="pt-2 border-t border-gray-200 dark:border-zinc-800 mt-2 flex justify-between">
                    <span>{strings.genEntropy}:</span>
                    <span className="font-bold">{validationCheck.entropy} bits</span>
                  </div>
                </div>
              )}

              {decryptError && (
                <p role="alert" className="text-xs text-rose-500 font-bold bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20">
                  {decryptError}
                </p>
              )}

              <button
                type="submit"
                disabled={isDeriving}
                className="w-full py-3 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white rounded-xl text-xs font-bold transition shadow-sm"
              >
                {isDeriving ? 'PBKDF2-SHA256 / AES-256-GCM...' : strings.setupVault}
              </button>
            </form>

            <p className="text-[10px] text-gray-400">
              Web Crypto PBKDF2-HMAC-SHA256 ({DEFAULT_KDF_ITERATIONS.toLocaleString()} iterations) + AES-256-GCM
            </p>
          </motion.div>
        ) : !isUnlocked ? (
          /* CASE B: ZERO-KNOWLEDGE DECRYPTION LOCK GATE */
          <motion.div
            key="lock-gate"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex-1 flex flex-col items-center justify-center max-w-sm w-full mx-auto p-6 text-center space-y-6"
          >
            <div className="w-full flex justify-end">
              <select
                aria-label="Select Language"
                value={settings.language}
                onChange={(e) => handleUpdateSettings({ language: e.target.value })}
                className="text-xs px-3 py-1.5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none"
              >
                {Object.values(localesMap).map(loc => (
                  <option key={loc.code} value={loc.code}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-14 h-14 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl flex items-center justify-center font-black text-base shadow-sm">
              <Lock className="w-6 h-6" />
            </div>

            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">{strings.appLocked}</h1>
              <p className="text-xs text-gray-400 mt-1">{strings.enterMasterPassword}</p>
            </div>

            <form onSubmit={handleUnlockVault} className="w-full space-y-3 text-start">
              <div className="relative">
                <input
                  type={showMasterPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder={strings.masterPassword}
                  value={masterPasswordInput}
                  onChange={(e) => setMasterPasswordInput(e.target.value)}
                  className="w-full text-xs p-3.5 pe-10 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  aria-label={showMasterPw ? 'Hide master password' : 'Show master password'}
                  onClick={() => setShowMasterPw(prev => !prev)}
                  className="absolute inset-y-0 end-0 px-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
                >
                  {showMasterPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {decryptError && (
                <p role="alert" className="text-xs text-rose-500 font-bold bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20">
                  {decryptError}
                  {failedAttempts >= 3 ? ` (${failedAttempts})` : ''}
                </p>
              )}

              <button
                type="submit"
                disabled={isDeriving || !masterPasswordInput}
                className="w-full py-3 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white text-xs font-bold rounded-xl transition"
              >
                {isDeriving ? 'Decrypting AES-256-GCM...' : strings.unlock}
              </button>
            </form>

            <div className="text-[10px] text-gray-400 space-y-2">
              <p>{strings.appLockedDesc}</p>
              <button
                type="button"
                onClick={() => setShowResetModal(true)}
                className="inline-flex items-center gap-1 text-rose-500 font-semibold hover:underline"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Local Vault
              </button>
            </div>

            {showResetModal && (
              <div
                className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="reset-vault-title"
              >
                <div className="p-6 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 max-w-sm w-full text-start space-y-4 shadow-xl">
                  <div className="flex items-center gap-2 text-rose-500 font-bold text-sm" id="reset-vault-title">
                    <AlertTriangle className="w-5 h-5" />
                    <span>Reset Encrypted Local Vault?</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
                    Zero-Knowledge encryption prevents password recovery. Resetting permanently erases the local encrypted vault so you can initialize a new one.
                  </p>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowResetModal(false)}
                      className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300"
                    >
                      {strings.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmResetVault}
                      className="px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
                    >
                      {strings.permanentlyDelete}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          /* CASE C: VAULT DECRYPTED & ACTIVE */
          <motion.div
            key="app-shell"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col"
          >
            {/* Header Bar */}
            <header className="border-b border-gray-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 px-6 py-4">
              <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Brand */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl flex items-center justify-center font-black text-xs italic shadow-sm flex-shrink-0">
                    iS
                  </div>
                  <div>
                    <h1 className="text-sm font-black text-gray-950 dark:text-white flex items-center gap-1.5 leading-tight">
                      {strings.appName}
                      <span className="p-1 px-1.5 bg-emerald-500/10 text-emerald-500 rounded text-[9px] uppercase font-bold font-mono tracking-wider">
                        AES-256-GCM
                      </span>
                    </h1>
                    {strings.tagline && <p className="text-[10px] text-gray-400 mt-0.5">{strings.tagline}</p>}
                  </div>
                </div>

                {/* Primary Navigation */}
                <nav className="flex flex-wrap items-center gap-1" aria-label="Primary Navigation">
                  {[
                    { id: 'dashboard', label: strings.dashboard, icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
                    { id: 'vault', label: strings.vault, icon: <Key className="w-3.5 h-3.5" /> },
                    { id: 'generator', label: strings.generator, icon: <Layers className="w-3.5 h-3.5" /> },
                    { id: 'audit', label: strings.auditTitle, icon: <Shield className="w-3.5 h-3.5" /> },
                    { id: 'settings', label: strings.settingsTitle, icon: <Settings className="w-3.5 h-3.5" /> },
                    { id: 'blueprints', label: strings.blueprintsTitle, icon: <Database className="w-3.5 h-3.5" /> },
                  ].map(tab => (
                    <button
                      type="button"
                      key={tab.id}
                      onClick={() => {
                        recordActivity();
                        setActiveTab(tab.id);
                      }}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition ${
                        activeTab === tab.id
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </nav>

                {/* Lock Controls */}
                <div className="flex items-center gap-3">
                  {settings.autoLockMinutes > 0 && (
                    <div className="text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-zinc-900 px-2 py-1 rounded border border-gray-200/50 dark:border-zinc-800">
                      {settings.autoLockMinutes}m
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleLockVault}
                    aria-label="Lock storage vault instantly"
                    title="Lock storage vault instantly"
                    className="p-2 border border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-900 rounded-lg text-gray-500 hover:text-gray-800 dark:hover:text-zinc-200 transition"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </header>

            {/* Main View Container */}
            <main className="flex-1 max-w-7xl w-full mx-auto p-6">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-24">
                    <div className="w-7 h-7 rounded-full border-2 border-gray-300 dark:border-zinc-700 border-t-blue-500 animate-spin" />
                  </div>
                }
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.1 }}
                    className="h-full"
                  >
                    {activeTab === 'dashboard' && (
                      <DashboardView
                        entries={entries}
                        strings={strings}
                        lastSyncTime={lastSyncTime}
                        driveConnected={Boolean(driveUser && driveAccessToken)}
                        onExportBackup={handleExportBackup}
                        onDriveBackup={() => handleBackupToDrive()}
                        onNavigate={(tab) => {
                          recordActivity();
                          setActiveTab(tab);
                        }}
                        onSelectEntry={(entry) => {
                          recordActivity();
                          setSelectedEntryFromOutside(entry);
                        }}
                      />
                    )}

                    {activeTab === 'vault' && (
                      <VaultView
                        entries={entries}
                        strings={strings}
                        customCategories={customCategories}
                        clipboardClearSeconds={settings.clipboardClearSeconds}
                        selectedEntryFromOutside={selectedEntryFromOutside}
                        onClearOutsideSelectedEntry={() => setSelectedEntryFromOutside(null)}
                        onAddEntry={handleAddEntry}
                        onEditEntry={handleEditEntry}
                        onDeleteEntry={handleDeleteEntry}
                        onPermanentlyDelete={handlePermanentlyDelete}
                        onRestoreEntry={handleRestoreEntry}
                        onPurgeTrash={handlePurgeTrash}
                        onAddCustomCategory={handleAddCustomCategory}
                      />
                    )}

                    {activeTab === 'generator' && (
                      <GeneratorView
                        strings={strings}
                        clipboardClearSeconds={settings.clipboardClearSeconds}
                      />
                    )}

                    {activeTab === 'audit' && (
                      <SecurityView
                        entries={entries}
                        strings={strings}
                        onNavigateToEntry={(entry) => {
                          recordActivity();
                          setSelectedEntryFromOutside(entry);
                          setActiveTab('vault');
                        }}
                      />
                    )}

                    {activeTab === 'settings' && (
                      <SettingsView
                        settings={settings}
                        strings={strings}
                        onUpdateSettings={handleUpdateSettings}
                        onExportBackup={handleExportBackup}
                        onImportBackup={handleImportBackup}
                        driveConnected={Boolean(driveUser && driveAccessToken)}
                        driveUserEmail={driveUser?.email ?? null}
                        driveUserName={driveUser?.displayName ?? null}
                        driveBackups={driveBackups}
                        isDriveBusy={isDriveBusy}
                        onDriveSignIn={handleDriveSignIn}
                        onDriveSignOut={handleDriveSignOut}
                        onDriveRefresh={handleDriveRefresh}
                        onDriveBackupNew={() => handleBackupToDrive()}
                        onDriveOverwriteBackup={(fileId, fileName) => handleBackupToDrive(fileId, fileName)}
                        onDriveRestoreBackup={handleRestoreFromDrive}
                        onDriveDeleteBackup={handleDeleteDriveBackup}
                      />
                    )}

                    {activeTab === 'blueprints' && <BlueprintsView />}
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            </main>

            {/* Footer */}
            <footer className="border-t border-gray-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 px-6 py-4 text-[10px] font-mono text-gray-400 text-center">
              <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
                <span>© {new Date().getFullYear()} iSecure. Zero-Knowledge Client-Side Encryption.</span>
                <SystemClock localeCode={strings.code} />
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
