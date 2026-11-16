/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed wrapper for the native BiometricUnlock Capacitor plugin
 * (android/app/src/main/java/com/isecure/app/BiometricUnlockPlugin.java).
 * The master secret is stored only as ciphertext in the Android
 * Keystore-backed plugin storage; it never touches localStorage, the
 * vault file, or any server. Native-only: on web these calls reject and
 * the UI hides the feature.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface BiometricPromptStrings {
  title: string;
  subtitle: string;
  cancelLabel: string;
}

interface BiometricUnlockPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  hasStored(): Promise<{ stored: boolean }>;
  storeSecret(
    options: { value: string } & BiometricPromptStrings,
  ): Promise<void>;
  retrieveSecret(
    options: BiometricPromptStrings,
  ): Promise<{ value: string }>;
  clearSecret(): Promise<void>;
}

const BiometricUnlock = registerPlugin<BiometricUnlockPlugin>('BiometricUnlock');

export function isBiometricSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export async function biometricAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return (await BiometricUnlock.isAvailable()).available;
  } catch {
    return false;
  }
}

export async function biometricStored(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return (await BiometricUnlock.hasStored()).stored;
  } catch {
    return false;
  }
}

/** Ask for a fingerprint, then store the secret under the biometric key. */
export async function storeBiometricSecret(
  value: string,
  strings: BiometricPromptStrings,
): Promise<void> {
  await BiometricUnlock.storeSecret({ value, ...strings });
}

/** Ask for a fingerprint and return the stored secret. Rejects with
 *  code 'CANCELLED' when the user dismisses the prompt. */
export async function retrieveBiometricSecret(
  strings: BiometricPromptStrings,
): Promise<string> {
  const { value } = await BiometricUnlock.retrieveSecret(strings);
  return value;
}

export async function clearBiometricSecret(): Promise<void> {
  if (!isBiometricSupported()) return;
  try {
    await BiometricUnlock.clearSecret();
  } catch {
    /* best effort */
  }
}
