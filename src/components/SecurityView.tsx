/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldAlert, ShieldCheck, ArrowRight } from 'lucide-react';
import { VaultEntry } from '../types';
import { LocaleStrings } from '../locales';
import { auditVault, calculateEntropy } from '../utils';

interface SecurityViewProps {
  entries: VaultEntry[];
  strings: LocaleStrings;
  onNavigateToEntry: (entry: VaultEntry) => void;
}

export default function SecurityView({
  entries,
  strings,
  onNavigateToEntry,
}: SecurityViewProps) {
  const { weakIds, reusedIds, oldIds, score } = auditVault(entries);
  const activeEntries = entries.filter(e => !e.isTrash);

  const weakEntries = activeEntries.filter(e => weakIds.includes(e.id));
  const reusedEntries = activeEntries.filter(e => reusedIds.includes(e.id));
  const oldEntries = activeEntries.filter(e => oldIds.includes(e.id));

  const getScoreColor = () => {
    if (score >= 80) return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25';
    if (score >= 50) return 'text-amber-500 bg-amber-500/10 border-amber-500/25';
    return 'text-rose-500 bg-rose-500/10 border-rose-500/25';
  };

  return (
    <div className="space-y-6" id="security_auditor_wrapper">
      {/* Top audit card summary */}
      <div className={`p-6 border rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 ${getScoreColor()}`}>
        <div className="flex items-start gap-4">
          <div className="p-3 bg-white/80 dark:bg-zinc-900/60 rounded-2xl">
            {score >= 80 ? (
              <ShieldCheck className="w-8 h-8 text-emerald-500" />
            ) : (
              <ShieldAlert className="w-8 h-8 text-rose-500" />
            )}
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-zinc-100">{strings.auditTitle}</h2>
            <p className="text-xs text-gray-500 mt-1 dark:text-zinc-300">
              {strings.auditScoreDesc}
            </p>
            <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 bg-current rounded-full" />
              {strings.auditSecureDesc}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div className="text-4xl font-mono font-black">{score}%</div>
          <span className="text-[10px] font-mono tracking-widest uppercase opacity-75 mt-1">SECURITY SCORE</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* WEAK PASSWORDS SECTION */}
        <div className="p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl">
          <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-zinc-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-500 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              {strings.weak}
            </h3>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-rose-500/10 text-rose-500">
              {weakEntries.length} items
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 mb-4 leading-relaxed">
            {strings.auditWeakDesc}
          </p>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {weakEntries.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400 border border-dashed border-gray-200 dark:border-zinc-800 rounded-xl">
                ✔ Zero weak passwords. Great job!
              </div>
            ) : (
              weakEntries.map(entry => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => onNavigateToEntry(entry)}
                  className="w-full p-3 bg-gray-50 hover:bg-gray-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-900 border border-gray-200 dark:border-zinc-800/40 rounded-xl cursor-pointer flex justify-between items-center transition text-start"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-800 dark:text-zinc-200 truncate">{entry.title}</p>
                    <p className="text-[10px] font-mono text-gray-400 truncate">{entry.username}</p>
                    <span className="inline-block mt-1 text-[9px] font-mono font-semibold text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded">
                      Entropy: {calculateEntropy(entry.password || '')} bits
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* REUSED PASSWORDS SECTION */}
        <div className="p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl">
          <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-zinc-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              {strings.reused}
            </h3>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-amber-500/10 text-amber-500">
              {reusedEntries.length} items
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 mb-4 leading-relaxed">
            {strings.auditReuseDesc}
          </p>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {reusedEntries.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400 border border-dashed border-gray-200 dark:border-zinc-800 rounded-xl">
                ✔ No reused keys found. Pristine hygiene.
              </div>
            ) : (
              reusedEntries.map(entry => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => onNavigateToEntry(entry)}
                  className="w-full p-3 bg-gray-50 hover:bg-gray-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-900 border border-gray-200 dark:border-zinc-800/40 rounded-xl cursor-pointer flex justify-between items-center transition text-start"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-800 dark:text-zinc-200 truncate">{entry.title}</p>
                    <p className="text-[10px] font-mono text-gray-400 truncate">{entry.username}</p>
                    <span className="inline-block mt-1 text-[9px] font-mono font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      Shared Key Detected
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* OLD PASSWORDS SECTION */}
        <div className="p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl">
          <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-zinc-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
              {strings.old}
            </h3>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-blue-500/10 text-blue-400">
              {oldEntries.length} items
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 mb-4 leading-relaxed">
            {strings.auditOldDesc}
          </p>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {oldEntries.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400 border border-dashed border-gray-200 dark:border-zinc-800 rounded-xl">
                ✔ All items are fresh. No obsolete entries!
              </div>
            ) : (
              oldEntries.map(entry => {
                const daysOld = Math.floor((Date.now() - new Date(entry.modifiedDate).getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <button
                    type="button"
                    key={entry.id}
                    onClick={() => onNavigateToEntry(entry)}
                    className="w-full p-3 bg-gray-50 hover:bg-gray-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-900 border border-gray-200 dark:border-zinc-800/40 rounded-xl cursor-pointer flex justify-between items-center transition text-start"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-800 dark:text-zinc-200 truncate">{entry.title}</p>
                      <p className="text-[10px] font-mono text-gray-400 truncate">{entry.username}</p>
                      <span className="inline-block mt-1 text-[9px] font-mono font-semibold text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">
                        Last saved: {daysOld} days ago
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
