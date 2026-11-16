/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Settings card for the in-app updater (Android only; renders nothing on
 * web). Check → download with progress → SHA-256 + same-signer verified
 * inside the updater service → system installer hand-off.
 */

import React, { useEffect, useState } from 'react';
import {
  RefreshCw,
  Download,
  Check,
  AlertTriangle,
  ArrowUpCircle,
  ShieldCheck,
} from 'lucide-react';
import type { LocaleStrings } from '../locales';
import {
  isUpdaterSupported,
  getCurrentVersion,
  checkForUpdate,
  downloadAndVerifyUpdate,
  installUpdate,
  type UpdateInfo,
} from '../services/updater';

type Phase =
  | { name: 'idle' }
  | { name: 'checking' }
  | { name: 'upToDate' }
  | { name: 'available'; info: UpdateInfo }
  | { name: 'downloading'; info: UpdateInfo; pct: number }
  | { name: 'ready'; info: UpdateInfo; path: string }
  | { name: 'permission'; info: UpdateInfo; path: string }
  | { name: 'error'; msg: string };

function formatSize(bytes: number): string {
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function UpdateSection({
  strings,
  bare = false,
}: {
  strings: LocaleStrings;
  /** Render without the card chrome and header (used inside the
   *  Settings accordion, which provides both). */
  bare?: boolean;
}) {
  const supported = isUpdaterSupported();
  const [current, setCurrent] = useState<string>('');
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });

  useEffect(() => {
    if (supported) {
      void getCurrentVersion().then(setCurrent).catch(() => setCurrent(''));
    }
  }, [supported]);

  if (!supported) return null;

  const handleCheck = async () => {
    setPhase({ name: 'checking' });
    try {
      const result = await checkForUpdate(true);
      setPhase(
        result.kind === 'available'
          ? { name: 'available', info: result.info }
          : { name: 'upToDate' },
      );
    } catch (err) {
      setPhase({
        name: 'error',
        msg: err instanceof Error ? err.message : strings.updateFailedMsg,
      });
    }
  };

  const handleDownload = async (info: UpdateInfo) => {
    setPhase({ name: 'downloading', info, pct: 0 });
    try {
      const path = await downloadAndVerifyUpdate(info, (pct) =>
        setPhase({ name: 'downloading', info, pct }),
      );
      setPhase({ name: 'ready', info, path });
    } catch (err) {
      setPhase({
        name: 'error',
        msg: err instanceof Error ? err.message : strings.updateFailedMsg,
      });
    }
  };

  const handleInstall = async (info: UpdateInfo, path: string) => {
    try {
      await installUpdate(path);
    } catch (err) {
      if ((err as { code?: string })?.code === 'INSTALL_PERMISSION') {
        setPhase({ name: 'permission', info, path });
      } else {
        setPhase({
          name: 'error',
          msg: err instanceof Error ? err.message : strings.updateFailedMsg,
        });
      }
    }
  };

  const busy =
    phase.name === 'checking' || phase.name === 'downloading';

  const body = (
    <>
      <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
        {strings.updatesDesc}
      </p>

      <div className="flex items-center justify-between text-[11px] font-mono text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-zinc-950 p-2.5 rounded-xl border border-gray-200 dark:border-zinc-800">
        <span>{strings.currentVersionLabel}</span>
        <span className="font-bold text-gray-900 dark:text-zinc-100">
          {current ? `v${current}` : '…'}
        </span>
      </div>

      {phase.name === 'upToDate' && (
        <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-600">
          <Check className="w-3.5 h-3.5" />
          <span>{strings.upToDateMsg}</span>
        </div>
      )}

      {(phase.name === 'available' ||
        phase.name === 'downloading' ||
        phase.name === 'ready' ||
        phase.name === 'permission') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-gray-900 dark:text-zinc-100">
              {strings.updateAvailableMsg}
            </span>
            <span className="font-mono text-gray-500 dark:text-zinc-400">
              {strings.latestVersionLabel}: v{phase.info.version}
              {phase.info.apkSize
                ? ` • ${formatSize(phase.info.apkSize)}`
                : ''}
            </span>
          </div>

          {phase.info.notes && (
            <div>
              <div className="text-[10px] font-bold text-gray-400 mb-1">
                {strings.whatsNew}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-2.5 rounded-xl border border-gray-200 dark:border-zinc-800">
                {phase.info.notes}
              </div>
            </div>
          )}

          {phase.name === 'downloading' && (
            <div className="space-y-1.5">
              <div className="h-2 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${phase.pct}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-gray-400">
                {phase.pct < 100
                  ? `${strings.downloadingMsg} ${phase.pct}%`
                  : strings.verifyingMsg}
              </div>
            </div>
          )}

          {phase.name === 'ready' && (
            <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-600">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>SHA-256 ✓ • Signer ✓</span>
            </div>
          )}

          {phase.name === 'permission' && (
            <div className="flex items-start gap-2 text-[11px] text-amber-600 leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{strings.installPermissionMsg}</span>
            </div>
          )}

          {phase.name === 'available' && (
            <button
              type="button"
              onClick={() => void handleDownload(phase.info)}
              className="w-full py-2 px-3 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              {strings.downloadUpdate}
            </button>
          )}

          {(phase.name === 'ready' || phase.name === 'permission') && (
            <button
              type="button"
              onClick={() => void handleInstall(phase.info, phase.path)}
              className="w-full py-2 px-3 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              {strings.installUpdate}
            </button>
          )}
        </div>
      )}

      {phase.name === 'error' && (
        <div className="flex items-start gap-2 text-[11px] text-rose-500 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {strings.updateFailedMsg} {phase.msg}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleCheck()}
        disabled={busy}
        className="w-full py-2 px-3 text-xs rounded-lg border border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-900 font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 ${phase.name === 'checking' ? 'animate-spin' : ''}`}
        />
        {phase.name === 'checking'
          ? strings.checkingUpdates
          : strings.checkForUpdates}
      </button>
    </>
  );

  if (bare) return <div className="space-y-4">{body}</div>;
  return (
    <div className="p-5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl space-y-4">
      <div className="flex items-center gap-2">
        <ArrowUpCircle className="w-4 h-4 text-emerald-500" />
        <h4 className="text-xs font-bold text-gray-900 dark:text-zinc-100">
          {strings.updatesTitle}
        </h4>
      </div>
      {body}
    </div>
  );
}
