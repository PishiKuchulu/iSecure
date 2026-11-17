/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed wrapper for the native AppSecurity Capacitor plugin
 * (android/app/src/main/java/com/isecure/app/AppSecurityPlugin.java).
 * It makes the Settings screenshot-protection toggle control the real
 * OS-level FLAG_SECURE flag on Android (AUD-006). The template's
 * anti-shoulder-surfing watermark overlay was removed in 2.0.2 at the
 * owner's order; the toggle now means exactly the OS-level protection.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AppSecurityPlugin {
  setScreenshotProtection(options: { enabled: boolean }): Promise<void>;
}

const AppSecurity = registerPlugin<AppSecurityPlugin>('AppSecurity');

/** Apply the screenshot-protection setting natively. Best effort: a
 *  bridge failure must never break the settings flow. */
export async function applyScreenshotProtection(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AppSecurity.setScreenshotProtection({ enabled });
  } catch {
    // The startup default (FLAG_SECURE on) remains in effect.
  }
}

export default AppSecurity;
