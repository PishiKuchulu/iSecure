/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Shield, Key, Star, FileText, Download, Clock, HardDrive,
  AlertTriangle, CheckCircle, ChevronRight, Lock, Cloud
} from 'lucide-react';
import { VaultEntry } from '../types';
import { LocaleStrings } from '../locales';
import { auditVault } from '../utils';

interface DashboardViewProps {
  entries: VaultEntry[];
  strings: LocaleStrings;
  lastSyncTime: string;
  driveConnected: boolean;
  onExportBackup: () => Promise<void>;
  onDriveBackup: () => Promise<void>;
  onNavigate: (tab: string) => void;
  onSelectEntry: (entry: VaultEntry) => void;
}

export default function DashboardView({
  entries,
  strings,
  lastSyncTime,
  driveConnected,
  onExportBackup,
  onDriveBackup,
  onNavigate,
  onSelectEntry,
}: DashboardViewProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);
  const [driveBannerMsg, setDriveBannerMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { weakIds, reusedIds, oldIds, score } = auditVault(entries);

  const activeEntries = entries.filter(e => !e.isTrash);
  const favorites = activeEntries.filter(e => e.isFavorite);
  const secureNotes = activeEntries.filter(e => e.entryType === 'note');

  // Sort by modified date descending for recent access
  const recentEntries = [...activeEntries]
    .sort((a, b) => new Date(b.modifiedDate).getTime() - new Date(a.modifiedDate).getTime())
    .slice(0, 3);

  const handleTriggerExport = async () => {
    setIsExporting(true);
    try {
      await onExportBackup();
    } finally {
      setIsExporting(false);
    }
  };

  const handleTriggerDriveBackup = async () => {
    if (!driveConnected) {
      onNavigate('settings');
      return;
    }
    setIsDriveSyncing(true);
    setDriveBannerMsg(null);
    try {
      await onDriveBackup();
      setDriveBannerMsg({ ok: true, text: 'Encrypted backup saved to Google Drive.' });
    } catch (err) {
      setDriveBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Google Drive backup failed.',
      });
    } finally {
      setIsDriveSyncing(false);
    }
  };

  // Color matching based on audit score
  const getScoreColor = () => {
    if (score >= 80) return 'text-emerald-500 stroke-emerald-500';
    if (score >= 50) return 'text-amber-500 stroke-amber-500';
    return 'text-rose-500 stroke-rose-500';
  };

  const getScoreBg = () => {
    if (score >= 80) return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    if (score >= 50) return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
  };

  const ringRadius = 20;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (score / 100) * ringCircumference;

  return (
    <div className="space-y-6" id="dashboard_view_wrapper">
      {/* Backup State Bar */}
      <div className="p-4 bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{strings.lastBackup}</p>
              <p className="font-mono text-xs font-semibold text-gray-800 dark:text-zinc-200">
                {lastSyncTime ? new Date(lastSyncTime).toLocaleString(strings.code) : strings.never}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap w-full sm:w-auto gap-2">
            <button
              type="button"
              onClick={handleTriggerDriveBackup}
              disabled={isDriveSyncing}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-60"
            >
              <Cloud className="w-3.5 h-3.5" />
              {driveConnected
                ? isDriveSyncing
                  ? 'Uploading...'
                  : 'Backup to Google Drive'
                : 'Connect Google Drive'}
            </button>
            <button
              type="button"
              onClick={handleTriggerExport}
              disabled={isExporting}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-60"
              id="btn_trigger_sync"
            >
              <Download className="w-3.5 h-3.5" />
              {isExporting ? 'Exporting...' : 'Export File'}
            </button>
          </div>
        </div>
        {driveBannerMsg && (
          <p className={`text-[11px] font-medium ${driveBannerMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
            {driveBannerMsg.text}
          </p>
        )}
      </div>

      {/* Grid Specs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Passwords */}
        <button
          type="button"
          onClick={() => onNavigate('vault')}
          className="p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800/80 rounded-2xl cursor-pointer hover:border-gray-300 dark:hover:border-zinc-700 transition text-start w-full"
        >
          <div className="flex justify-between items-start">
            <span className="p-2 bg-gray-100 dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 rounded-xl">
              <Key className="w-5 h-5" />
            </span>
            <span className="text-3xl font-mono font-bold text-gray-900 dark:text-white">
              {activeEntries.length}
            </span>
          </div>
          <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400">{strings.totalPasswords}</p>
        </button>

        {/* Favorites */}
        <button
          type="button"
          onClick={() => onNavigate('vault')}
          className="p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800/80 rounded-2xl cursor-pointer hover:border-gray-300 dark:hover:border-zinc-700 transition text-start w-full"
        >
          <div className="flex justify-between items-start">
            <span className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
              <Star className="w-5 h-5 fill-amber-500/20" />
            </span>
            <span className="text-3xl font-mono font-bold text-gray-900 dark:text-white">
              {favorites.length}
            </span>
          </div>
          <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400">{strings.favorites}</p>
        </button>

        {/* Secure Notes */}
        <button
          type="button"
          onClick={() => onNavigate('vault')}
          className="p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800/80 rounded-2xl cursor-pointer hover:border-gray-300 dark:hover:border-zinc-700 transition text-start w-full"
        >
          <div className="flex justify-between items-start">
            <span className="p-2 bg-teal-500/10 text-teal-500 rounded-xl">
              <FileText className="w-5 h-5" />
            </span>
            <span className="text-3xl font-mono font-bold text-gray-900 dark:text-white">
              {secureNotes.length}
            </span>
          </div>
          <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400">{strings.secureNotes}</p>
        </button>

        {/* Security Assessment Score */}
        <button
          type="button"
          onClick={() => onNavigate('audit')}
          className="p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800/80 rounded-2xl cursor-pointer hover:border-gray-300 dark:hover:border-zinc-700 transition text-start w-full"
        >
          <div className="flex justify-between items-start">
            <span className="p-2 bg-indigo-500/10 text-indigo-500 rounded-xl">
              <Shield className="w-5 h-5" />
            </span>
            <div className="relative w-12 h-12 flex items-center justify-center">
              <svg className="w-12 h-12 transform -rotate-90" aria-hidden="true">
                <circle
                  cx="24"
                  cy="24"
                  r={ringRadius}
                  className="stroke-gray-200 dark:stroke-zinc-800"
                  strokeWidth="4"
                  fill="transparent"
                />
                <circle
                  cx="24"
                  cy="24"
                  r={ringRadius}
                  className={`transition-all duration-500 ${getScoreColor()}`}
                  strokeWidth="4"
                  fill="transparent"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <span className="absolute text-[10px] font-mono font-bold text-gray-900 dark:text-white">
                {score}%
              </span>
            </div>
          </div>
          <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400">{strings.securityScore}</p>
        </button>
      </div>

      {/* Main Stats Split Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Recent Accesses - Left */}
        <div className="lg:col-span-3 p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              {strings.recentAccess}
            </h3>
            <p className="text-xs text-gray-400 mt-1">Recently created or modified items.</p>

            <div className="mt-4 space-y-3">
              {recentEntries.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400 border border-dashed border-gray-200 dark:border-zinc-800 rounded-xl">
                  {strings.noEntries}
                </div>
              ) : (
                recentEntries.map(entry => (
                  <button
                    type="button"
                    key={entry.id}
                    onClick={() => {
                      onNavigate('vault');
                      onSelectEntry(entry);
                    }}
                    className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-900 border border-gray-100 dark:border-zinc-800/50 rounded-xl cursor-pointer transition text-start"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-zinc-800 flex items-center justify-center font-bold text-gray-600 dark:text-zinc-300 text-xs uppercase flex-shrink-0">
                        {entry.title.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-semibold text-gray-800 dark:text-zinc-200 truncate">{entry.title}</h4>
                        <p className="text-[10px] font-mono text-gray-400 truncate">{entry.username}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="px-2 py-0.5 text-[9px] font-mono rounded bg-gray-200 dark:bg-zinc-800 text-gray-500 uppercase">
                        {entry.category}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end">
            <button
              type="button"
              onClick={() => onNavigate('vault')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              Browse complete vault list
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Security Audit Breakdown - Right */}
        <div className="lg:col-span-2 p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-500" />
              {strings.auditTitle}
            </h3>

            <div className={`mt-4 p-4 rounded-xl border flex items-center gap-3 ${getScoreBg()}`}>
              {score >= 80 ? (
                <CheckCircle className="w-8 h-8 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-8 h-8 flex-shrink-0" />
              )}
              <div>
                <p className="text-xs font-bold font-mono">Vault Integrity: {score}%</p>
                <p className="text-[11px] opacity-90 mt-0.5">
                  {score >= 85
                    ? 'Excellent security health coverage.'
                    : score >= 60
                    ? 'Good, but has potential vulnerabilities.'
                    : 'System alert: please fix weak or reused passwords.'}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-zinc-800/80">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  {strings.weak}
                </span>
                <span className="font-mono text-xs font-bold text-rose-500">{weakIds.length}</span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-zinc-800/80">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  {strings.reused}
                </span>
                <span className="font-mono text-xs font-bold text-amber-500">{reusedIds.length}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                  {strings.old}
                </span>
                <span className="font-mono text-xs font-bold text-blue-400">{oldIds.length}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('audit')}
            className="mt-6 w-full py-2 bg-indigo-500/10 hover:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-semibold text-center transition cursor-pointer"
          >
            Launch Full Audit Scanner
          </button>
        </div>
      </div>

      {/* Zero-Knowledge Web Crypto Banner */}
      <div className="p-4 bg-gradient-to-r from-gray-900 to-indigo-950 text-white rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg text-indigo-300">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold">iSecure Web Crypto Zero-Knowledge Active</h4>
            <p className="text-[10px] text-zinc-300 mt-0.5">
              PBKDF2-HMAC-SHA256 (600,000 iterations) & AES-256-GCM authenticated client-side vault encryption.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('blueprints')}
          className="px-3 py-1.5 bg-white text-gray-900 rounded-lg text-[10px] font-bold hover:bg-gray-100 transition cursor-pointer flex-shrink-0"
        >
          View Specs
        </button>
      </div>
    </div>
  );
}
