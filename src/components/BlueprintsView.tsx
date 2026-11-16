/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Database, Code, Terminal, Check, Copy, Search,
  Settings, FolderTree, BookOpen, Fingerprint, ShieldCheck
} from 'lucide-react';
import { blueprints, BlueprintArtifact } from '../blueprints';

export default function BlueprintsView() {
  const [activeCategory, setActiveCategory] = useState<'all' | BlueprintArtifact['category']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState<BlueprintArtifact>(blueprints[0]);
  const [isCopied, setIsCopied] = useState(false);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const categories: { id: 'all' | BlueprintArtifact['category']; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All Artifacts', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'architecture', label: 'Folder structures', icon: <FolderTree className="w-4 h-4" /> },
    { id: 'database', label: 'SQLite & ERD', icon: <Database className="w-4 h-4" /> },
    { id: 'code', label: 'Dart encrypt SDK', icon: <Code className="w-4 h-4" /> },
    { id: 'security', label: 'OS & Anti-Screenshot', icon: <Fingerprint className="w-4 h-4" /> },
    { id: 'strategy', label: 'Pricing Model', icon: <Settings className="w-4 h-4" /> },
  ];

  const filteredArtifacts = blueprints.filter(item => {
    const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(selectedArtifact.content).catch(() => {});
    setIsCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="blueprints_view_main">
      {/* Sidebar with articles and searches */}
      <div className="lg:col-span-4 flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute start-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            type="text"
            aria-label="Search blueprints"
            placeholder="Search blueprints, code, or schemes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs ps-9 pe-4 py-2.5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl outline-none text-gray-800 dark:text-zinc-200"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 p-1 bg-gray-100 dark:bg-zinc-900 rounded-xl border border-gray-200/50 dark:border-zinc-800">
          {categories.map(cat => (
            <button
              type="button"
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id);
                const first = blueprints.find(b => cat.id === 'all' || b.category === cat.id);
                if (first) setSelectedArtifact(first);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] sm:text-xs font-semibold rounded-lg transition cursor-pointer ${
                activeCategory === cat.id
                  ? 'bg-white dark:bg-zinc-950 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700'
              }`}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex-1 flex flex-col gap-2 max-h-[480px] overflow-y-auto pe-1">
          {filteredArtifacts.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400 bg-white dark:bg-zinc-950 border border-dashed border-gray-200 dark:border-zinc-800 rounded-xl">
              No matching specifications found.
            </div>
          ) : (
            filteredArtifacts.map(artifact => (
              <button
                type="button"
                key={artifact.title}
                onClick={() => {
                  setSelectedArtifact(artifact);
                  setIsCopied(false);
                }}
                className={`w-full p-3 border rounded-xl cursor-pointer text-start transition ${
                  selectedArtifact.title === artifact.title
                    ? 'bg-blue-500/10 border-blue-500/20 dark:bg-zinc-900/60'
                    : 'bg-white dark:bg-zinc-950 border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-900'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <h4 className={`text-xs font-bold leading-tight ${selectedArtifact.title === artifact.title ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-zinc-200'}`}>
                    {artifact.title}
                  </h4>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-bold flex-shrink-0 ${
                    artifact.category === 'security' ? 'bg-rose-500/10 text-rose-500' :
                    artifact.category === 'code' ? 'bg-emerald-500/10 text-emerald-500' :
                    artifact.category === 'database' ? 'bg-amber-500/10 text-amber-500' : 'bg-gray-100 dark:bg-zinc-900 text-gray-500'
                  }`}>
                    {artifact.category}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                  {artifact.description}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Code viewer workspace on Right */}
      <div className="lg:col-span-8 flex flex-col bg-slate-900 text-slate-100 rounded-2xl border border-slate-800 overflow-hidden shadow-md">
        <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 ms-4 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-blue-400" />
              pishisecure.{selectedArtifact.language}
            </span>
          </div>

          <button
            type="button"
            onClick={handleCopyCode}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
              isCopied
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {isCopied ? 'Copied' : 'Copy Blueprint'}
          </button>
        </div>

        <div className="p-4 bg-slate-950/40">
          <h3 className="text-sm font-bold text-slate-200">{selectedArtifact.title}</h3>
          <p className="text-[11px] text-slate-400 mt-1">{selectedArtifact.description}</p>
        </div>

        <div className="flex-1 p-4 overflow-auto max-h-[460px]">
          <pre className="font-mono text-xs text-slate-300 leading-relaxed whitespace-pre font-medium" id="blueprint_code_block">
            <code>{selectedArtifact.content}</code>
          </pre>
        </div>

        <div className="p-3 bg-slate-950 border-t border-slate-800 text-[10px] font-mono text-slate-400 flex items-center justify-between">
          <span className="flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            iSecure Reference Architecture Specification
          </span>
          <span>UTF-8 • UNIX line endings</span>
        </div>
      </div>
    </div>
  );
}
