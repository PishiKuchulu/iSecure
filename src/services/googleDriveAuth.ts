/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed wrapper for the native GoogleDriveAuth Capacitor plugin
 * (android/app/src/main/java/com/isecure/app/GoogleDriveAuthPlugin.java).
 * Native-only: obtains a Google OAuth access token for the drive.file
 * scope via the Identity Authorization API. On web the Drive layer keeps
 * using Firebase signInWithPopup instead.
 */

import { registerPlugin } from '@capacitor/core';

export interface GoogleDriveAuthPlugin {
  /** Opens the native Google account/consent flow and resolves with an
   *  access token for the drive.file scope. Rejects if the user cancels. */
  signIn(): Promise<{ accessToken: string }>;
}

const GoogleDriveAuth = registerPlugin<GoogleDriveAuthPlugin>('GoogleDriveAuth');

export default GoogleDriveAuth;
