/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed wrapper for the native ApkInstaller Capacitor plugin
 * (android/app/src/main/java/com/isecure/app/ApkInstallerPlugin.java).
 * Native-only: on web these calls reject as unimplemented, and the
 * updater UI is hidden there anyway.
 */

import { registerPlugin } from '@capacitor/core';

export interface ApkInstallerPlugin {
  /** Opens the system package installer for the APK at `path`.
   *  Rejects with code 'INSTALL_PERMISSION' after sending the user to the
   *  "Install unknown apps" settings screen when that permission is off. */
  install(options: { path: string }): Promise<void>;
  /** True when the APK at `path` is signed with the same certificate as
   *  the currently installed app (fail-closed update verification). */
  verifySigner(options: { path: string }): Promise<{ matches: boolean }>;
}

const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller');

export default ApkInstaller;
