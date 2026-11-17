package com.isecure.app;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;

import java.util.Collections;

/**
 * Native Google authorization for the Drive backup feature, replacing the
 * Firebase signInWithPopup flow that cannot run inside a WebView (the auth
 * handler escapes to Chrome and dies with "The requested action is
 * invalid"). Uses the Google Identity Authorization API to obtain an
 * OAuth access token for the drive.file scope directly; the token is
 * handed to the JS Drive layer, which keeps it strictly in memory.
 *
 * Requires the app's package + release SHA-1 to be registered in the
 * Firebase/GCP project (an Android OAuth client must exist server-side).
 */
@CapacitorPlugin(name = "GoogleDriveAuth")
public class GoogleDriveAuthPlugin extends Plugin {

    private static final int RC_AUTHORIZE = 4107;
    private static final String DRIVE_FILE_SCOPE =
        "https://www.googleapis.com/auth/drive.file";

    private PluginCall pendingCall;

    @PluginMethod
    public void signIn(PluginCall call) {
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(
                Collections.singletonList(new Scope(DRIVE_FILE_SCOPE)))
            .build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    if (pendingCall != null) {
                        call.reject("A Google sign-in is already in progress.");
                        return;
                    }
                    pendingCall = call;
                    try {
                        getActivity().startIntentSenderForResult(
                            result.getPendingIntent().getIntentSender(),
                            RC_AUTHORIZE, null, 0, 0, 0);
                    } catch (IntentSender.SendIntentException e) {
                        pendingCall = null;
                        call.reject(
                            "Could not open Google sign-in: " + e.getMessage());
                    }
                } else {
                    resolveWithToken(call, result.getAccessToken());
                }
            })
            .addOnFailureListener(e ->
                call.reject("Google authorization failed: " + e.getMessage()));
    }

    /**
     * If the hosting activity comes back to the foreground while an
     * authorization is still pending, the consent result was lost on the
     * way (onActivityResult is always delivered BEFORE onResume when it
     * arrives at all). Settle the call with an error instead of leaving
     * the JS promise — and with it the sign-in button — hanging forever.
     */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (pendingCall != null) {
            PluginCall call = pendingCall;
            pendingCall = null;
            call.reject(
                "Google sign-in did not complete. Please try again.",
                "INCOMPLETE");
        }
    }

    private void resolveWithToken(PluginCall call, String accessToken) {
        if (accessToken == null || accessToken.isEmpty()) {
            call.reject("Google did not return an access token.");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("accessToken", accessToken);
        call.resolve(ret);
    }

    @Override
    protected void handleOnActivityResult(
        int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != RC_AUTHORIZE || pendingCall == null) {
            return;
        }
        PluginCall call = pendingCall;
        pendingCall = null;
        if (resultCode != Activity.RESULT_OK || data == null) {
            call.reject("Google sign-in was cancelled.");
            return;
        }
        try {
            AuthorizationResult result = Identity
                .getAuthorizationClient(getActivity())
                .getAuthorizationResultFromIntent(data);
            resolveWithToken(call, result.getAccessToken());
        } catch (Exception e) {
            call.reject("Google sign-in failed: " + e.getMessage());
        }
    }
}
