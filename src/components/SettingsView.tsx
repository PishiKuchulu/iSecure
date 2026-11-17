/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Palette, Globe, Lock, Check, Shield, Download, Upload, AlertTriangle,
  Cloud, RefreshCw, Trash2, LogOut, RotateCcw, ChevronDown, Fingerprint,
  ArrowUpCircle, Info
} from 'lucide-react';
import { UserSettings } from '../types';
import { localesMap, LocaleStrings } from '../locales';
import { DriveBackupFile } from '../services/googleDriveBackup';
import { isUpdaterSupported } from '../services/updater';
import UpdateSection from './UpdateSection';

interface AccordionSectionProps {
  icon: React.ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AccordionSection({ icon, title, open, onToggle, children }: AccordionSectionProps) {
  return (
    <section className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-5 py-4 text-start cursor-pointer"
      >
        {icon}
        <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100 flex-1">
          {title}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-5 pb-5 space-y-5">{children}</div>}
    </section>
  );
}

interface SettingsViewProps {
  settings: UserSettings;
  strings: LocaleStrings;
  onUpdateSettings: (settings: Partial<UserSettings>) => void;
  onExportBackup: () => Promise<void>;
  onImportBackup: (file: File, backupPassword: string) => Promise<void>;
  driveConnected: boolean;
  driveUserEmail: string | null;
  driveUserName: string | null;
  driveBackups: DriveBackupFile[];
  isDriveBusy: boolean;
  onDriveSignIn: () => Promise<void>;
  onDriveSignOut: () => Promise<void>;
  onDriveRefresh: () => Promise<void>;
  onDriveBackupNew: () => Promise<void>;
  onDriveOverwriteBackup: (fileId: string, fileName: string) => Promise<void>;
  onDriveRestoreBackup: (fileId: string, backupPassword: string) => Promise<void>;
  onDriveDeleteBackup: (fileId: string) => Promise<void>;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  onEnableBiometric: (candidate: string) => Promise<void>;
  onDisableBiometric: () => Promise<void>;
  onFilePickerOpen?: () => void;
}

type PendingDriveConfirmation =
  | { type: 'overwrite'; file: DriveBackupFile }
  | { type: 'delete'; file: DriveBackupFile }
  | null;

export default function SettingsView({
  settings,
  strings,
  onUpdateSettings,
  onExportBackup,
  onImportBackup,
  driveConnected,
  driveUserEmail,
  driveUserName,
  driveBackups,
  isDriveBusy,
  onDriveSignIn,
  onDriveSignOut,
  onDriveRefresh,
  onDriveBackupNew,
  onDriveOverwriteBackup,
  onDriveRestoreBackup,
  onDriveDeleteBackup,
  biometricAvailable,
  biometricEnabled,
  onEnableBiometric,
  onDisableBiometric,
  onFilePickerOpen,
}: SettingsViewProps) {
  const [importPassword, setImportPassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [driveStatus, setDriveStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingDriveConfirmation>(null);
  const [restoreTarget, setRestoreTarget] = useState<DriveBackupFile | null>(null);
  const [driveRestorePassword, setDriveRestorePassword] = useState('');
  const [driveRestoreError, setDriveRestoreError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Accordion sections (appearance + security open by default, so the
  // fingerprint toggle is visible without hunting through the menu).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ theme: true, security: true });
  const toggleSection = (id: string) =>
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));
  const updaterSupported = isUpdaterSupported();

  // Fingerprint unlock enable flow (master-secret confirmation form).
  const [bioFormOpen, setBioFormOpen] = useState(false);
  const [bioSecretInput, setBioSecretInput] = useState('');
  const [bioError, setBioError] = useState('');
  const [bioBusy, setBioBusy] = useState(false);

  const handleBioCheckbox = async (checked: boolean) => {
    if (!checked) {
      setBioBusy(true);
      try {
        await onDisableBiometric();
        setBioFormOpen(false);
        setBioSecretInput('');
        setBioError('');
      } finally {
        setBioBusy(false);
      }
    } else {
      setBioFormOpen(true);
      setBioError('');
    }
  };

  const handleBioEnableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bioSecretInput || bioBusy) return;
    setBioBusy(true);
    setBioError('');
    try {
      await onEnableBiometric(bioSecretInput);
      setBioSecretInput('');
      setBioFormOpen(false);
    } catch (err) {
      setBioError(err instanceof Error ? err.message : strings.wrongPassword);
    } finally {
      setBioBusy(false);
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingConfirm(null);
        setRestoreTarget(null);
        setDriveRestorePassword('');
        setDriveRestoreError('');
      }
    };
    if (pendingConfirm || restoreTarget) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
    return undefined;
  }, [pendingConfirm, restoreTarget]);

  const themes: { id: UserSettings['theme']; label: string }[] = [
    { id: 'light', label: strings.themeLight },
    { id: 'dark', label: strings.themeDark },
    { id: 'amoled', label: strings.themeAmoled },
    { id: 'system', label: strings.themeSystem },
  ];

  const autoLockOptions = [
    { value: 0, label: strings.autoLockDisabled },
    { value: 1, label: strings.autoLock1m },
    { value: 5, label: strings.autoLock5m },
    { value: 15, label: strings.autoLock15m },
    { value: 30, label: strings.autoLock30m },
  ];

  const clipboardOptions = [
    { value: 0, label: strings.clipDisabled },
    { value: 15, label: strings.clip15s },
    { value: 30, label: strings.clip30s },
    { value: 60, label: strings.clip60s },
  ];

  const languagesList = Object.values(localesMap);

  const handleExport = async () => {
    setIsBusy(true);
    setBackupStatus(null);
    try {
      await onExportBackup();
      setBackupStatus({ type: 'success', msg: 'Encrypted AES-256-GCM vault backup downloaded.' });
    } catch (err) {
      setBackupStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Export failed.' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    setIsBusy(true);
    setBackupStatus(null);
    try {
      await onImportBackup(selectedFile, importPassword);
      setBackupStatus({ type: 'success', msg: 'Encrypted backup decrypted and restored.' });
      setSelectedFile(null);
      setImportPassword('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setBackupStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Decryption failed. Check password or file.' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSignInClick = async () => {
    setDriveStatus(null);
    try {
      await onDriveSignIn();
      setDriveStatus({ type: 'success', msg: 'Connected to Google Drive.' });
    } catch (err) {
      setDriveStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Google sign-in failed.' });
    }
  };

  const handleSignOutClick = async () => {
    setDriveStatus(null);
    try {
      await onDriveSignOut();
      setDriveStatus({ type: 'success', msg: 'Disconnected from Google Drive.' });
    } catch (err) {
      setDriveStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Sign-out failed.' });
    }
  };

  const handleDriveNewBackup = async () => {
    setDriveStatus(null);
    try {
      await onDriveBackupNew();
      setDriveStatus({ type: 'success', msg: 'Encrypted AES-256-GCM snapshot uploaded to Google Drive.' });
    } catch (err) {
      setDriveStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Google Drive backup failed.' });
    }
  };

  const handleRefreshList = async () => {
    setDriveStatus(null);
    try {
      await onDriveRefresh();
    } catch (err) {
      setDriveStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to list Drive backups.' });
    }
  };

  const handleExecuteConfirmedDriveAction = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm;
    setPendingConfirm(null);
    setDriveStatus(null);
    try {
      if (action.type === 'overwrite') {
        await onDriveOverwriteBackup(action.file.id, action.file.name);
        setDriveStatus({ type: 'success', msg: `Updated encrypted backup "${action.file.name}" on Google Drive.` });
      } else {
        await onDriveDeleteBackup(action.file.id);
        setDriveStatus({ type: 'success', msg: `Deleted "${action.file.name}" from Google Drive.` });
      }
    } catch (err) {
      setDriveStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Google Drive action failed.' });
    }
  };

  const handleSubmitDriveRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreTarget || !driveRestorePassword) return;
    setDriveRestoreError('');
    try {
      await onDriveRestoreBackup(restoreTarget.id, driveRestorePassword);
      setDriveStatus({ type: 'success', msg: `Decrypted and restored "${restoreTarget.name}" from Google Drive.` });
      setRestoreTarget(null);
      setDriveRestorePassword('');
    } catch (err) {
      setDriveRestoreError(err instanceof Error ? err.message : 'Decryption failed. Check backup password.');
    }
  };

  return (
    <div className="space-y-4 w-full max-w-3xl mx-auto" id="settings_panel_wrapper">
        {/* Theme Settings */}
        <AccordionSection
          icon={<Palette className="w-4 h-4 text-blue-500" />}
          title={strings.theme}
          open={Boolean(openSections.theme)}
          onToggle={() => toggleSection('theme')}
        >

          <div className="grid grid-cols-2 gap-3">
            {themes.map(t => (
              <button
                type="button"
                key={t.id}
                onClick={() => onUpdateSettings({ theme: t.id })}
                className={`p-3 text-xs rounded-xl border font-medium flex items-center justify-between text-start transition cursor-pointer ${
                  settings.theme === t.id
                    ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                    : 'bg-gray-50/50 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800'
                }`}
              >
                <span>{t.label}</span>
                {settings.theme === t.id && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </AccordionSection>

        {/* Dynamic Language Switcher */}
        <AccordionSection
          icon={<Globe className="w-4 h-4 text-teal-500" />}
          title="Languages & Localizations (Full LTR/RTL Mirroring)"
          open={Boolean(openSections.language)}
          onToggle={() => toggleSection('language')}
        >

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {languagesList.map(lang => (
              <button
                type="button"
                key={lang.code}
                onClick={() => onUpdateSettings({ language: lang.code })}
                className={`p-2.5 text-xs rounded-lg border font-mono flex items-center justify-between transition cursor-pointer ${
                  settings.language === lang.code
                    ? 'bg-teal-500/10 text-teal-600 border-teal-500/30 font-bold'
                    : 'bg-gray-50/50 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800'
                }`}
              >
                <span>{lang.name}</span>
                {settings.language === lang.code && <Check className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </AccordionSection>

        {/* Security timeouts */}
        <AccordionSection
          icon={<Shield className="w-4 h-4 text-violet-500" />}
          title="App Timeout & Protections"
          open={Boolean(openSections.security)}
          onToggle={() => toggleSection('security')}
        >

          {/* Auto Lock timer */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                {strings.autoLock}
              </label>
              <span className="font-mono text-xs font-bold bg-violet-500/10 text-violet-600 px-2 py-0.5 rounded">
                {autoLockOptions.find(o => o.value === settings.autoLockMinutes)?.label}
              </span>
            </div>
            <div className="flex gap-1">
              {autoLockOptions.map(option => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => onUpdateSettings({ autoLockMinutes: option.value })}
                  className={`flex-1 py-1.5 px-1 text-[10px] rounded border transition cursor-pointer ${
                    settings.autoLockMinutes === option.value
                      ? 'bg-violet-500/10 text-violet-600 border-violet-500/30 font-bold'
                      : 'bg-gray-50/30 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {option.value === 0 ? 'Off' : `${option.value}m`}
                </button>
              ))}
            </div>
          </div>

          {/* Clipboard clear */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                {strings.clipboardAuto}
              </label>
              <span className="font-mono text-xs font-bold bg-indigo-500/10 text-indigo-600 px-2 py-0.5 rounded">
                {clipboardOptions.find(o => o.value === settings.clipboardClearSeconds)?.label}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mb-3">{strings.clipboardAutoDesc}</p>
            <div className="flex gap-1">
              {clipboardOptions.map(option => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => onUpdateSettings({ clipboardClearSeconds: option.value })}
                  className={`flex-1 py-1.5 px-1 text-[10px] rounded border transition cursor-pointer ${
                    settings.clipboardClearSeconds === option.value
                      ? 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30 font-bold'
                      : 'bg-gray-50/30 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {option.value === 0 ? 'Off' : `${option.value}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Fingerprint unlock (native Android only) */}
          {biometricAvailable && (
            <div>
              <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-zinc-900/60 rounded-xl border border-gray-200 dark:border-zinc-800 cursor-pointer select-none transition">
                <input
                  type="checkbox"
                  checked={biometricEnabled}
                  disabled={bioBusy}
                  onChange={(e) => void handleBioCheckbox(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-violet-500 cursor-pointer"
                />
                <div>
                  <p className="text-xs font-bold text-gray-800 dark:text-zinc-200 flex items-center gap-1.5">
                    <Fingerprint className="w-3.5 h-3.5 text-violet-500" />
                    {strings.biometricSetting}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {strings.biometricSettingDesc}
                  </p>
                </div>
              </label>

              {bioFormOpen && !biometricEnabled && (
                <form onSubmit={handleBioEnableSubmit} className="mt-3 space-y-2">
                  <label className="text-[11px] font-semibold text-gray-700 dark:text-zinc-300 block">
                    {strings.biometricConfirmPassword}
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder={strings.masterPassword}
                    value={bioSecretInput}
                    onChange={(e) => setBioSecretInput(e.target.value)}
                    className="w-full text-xs p-2.5 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none focus:border-violet-500"
                  />
                  {bioError && (
                    <p role="alert" className="text-[11px] text-rose-500 font-semibold">
                      {bioError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={bioBusy || !bioSecretInput}
                    className="w-full py-2 px-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-60"
                  >
                    <Fingerprint className="w-4 h-4" />
                    {strings.biometricUnlockBtn}
                  </button>
                </form>
              )}
            </div>
          )}
        </AccordionSection>

        {/* Web Display Protections */}
        <AccordionSection
          icon={<Lock className="w-4 h-4 text-emerald-500" />}
          title="Display & Privacy Overlay"
          open={Boolean(openSections.display)}
          onToggle={() => toggleSection('display')}
        >

          <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-zinc-900/60 rounded-xl border border-gray-200 dark:border-zinc-800 cursor-pointer select-none transition">
            <input
              type="checkbox"
              checked={settings.screenshotProtection}
              onChange={(e) => onUpdateSettings({ screenshotProtection: e.target.checked })}
              className="w-4 h-4 mt-0.5 accent-emerald-500 cursor-pointer"
            />
            <div>
              <p className="text-xs font-bold text-gray-800 dark:text-zinc-200">{strings.screenshotProtect}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {strings.screenshotProtectDesc} (Note: browser tabs render an anti-shoulder watermark; OS-level blocking applies to native mobile builds.)
              </p>
            </div>
          </label>
        </AccordionSection>

        {/* Google Drive Zero-Knowledge Encrypted Cloud Backup */}
        <AccordionSection
          icon={<Cloud className="w-4 h-4 text-blue-500" />}
          title="Google Drive Encrypted Backup"
          open={Boolean(openSections.drive)}
          onToggle={() => toggleSection('drive')}
        >
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Your vault is encrypted locally with AES-256-GCM before upload. Google Drive stores only the encrypted `.pishivault.json` file and can only access backup files created by iSecure.
          </p>

          {!driveConnected ? (
            <button
              type="button"
              onClick={handleSignInClick}
              disabled={isDriveBusy}
              className="gsi-material-button w-full py-2.5 px-4 bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 rounded-xl text-xs font-semibold shadow-sm transition cursor-pointer disabled:opacity-60 flex items-center justify-center"
            >
              <div className="gsi-material-button-state" />
              <div className="gsi-material-button-content-wrapper flex items-center justify-center gap-3">
                <div className="gsi-material-button-icon w-4 h-4 flex-shrink-0">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }} aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">Sign in with Google</span>
              </div>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 truncate">
                    {driveUserName || 'Google Account Connected'}
                  </p>
                  {driveUserEmail && (
                    <p className="text-[10px] font-mono text-gray-500 dark:text-zinc-400 truncate">
                      {driveUserEmail}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSignOutClick}
                  disabled={isDriveBusy}
                  className="px-2.5 py-1.5 text-[10px] font-bold text-gray-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg flex items-center gap-1 transition cursor-pointer flex-shrink-0"
                >
                  <LogOut className="w-3 h-3" />
                  Sign out
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDriveNewBackup}
                  disabled={isDriveBusy}
                  className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-60"
                >
                  <Cloud className="w-4 h-4" />
                  {isDriveBusy ? 'Syncing...' : 'Save Backup to Google Drive'}
                </button>
                <button
                  type="button"
                  onClick={handleRefreshList}
                  disabled={isDriveBusy}
                  aria-label="Refresh Google Drive backup list"
                  title="Refresh Google Drive backup list"
                  className="p-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-800 rounded-xl text-gray-600 dark:text-zinc-300 transition cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${isDriveBusy ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Existing Drive Backups */}
              <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-zinc-800">
                <p className="text-[10px] font-mono uppercase text-gray-400">
                  Google Drive Backups ({driveBackups.length})
                </p>
                {driveBackups.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic py-2">
                    No encrypted backups found on Google Drive yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pe-1">
                    {driveBackups.map(file => (
                      <div
                        key={file.id}
                        className="p-2.5 bg-gray-50 dark:bg-zinc-900/70 border border-gray-200 dark:border-zinc-800 rounded-xl space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-mono font-semibold text-gray-800 dark:text-zinc-200 truncate">
                              {file.name}
                            </p>
                            <p className="text-[10px] text-gray-400">
                              {file.modifiedTime
                                ? new Date(file.modifiedTime).toLocaleString(strings.code)
                                : 'Unknown date'}
                              {file.size ? ` · ${Math.max(1, Math.round(Number(file.size) / 1024))} KB` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={isDriveBusy}
                            onClick={() => {
                              setRestoreTarget(file);
                              setDriveRestorePassword('');
                              setDriveRestoreError('');
                            }}
                            className="px-2.5 py-1 text-[10px] font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {strings.restore}
                          </button>
                          <button
                            type="button"
                            disabled={isDriveBusy}
                            onClick={() => setPendingConfirm({ type: 'overwrite', file })}
                            className="px-2.5 py-1 text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-lg flex items-center gap-1 cursor-pointer"
                          >
                            <Upload className="w-3 h-3" />
                            Overwrite
                          </button>
                          <button
                            type="button"
                            disabled={isDriveBusy}
                            onClick={() => setPendingConfirm({ type: 'delete', file })}
                            aria-label={`Delete ${file.name} from Google Drive`}
                            className="px-2.5 py-1 text-[10px] font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 rounded-lg flex items-center gap-1 cursor-pointer ms-auto"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {driveStatus && (
            <div className={`p-3 rounded-xl border text-[11px] flex items-center gap-2 ${
              driveStatus.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
            }`}>
              {driveStatus.type === 'success' ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
              <span>{driveStatus.msg}</span>
            </div>
          )}
        </AccordionSection>

        {/* Local Encrypted File Export / Import */}
        <AccordionSection
          icon={<Lock className="w-4 h-4 text-orange-400" />}
          title={strings.cloudBackupTitle}
          open={Boolean(openSections.local)}
          onToggle={() => toggleSection('local')}
        >
          <p className="text-[11px] text-gray-400 leading-relaxed">
            {strings.cloudBackupDesc} Export or restore your AES-256-GCM encrypted `.pishivault.json` archive locally without sending keys to third-party servers.
          </p>

          <button
            type="button"
            onClick={handleExport}
            disabled={isBusy}
            className="w-full py-2.5 px-4 bg-gray-900 hover:bg-gray-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            Export Encrypted Vault (.pishivault.json)
          </button>

          <form onSubmit={handleImportSubmit} className="pt-3 border-t border-gray-200 dark:border-zinc-800 space-y-3">
            <label className="text-[10px] font-mono text-gray-400 uppercase block">
              Restore from Local Encrypted File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.pishivault"
              onClick={() => onFilePickerOpen?.()}
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="w-full text-[11px] text-gray-500 file:me-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-gray-100 dark:file:bg-zinc-800 file:text-gray-700 dark:file:text-zinc-200 cursor-pointer"
            />
            {selectedFile && (
              <>
                <input
                  type="password"
                  required
                  placeholder="Enter backup Master Password..."
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  className="w-full text-xs p-2.5 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-60"
                >
                  <Upload className="w-4 h-4" />
                  Decrypt & Restore Backup
                </button>
              </>
            )}
          </form>

          {backupStatus && (
            <div className={`p-3 rounded-xl border text-[11px] flex items-center gap-2 ${
              backupStatus.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
            }`}>
              {backupStatus.type === 'success' ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
              <span>{backupStatus.msg}</span>
            </div>
          )}

          <div>
            <label className="text-[10px] font-mono text-gray-400 uppercase block mb-1">
              {strings.backupModeOpt}
            </label>
            <div className="space-y-1.5">
              {[
                { id: 'manual', label: strings.backupManual },
                { id: 'auto', label: strings.backupAuto },
                { id: 'wifi', label: strings.backupWifi },
              ].map(m => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => onUpdateSettings({ backupMode: m.id as UserSettings['backupMode'] })}
                  className={`w-full py-2 px-3 text-xs rounded-lg border text-start flex justify-between items-center transition cursor-pointer ${
                    settings.backupMode === m.id
                      ? 'bg-orange-500/10 text-orange-600 border-orange-500/20 font-bold'
                      : 'bg-transparent border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span>{m.label}</span>
                  {settings.backupMode === m.id && <Check className="w-3.5 h-3.5 text-orange-600" />}
                </button>
              ))}
            </div>
          </div>
        </AccordionSection>

        {/* App Updates (Android in-app updater; hidden on web) */}
        {updaterSupported && (
          <AccordionSection
            icon={<ArrowUpCircle className="w-4 h-4 text-emerald-500" />}
            title={strings.updatesTitle}
            open={Boolean(openSections.updates)}
            onToggle={() => toggleSection('updates')}
          >
            <UpdateSection strings={strings} bare />
          </AccordionSection>
        )}

        {/* About Card */}
        <AccordionSection
          icon={<Info className="w-4 h-4 text-gray-500" />}
          title={strings.aboutTitle}
          open={Boolean(openSections.about)}
          onToggle={() => toggleSection('about')}
        >
          <div className="text-center">
          <img
            src="/icon.png"
            alt="iSecure"
            className="w-12 h-12 rounded-2xl mx-auto"
          />
          <p className="text-[10px] text-gray-400 font-mono mt-1">Zero-Knowledge Password Manager</p>

          <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-4 leading-relaxed text-center">
            {strings.aboutDesc}
          </p>

          <div className="mt-5 text-[10px] font-mono text-gray-500 dark:text-zinc-400 bg-white/60 dark:bg-black/20 p-2.5 rounded-xl border border-gray-200 dark:border-zinc-800">
            Web Crypto API: PBKDF2-SHA256 + AES-256-GCM
          </div>
          </div>
        </AccordionSection>

      {/* Mandatory Confirmation Dialog for Overwrite / Delete on Google Drive */}
      {pendingConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drive-confirm-title"
        >
          <div className="p-6 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 max-w-sm w-full space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white" id="drive-confirm-title">
              <AlertTriangle className={`w-5 h-5 ${pendingConfirm.type === 'delete' ? 'text-rose-500' : 'text-amber-500'}`} />
              <span>
                {pendingConfirm.type === 'delete'
                  ? 'Delete Google Drive Backup?'
                  : 'Overwrite Google Drive Backup?'}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
              {pendingConfirm.type === 'delete'
                ? `Are you sure you want to permanently delete "${pendingConfirm.file.name}" from Google Drive? This action cannot be undone.`
                : `Are you sure you want to overwrite the existing Google Drive backup "${pendingConfirm.file.name}" with your current encrypted vault?`}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 cursor-pointer"
              >
                {strings.cancel}
              </button>
              <button
                type="button"
                onClick={handleExecuteConfirmedDriveAction}
                className={`px-4 py-2 text-xs font-bold rounded-lg text-white cursor-pointer ${
                  pendingConfirm.type === 'delete'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {pendingConfirm.type === 'delete' ? strings.permanentlyDelete : 'Confirm Overwrite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Password Modal for Google Drive Backup */}
      {restoreTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drive-restore-title"
        >
          <form
            onSubmit={handleSubmitDriveRestore}
            className="p-6 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 max-w-sm w-full space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white" id="drive-restore-title">
              <RotateCcw className="w-5 h-5 text-emerald-500" />
              <span>Decrypt & Restore Drive Backup</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Enter the Master Password used when <strong className="font-mono">{restoreTarget.name}</strong> was encrypted.
            </p>
            <input
              type="password"
              required
              autoFocus
              placeholder={strings.masterPassword}
              value={driveRestorePassword}
              onChange={(e) => setDriveRestorePassword(e.target.value)}
              className="w-full text-xs p-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl outline-none focus:border-emerald-500"
            />
            {driveRestoreError && (
              <p role="alert" className="text-xs text-rose-500 font-semibold">
                {driveRestoreError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRestoreTarget(null);
                  setDriveRestorePassword('');
                  setDriveRestoreError('');
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 cursor-pointer"
              >
                {strings.cancel}
              </button>
              <button
                type="submit"
                disabled={isDriveBusy}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-60"
              >
                {isDriveBusy ? 'Decrypting...' : strings.restore}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
