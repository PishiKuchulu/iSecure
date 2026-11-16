/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type EntryType =
  | 'website'
  | 'email'
  | 'bank'
  | 'social'
  | 'gaming'
  | 'crypto'
  | 'license'
  | 'note'
  | 'custom';

export interface PasswordHistoryItem {
  id: string;
  password: string;
  changedAt: string;
}

export interface CustomField {
  label: string;
  value: string;
  isSecret: boolean;
}

export interface VaultEntry {
  id: string;
  title: string;
  username: string;
  password?: string;
  url?: string;
  notes?: string;
  tags: string[];
  category: string;
  isFavorite: boolean;
  isTrash: boolean;
  deletedAt?: string;
  createdDate: string;
  modifiedDate: string;
  entryType: EntryType;
  history: PasswordHistoryItem[];
  customFields?: CustomField[];
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'amoled' | 'system';
  language: string;
  autoLockMinutes: number; // 0 = disabled, 1, 5, 15, 30
  clipboardClearSeconds: number; // 0 = disabled, 15, 30, 60
  screenshotProtection: boolean;
  backupMode: 'manual' | 'auto' | 'wifi';
}
