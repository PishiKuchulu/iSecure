/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Plus, Edit, Trash2, Heart, Copy, Check, ExternalLink, Search,
  Folder, Calendar, Star, Eye, EyeOff, History,
  Globe, Mail, CreditCard, Users, Gamepad2, Landmark,
  Trash, FileText, ChevronRight, X, Shield
} from 'lucide-react';
import { VaultEntry, EntryType, CustomField } from '../types';
import { LocaleStrings } from '../locales';
import { calculateEntropy, getPasswordStrength, getSafeExternalUrl } from '../utils';
import { copyTextWithAutoClear } from '../services/clipboard';

interface VaultViewProps {
  entries: VaultEntry[];
  strings: LocaleStrings;
  customCategories: string[];
  clipboardClearSeconds: number;
  selectedEntryFromOutside: VaultEntry | null;
  onClearOutsideSelectedEntry: () => void;
  onAddEntry: (entry: Omit<VaultEntry, 'id' | 'createdDate' | 'modifiedDate' | 'history' | 'isTrash'>) => void;
  onEditEntry: (id: string, entry: Partial<VaultEntry>) => void;
  onDeleteEntry: (id: string) => void;
  onPermanentlyDelete: (id: string) => void;
  onRestoreEntry: (id: string) => void;
  onPurgeTrash: () => void;
  onAddCustomCategory: (cat: string) => void;
}

export default function VaultView({
  entries,
  strings,
  customCategories,
  clipboardClearSeconds,
  selectedEntryFromOutside,
  onClearOutsideSelectedEntry,
  onAddEntry,
  onEditEntry,
  onDeleteEntry,
  onPermanentlyDelete,
  onRestoreEntry,
  onPurgeTrash,
  onAddCustomCategory,
}: VaultViewProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const selectedEntry = entries.find(e => e.id === selectedEntryId) ?? null;

  // Clipboard copy & shredder feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [clipboardTimer, setClipboardTimer] = useState<number>(0);

  // Form Modal controls
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [formType, setFormType] = useState<EntryType>('website');

  // Custom categories helper
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formCategory, setFormCategory] = useState('Personal');
  const [formCustomFields, setFormCustomFields] = useState<CustomField[]>([]);

  // Password Visibility Toggles
  const [showPasswordInDetails, setShowPasswordInDetails] = useState(false);
  const [showPasswordInForm, setShowPasswordInForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revealedCustomIdx, setRevealedCustomIdx] = useState<number | null>(null);

  const defaultCategories = [
    'Banking', 'Social Media', 'Email', 'Work', 'Shopping', 'Gaming', 'Crypto', 'Personal', 'Other'
  ];

  // Deduplicate categories case-insensitively
  const allCategories = defaultCategories.concat(
    customCategories.filter(
      c => !defaultCategories.some(d => d.toLowerCase() === c.toLowerCase())
    )
  );

  // Sync outside-selected item if launched from Dashboard or Security Auditor
  useEffect(() => {
    if (selectedEntryFromOutside) {
      setSelectedEntryId(selectedEntryFromOutside.id);
      setShowPasswordInDetails(false);
      setShowHistory(false);
      if (selectedEntryFromOutside.isTrash) {
        setActiveCategory('trash');
      } else if (selectedEntryFromOutside.isFavorite) {
        setActiveCategory('favorites');
      } else {
        setActiveCategory('all');
      }
      onClearOutsideSelectedEntry();
    }
  }, [selectedEntryFromOutside, onClearOutsideSelectedEntry]);

  // Escape key closes Add/Edit modal
  useEffect(() => {
    if (!isFormOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFormOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFormOpen]);

  // Visual countdown only. The actual clipboard clear is owned by the
  // module-level clipboard service (services/clipboard.ts), so it still
  // happens if this view unmounts before the countdown ends (P-04).
  useEffect(() => {
    if (clipboardTimer <= 0) return;
    const interval = setInterval(() => {
      setClipboardTimer(prev => {
        if (prev <= 1) {
          setCopiedField(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [clipboardTimer]);

  const [copyFailedField, setCopyFailedField] = useState<string | null>(null);

  const triggerClipboardCopy = (text: string, label: string) => {
    void copyTextWithAutoClear(text, clipboardClearSeconds).then(ok => {
      if (ok) {
        setCopyFailedField(null);
        setCopiedField(label);
        if (clipboardClearSeconds > 0) {
          setClipboardTimer(clipboardClearSeconds);
        } else {
          setClipboardTimer(0);
          setTimeout(() => setCopiedField(prev => (prev === label ? null : prev)), 2000);
        }
      } else {
        // Honest failure state instead of a false "Copied" (P-04).
        setCopiedField(null);
        setCopyFailedField(label);
        setTimeout(() => setCopyFailedField(prev => (prev === label ? null : prev)), 3000);
      }
    });
  };

  const entryTypes: { id: EntryType; label: string; icon: React.ReactNode }[] = [
    { id: 'website', label: 'Website login', icon: <Landmark className="w-3.5 h-3.5" /> },
    { id: 'email', label: 'Email account', icon: <Mail className="w-3.5 h-3.5" /> },
    { id: 'bank', label: 'Bank Account / Card', icon: <CreditCard className="w-3.5 h-3.5" /> },
    { id: 'social', label: 'Social Media', icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'gaming', label: 'Gaming Account', icon: <Gamepad2 className="w-3.5 h-3.5" /> },
    { id: 'crypto', label: 'Crypto wallet address', icon: <Globe className="w-3.5 h-3.5" /> },
    { id: 'license', label: 'Software License', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'note', label: 'Secure note', icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'custom', label: 'Custom entry', icon: <Plus className="w-3.5 h-3.5" /> },
  ];

  const getEntryIcon = (type: EntryType) => {
    switch (type) {
      case 'bank': return <CreditCard className="w-4 h-4 text-rose-500" />;
      case 'social': return <Users className="w-4 h-4 text-sky-500" />;
      case 'email': return <Mail className="w-4 h-4 text-emerald-500" />;
      case 'gaming': return <Gamepad2 className="w-4 h-4 text-violet-500" />;
      case 'crypto': return <Globe className="w-4 h-4 text-amber-500" />;
      case 'note': return <Shield className="w-4 h-4 text-indigo-500" />;
      case 'license': return <FileText className="w-4 h-4 text-orange-500" />;
      default: return <Globe className="w-4 h-4 text-blue-500" />;
    }
  };

  const filteredEntries = entries.filter(entry => {
    if (activeCategory === 'trash') {
      if (!entry.isTrash) return false;
    } else {
      if (entry.isTrash) return false;
    }

    if (activeCategory === 'favorites' && !entry.isFavorite) return false;
    if (activeCategory !== 'all' && activeCategory !== 'favorites' && activeCategory !== 'trash') {
      if (entry.category.toLowerCase() !== activeCategory.toLowerCase()) return false;
    }

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchesTitle = entry.title.toLowerCase().includes(q);
      const matchesUser = entry.username.toLowerCase().includes(q);
      const matchesUrl = entry.url?.toLowerCase().includes(q) || false;
      const matchesCategory = entry.category.toLowerCase().includes(q);
      const matchesTags = entry.tags.some(t => t.toLowerCase().includes(q));
      return matchesTitle || matchesUser || matchesUrl || matchesCategory || matchesTags;
    }

    return true;
  });

  const handleSelectEntry = (entry: VaultEntry) => {
    setSelectedEntryId(entry.id);
    setShowPasswordInDetails(false);
    setShowHistory(false);
    setRevealedCustomIdx(null);
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (trimmed) {
      onAddCustomCategory(trimmed);
      setFormCategory(trimmed);
      setNewCategoryName('');
      setShowCategoryInput(false);
    }
  };

  const handleAddCustomField = () => {
    setFormCustomFields([...formCustomFields, { label: '', value: '', isSecret: false }]);
  };

  const handleUpdateCustomField = <K extends keyof CustomField>(index: number, key: K, val: CustomField[K]) => {
    const updated = [...formCustomFields];
    updated[index] = { ...updated[index], [key]: val };
    setFormCustomFields(updated);
  };

  const handleRemoveCustomField = (index: number) => {
    setFormCustomFields(formCustomFields.filter((_, idx) => idx !== index));
  };

  const handleOpenAddForm = () => {
    setFormMode('add');
    setFormType('website');
    setFormTitle('');
    setFormUsername('');
    setFormPassword('');
    setFormUrl('');
    setFormNotes('');
    setFormTags('');
    setFormCategory('Personal');
    setFormCustomFields([]);
    setShowPasswordInForm(false);
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (entry: VaultEntry) => {
    setFormMode('edit');
    setFormType(entry.entryType);
    setFormTitle(entry.title);
    setFormUsername(entry.username);
    setFormPassword(entry.password || '');
    setFormUrl(entry.url || '');
    setFormNotes(entry.notes || '');
    setFormTags(entry.tags.join(', '));
    setFormCategory(entry.category);
    setFormCustomFields(entry.customFields || []);
    setShowPasswordInForm(false);
    setIsFormOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    const parsedTags = formTags
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const payload = {
      title: formTitle.trim(),
      username: formUsername.trim(),
      password: formPassword,
      url: formUrl.trim(),
      notes: formNotes,
      tags: parsedTags,
      category: formCategory,
      entryType: formType,
      isFavorite: formMode === 'edit' && selectedEntry ? selectedEntry.isFavorite : false,
      customFields: formCustomFields.filter(f => f.label.trim() !== '' || f.value.trim() !== ''),
    };

    if (formMode === 'add') {
      onAddEntry(payload);
    } else if (formMode === 'edit' && selectedEntry) {
      onEditEntry(selectedEntry.id, payload);
    }

    setIsFormOpen(false);
  };

  const currentEntropy = calculateEntropy(selectedEntry?.password || '');
  const currentStrength = getPasswordStrength(selectedEntry?.password || '');
  const safeUrl = getSafeExternalUrl(selectedEntry?.url);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="vault_view_workspace">
      {/* 1. SIDEBAR NAVIGATION */}
      <div className="lg:col-span-3 space-y-4">
        <button
          type="button"
          onClick={handleOpenAddForm}
          className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
          id="btn_open_add_form"
        >
          <Plus className="w-4 h-4" />
          {strings.addEntry}
        </button>

        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-[10px] font-mono tracking-wider text-gray-400 uppercase font-bold">NAVIGATION</h3>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => { setActiveCategory('all'); setSelectedEntryId(null); }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition text-start cursor-pointer ${
                activeCategory === 'all'
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold'
                  : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-blue-500" />
                All Items
              </span>
              <span className="font-mono text-[10px] bg-gray-100 dark:bg-zinc-900 rounded px-1.5 py-0.5 text-gray-500">
                {entries.filter(e => !e.isTrash).length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveCategory('favorites'); setSelectedEntryId(null); }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition text-start cursor-pointer ${
                activeCategory === 'favorites'
                  ? 'bg-amber-500/10 text-amber-600 font-bold'
                  : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-amber-500 fill-amber-500/15" />
                {strings.favorites}
              </span>
              <span className="font-mono text-[10px] bg-gray-100 dark:bg-zinc-900 rounded px-1.5 py-0.5 text-gray-500">
                {entries.filter(e => e.isFavorite && !e.isTrash).length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveCategory('trash'); setSelectedEntryId(null); }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition text-start cursor-pointer ${
                activeCategory === 'trash'
                  ? 'bg-rose-500/10 text-rose-500 font-bold'
                  : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <Trash className="w-4 h-4 text-rose-500" />
                {strings.trashBin}
              </span>
              <span className="font-mono text-[10px] bg-gray-100 dark:bg-zinc-900 rounded px-1.5 py-0.5 text-gray-400">
                {entries.filter(e => e.isTrash).length}
              </span>
            </button>
          </div>

          <div className="h-px bg-gray-200 dark:bg-zinc-800 my-2" />

          <div className="flex justify-between items-center pb-1">
            <h3 className="text-[10px] font-mono tracking-wider text-gray-400 uppercase font-bold">{strings.category}</h3>
            {!showCategoryInput && (
              <button
                type="button"
                onClick={() => setShowCategoryInput(true)}
                className="text-[10px] hover:underline font-bold text-blue-600 dark:text-blue-400 cursor-pointer"
              >
                + Custom
              </button>
            )}
          </div>

          {showCategoryInput && (
            <form onSubmit={handleCreateCategory} className="flex gap-1.5">
              <input
                type="text"
                aria-label="New category name"
                placeholder="New Category..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="flex-1 text-[10px] p-1.5 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded outline-none"
                autoFocus
              />
              <button type="submit" className="px-2 py-1 bg-gray-800 text-white rounded text-[10px] font-bold cursor-pointer">Add</button>
              <button type="button" onClick={() => setShowCategoryInput(false)} className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer">
                {strings.cancel}
              </button>
            </form>
          )}

          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {allCategories.map(cat => {
              const count = entries.filter(e => !e.isTrash && e.category.toLowerCase() === cat.toLowerCase()).length;
              return (
                <button
                  type="button"
                  key={cat}
                  onClick={() => { setActiveCategory(cat); setSelectedEntryId(null); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-xs rounded-lg transition text-start cursor-pointer ${
                    activeCategory.toLowerCase() === cat.toLowerCase()
                      ? 'bg-gray-100 dark:bg-zinc-900 text-gray-900 dark:text-white font-bold'
                      : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="truncate">{cat}</span>
                  {count > 0 && (
                    <span className="font-mono text-[9px] bg-gray-100 dark:bg-zinc-900 rounded px-1.5 py-0.5 text-gray-400">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. MAIN PASSWORDS LISTING */}
      <div className="lg:col-span-5 flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute start-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            type="text"
            aria-label={strings.searchPlaceholder}
            placeholder={strings.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs ps-9 pe-4 py-2.5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl outline-none text-gray-800 dark:text-zinc-200 shadow-sm"
          />
        </div>

        {activeCategory === 'trash' && filteredEntries.length > 0 && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-xl flex items-center justify-between gap-4">
            <span className="text-[10px] leading-tight font-medium">
              Items in trash are automatically purged after 30 days.
            </span>
            <button
              type="button"
              onClick={() => { onPurgeTrash(); setSelectedEntryId(null); }}
              className="px-2.5 py-1 bg-rose-600 text-white rounded text-[10px] font-bold hover:bg-rose-500 transition cursor-pointer flex-shrink-0"
            >
              {strings.purgeAll}
            </button>
          </div>
        )}

        <div className="flex-1 space-y-2 max-h-[500px] overflow-y-auto pe-1">
          {filteredEntries.length === 0 ? (
            <div className="py-16 text-center text-xs text-gray-400 bg-white dark:bg-zinc-950 border border-dashed border-gray-200 dark:border-zinc-800 rounded-2xl">
              {strings.noEntries}
            </div>
          ) : (
            filteredEntries.map(entry => (
              <button
                type="button"
                key={entry.id}
                onClick={() => handleSelectEntry(entry)}
                className={`w-full p-3.5 border rounded-xl cursor-pointer text-start transition flex justify-between items-center ${
                  selectedEntry?.id === entry.id
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-white dark:bg-zinc-950 border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 flex items-center justify-center font-bold text-gray-600 dark:text-zinc-300 flex-shrink-0">
                    {getEntryIcon(entry.entryType)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-gray-800 dark:text-zinc-200 truncate">{entry.title}</h4>
                    <p className="text-[10px] font-mono text-gray-400 mt-0.5 truncate">{entry.username}</p>
                    {entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {entry.tags.map(t => (
                          <span key={t} className="px-1 text-[8px] font-mono rounded bg-gray-100 dark:bg-zinc-900 text-gray-400 font-bold">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {entry.isFavorite && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 3. ITEM DETAILED SECTIONS CARD */}
      <div className="lg:col-span-4" id="details_section_panel">
        {selectedEntry ? (
          <div className="p-5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl space-y-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
                <span className="p-1.5 px-3 bg-gray-100 dark:bg-zinc-900 border border-gray-200/50 dark:border-zinc-800 rounded-lg text-[10px] font-mono uppercase font-bold text-gray-500">
                  {selectedEntry.category}
                </span>

                <div className="flex items-center gap-1.5">
                  {!selectedEntry.isTrash ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onEditEntry(selectedEntry.id, { isFavorite: !selectedEntry.isFavorite })}
                        aria-label={strings.isFavorite}
                        className={`p-2 rounded-lg border transition cursor-pointer ${
                          selectedEntry.isFavorite
                            ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                            : 'border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400'
                        }`}
                        title={strings.isFavorite}
                      >
                        <Star className={`w-3.5 h-3.5 ${selectedEntry.isFavorite ? 'fill-amber-500' : ''}`} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditForm(selectedEntry)}
                        aria-label={strings.editEntry}
                        className="p-2 border border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 hover:text-gray-800 dark:hover:text-zinc-200 rounded-lg transition cursor-pointer"
                        title={strings.editEntry}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onDeleteEntry(selectedEntry.id);
                          setSelectedEntryId(null);
                        }}
                        aria-label={strings.deleteEntry}
                        className="p-2 border border-rose-200/50 dark:border-rose-500/20 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-500 rounded-lg transition cursor-pointer"
                        title={strings.deleteEntry}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onRestoreEntry(selectedEntry.id);
                          setSelectedEntryId(null);
                        }}
                        className="flex items-center gap-1 p-1.5 px-2.5 bg-blue-500/10 text-blue-600 text-[10px] font-bold rounded-lg transition cursor-pointer"
                      >
                        {strings.restore}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onPermanentlyDelete(selectedEntry.id);
                          setSelectedEntryId(null);
                        }}
                        className="flex items-center gap-1 p-1.5 px-2.5 bg-rose-500/10 text-rose-500 text-[10px] font-bold rounded-lg transition cursor-pointer"
                      >
                        {strings.permanentlyDelete}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-4 pt-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100">{selectedEntry.title}</h3>
                  <p className="text-[10px] text-gray-400 font-mono mt-0.5">ID: {selectedEntry.id}</p>
                </div>

                {/* Username field */}
                <div className="p-3 bg-gray-50 dark:bg-zinc-900/60 rounded-xl border border-gray-200 dark:border-zinc-800/80 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[8px] font-mono text-gray-500 uppercase">{strings.username}</p>
                    <p className="text-xs font-mono font-bold text-gray-800 dark:text-zinc-200 mt-0.5 truncate">{selectedEntry.username || '—'}</p>
                  </div>
                  {selectedEntry.username && (
                    <button
                      type="button"
                      onClick={() => triggerClipboardCopy(selectedEntry.username, 'username')}
                      className="p-1 px-1.5 rounded bg-gray-200 dark:bg-zinc-800 text-[10px] font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-300 dark:hover:bg-zinc-700 flex items-center gap-1 transition cursor-pointer flex-shrink-0"
                    >
                      {copiedField === 'username' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      {copiedField === 'username' ? 'Copied' : strings.copy}
                    </button>
                  )}
                </div>

                {/* Password field */}
                {selectedEntry.password && (
                  <div className="p-3 bg-gray-50 dark:bg-zinc-900/60 rounded-xl border border-gray-200 dark:border-zinc-800 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[8px] font-mono text-gray-500 uppercase">{strings.password}</p>
                        <p className="text-xs font-mono font-bold text-gray-800 dark:text-zinc-200 mt-1 select-all break-all">
                          {showPasswordInDetails ? selectedEntry.password : '••••••••••••••••'}
                        </p>
                      </div>

                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setShowPasswordInDetails(!showPasswordInDetails)}
                          aria-label={showPasswordInDetails ? 'Hide password' : 'Show password'}
                          className="p-1.5 rounded border border-gray-200 dark:border-zinc-800 text-gray-500 hover:text-gray-700 dark:hover:text-zinc-300 cursor-pointer"
                        >
                          {showPasswordInDetails ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerClipboardCopy(selectedEntry.password || '', 'password')}
                          className="p-1 px-1.5 rounded bg-gray-200 dark:bg-zinc-800 text-[10px] font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-300 dark:hover:bg-zinc-700 flex items-center gap-1 transition cursor-pointer"
                        >
                          {copiedField === 'password' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          {copiedField === 'password' ? 'Copied' : strings.copy}
                        </button>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-gray-200/50 dark:border-zinc-800 flex items-center justify-between text-[9px] font-mono text-gray-400">
                      <span>Entropy: {currentEntropy} bits</span>
                      <span className={`font-bold transition uppercase ${
                        currentStrength === 'excellent' ? 'text-emerald-500' :
                        currentStrength === 'good' ? 'text-indigo-500' :
                        currentStrength === 'fair' ? 'text-amber-500' : 'text-rose-500'
                      }`}>
                        Strength: {currentStrength}
                      </span>
                    </div>
                  </div>
                )}

                {/* URL Address (sanitized http/https only) */}
                {selectedEntry.url && (
                  <div className="p-3 bg-gray-50 dark:bg-zinc-900/60 rounded-xl border border-gray-200 dark:border-zinc-800/80 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[8px] font-mono text-gray-500 uppercase">{strings.url}</p>
                      <p className="text-[11px] font-mono text-gray-800 dark:text-zinc-300 mt-1 truncate">{selectedEntry.url}</p>
                      {!safeUrl && (
                        <span className="text-[9px] text-rose-500 font-semibold">Blocked unsafe URL scheme</span>
                      )}
                    </div>
                    {safeUrl && (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={strings.launch}
                        className="p-1.5 rounded border border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 flex-shrink-0"
                        title={strings.launch}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                )}

                {/* Custom Fields list */}
                {selectedEntry.customFields && selectedEntry.customFields.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-[10px] font-mono tracking-wider text-gray-500 uppercase font-bold">{strings.customFields}</p>
                    <div className="space-y-1.5">
                      {selectedEntry.customFields.map((field, idx) => (
                        <div key={`${field.label}-${idx}`} className="p-2.5 bg-gray-100/50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[8px] font-mono uppercase text-gray-500">{field.label}</p>
                            <p className="text-xs font-mono font-bold truncate">
                              {field.isSecret && revealedCustomIdx !== idx ? '••••••••••••' : field.value}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {field.isSecret && (
                              <button
                                type="button"
                                aria-label={revealedCustomIdx === idx ? 'Hide field' : 'Reveal field'}
                                onClick={() => setRevealedCustomIdx(revealedCustomIdx === idx ? null : idx)}
                                className="p-1 rounded border border-gray-200 dark:border-zinc-700 text-gray-500 hover:text-gray-700 cursor-pointer"
                              >
                                {revealedCustomIdx === idx ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`Copy ${field.label}`}
                              onClick={() => triggerClipboardCopy(field.value, `custom-${idx}`)}
                              className="p-1 rounded bg-gray-200/70 dark:bg-zinc-800 text-[10px] text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700 cursor-pointer"
                            >
                              {copiedField === `custom-${idx}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {selectedEntry.notes && (
                  <div className="pt-2">
                    <p className="text-[10px] font-mono tracking-wider text-gray-500 uppercase font-bold">{strings.notes}</p>
                    <div className="mt-1 p-3 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl max-h-36 overflow-y-auto">
                      <p className="text-[11px] text-gray-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">{selectedEntry.notes}</p>
                    </div>
                  </div>
                )}

                {/* Password History */}
                {selectedEntry.history && selectedEntry.history.length > 0 && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setShowHistory(!showHistory)}
                      className="flex items-center gap-1.5 text-[10px] font-mono tracking-wider text-blue-600 dark:text-blue-400 uppercase font-bold hover:underline cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      {strings.history} ({selectedEntry.history.length})
                    </button>
                    {showHistory && (
                      <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto">
                        {[...selectedEntry.history].reverse().map(item => (
                          <div key={item.id} className="p-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg flex items-center justify-between gap-2 text-[10px] font-mono">
                            <div className="min-w-0">
                              <p className="truncate text-gray-800 dark:text-zinc-200">{item.password}</p>
                              <p className="text-[9px] text-gray-400">{new Date(item.changedAt).toLocaleString(strings.code)}</p>
                            </div>
                            <button
                              type="button"
                              aria-label="Copy historical password"
                              onClick={() => triggerClipboardCopy(item.password, `hist-${item.id}`)}
                              className="p-1 rounded bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 cursor-pointer flex-shrink-0"
                            >
                              {copiedField === `hist-${item.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between text-[9px] font-mono text-gray-400">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Modified: {new Date(selectedEntry.modifiedDate).toLocaleDateString(strings.code)}
              </span>
              <span>Created: {new Date(selectedEntry.createdDate).toLocaleDateString(strings.code)}</span>
            </div>

            {copiedField && clipboardClearSeconds > 0 && clipboardTimer > 0 && (
              <div className="p-2 bg-indigo-500 text-white rounded-lg text-center text-[10px] font-mono font-bold mt-4">
                Clipboard auto-clear in {clipboardTimer}s
              </div>
            )}
            {copyFailedField && (
              <div className="p-2 bg-rose-500 text-white rounded-lg text-center text-[10px] font-mono font-bold mt-4">
                Copy failed — clipboard unavailable
              </div>
            )}
          </div>
        ) : (
          <div className="py-24 text-center text-xs text-gray-400 bg-gray-50 dark:bg-zinc-900/30 border border-dashed border-gray-200 dark:border-zinc-800 rounded-2xl flex flex-col items-center justify-center gap-3">
            <Shield className="w-8 h-8 text-gray-300 dark:text-zinc-600" />
            <span>Select any entry to inspect decrypted details.</span>
          </div>
        )}
      </div>

      {/* 4. FORM MODAL DIALOG */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vault-entry-modal-title"
        >
          <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 w-full max-w-xl rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[85vh] overflow-hidden text-start">
            <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between bg-gray-50 dark:bg-zinc-900/60">
              <h3 id="vault-entry-modal-title" className="text-sm font-bold text-gray-900 dark:text-zinc-100">
                {formMode === 'add' ? strings.addEntry : strings.editEntry}
              </h3>
              <button
                type="button"
                aria-label={strings.cancel}
                onClick={() => setIsFormOpen(false)}
                className="p-1 px-1.5 rounded-lg border border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-gray-100 dark:border-zinc-800 bg-gray-50/20 dark:bg-zinc-900/20">
              <label className="text-[10px] font-mono tracking-wider font-bold text-gray-400 uppercase block mb-2">{strings.entryType}</label>
              <div className="flex flex-wrap gap-1.5">
                {entryTypes.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFormType(t.id)}
                    className={`px-2.5 py-1.5 text-[10px] rounded-lg border font-semibold flex items-center gap-1 transition cursor-pointer ${
                      formType === t.id
                        ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                        : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {getEntryIcon(t.id)}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleFormSubmit} className="flex-1 p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                    {strings.title} *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Company Workspace"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full text-xs p-2.5 bg-gray-50/50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                    {strings.category}
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full text-xs p-2.5 bg-gray-50/50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none text-gray-800 dark:text-zinc-200"
                  >
                    {allCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                    {strings.username}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. user@example.com"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    className="w-full text-xs p-2.5 bg-gray-50/50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                    {strings.password}
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswordInForm ? 'text' : 'password'}
                      placeholder="••••••••••••••"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      className="w-full text-xs p-2.5 bg-gray-50/50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg pe-10 outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      aria-label={showPasswordInForm ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPasswordInForm(!showPasswordInForm)}
                      className="absolute end-2.5 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                    >
                      {showPasswordInForm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                  {strings.url}
                </label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  className="w-full text-xs p-2.5 bg-gray-50/50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 border-t border-gray-200 dark:border-zinc-800">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-gray-700 dark:text-zinc-300">
                    {strings.customFields}
                  </label>
                  <button
                    type="button"
                    onClick={handleAddCustomField}
                    className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-bold cursor-pointer"
                  >
                    + {strings.addField}
                  </button>
                </div>

                <div className="space-y-2">
                  {formCustomFields.map((field, idx) => (
                    <div key={idx} className="flex gap-2 items-center bg-gray-50 dark:bg-zinc-900 p-2.5 rounded-xl border border-gray-200 dark:border-zinc-800">
                      <input
                        type="text"
                        placeholder={strings.fieldLabel}
                        value={field.label}
                        onChange={(e) => handleUpdateCustomField(idx, 'label', e.target.value)}
                        className="w-1/3 text-[10px] p-1.5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded outline-none"
                      />
                      <input
                        type={field.isSecret ? 'password' : 'text'}
                        placeholder={strings.fieldValue}
                        value={field.value}
                        onChange={(e) => handleUpdateCustomField(idx, 'value', e.target.value)}
                        className="flex-1 text-[10px] p-1.5 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded outline-none"
                      />

                      <label className="flex items-center gap-1 text-[8px] uppercase tracking-wide cursor-pointer select-none text-gray-400 hover:text-gray-600 font-mono">
                        <input
                          type="checkbox"
                          checked={field.isSecret}
                          onChange={(e) => handleUpdateCustomField(idx, 'isSecret', e.target.checked)}
                          className="cursor-pointer"
                        />
                        Secret
                      </label>

                      <button
                        type="button"
                        aria-label="Remove custom field"
                        onClick={() => handleRemoveCustomField(idx)}
                        className="text-rose-500 text-xs p-1 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                  {strings.tags}
                </label>
                <input
                  type="text"
                  placeholder="e.g. admin, finance, recovery"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  className="w-full text-xs p-2.5 bg-gray-50/50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-zinc-300 block mb-1">
                  {strings.notes}
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe secure access credentials..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full text-xs p-2.5 bg-gray-50/50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-zinc-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  {strings.cancel}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  {strings.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
