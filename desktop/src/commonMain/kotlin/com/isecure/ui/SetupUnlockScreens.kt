package com.isecure.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.isecure.core.logic.VaultLogic
import com.isecure.core.state.VaultAppState
import kotlinx.coroutines.launch

@Composable
fun LoadingScreen() {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun SecretField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    showLabel: String,
    hideLabel: String,
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (visible) {
            VisualTransformation.None
        } else {
            PasswordVisualTransformation()
        },
        trailingIcon = {
            TextButton(onClick = { visible = !visible }) {
                Text(if (visible) hideLabel else showLabel)
            }
        },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
fun SetupScreen(state: VaultAppState) {
    val strings = state.strings
    val scope = rememberCoroutineScope()
    var secret by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var mismatch by remember { mutableStateOf(false) }
    val check = VaultLogic.validateMasterPassword(secret)

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth()) {
            Text(strings.appName, style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                strings.tagline,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            Text(strings.masterPasswordSetupText, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(16.dp))
            SecretField(
                strings.masterPassword, secret, { secret = it; mismatch = false },
                strings.viewDetails, strings.cancel,
            )
            Spacer(Modifier.height(8.dp))
            SecretField(
                strings.masterPasswordConfirm, confirm, { confirm = it; mismatch = false },
                strings.viewDetails, strings.cancel,
            )
            Spacer(Modifier.height(12.dp))
            // Strength checklist (validateMasterPassword in the web app)
            CheckRow(check.hasMinLength, "12+")
            CheckRow(check.hasUpper, "ABC")
            CheckRow(check.hasLower, "abc")
            CheckRow(check.hasNumber, "123")
            CheckRow(check.hasSymbol, "#$&")
            Text(
                "${strings.genEntropy}: ${check.entropy}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (mismatch) {
                Spacer(Modifier.height(8.dp))
                Text(
                    strings.wrongPassword,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    if (secret.isEmpty() || secret != confirm) {
                        mismatch = true
                    } else {
                        scope.launch { state.setupVault(secret) }
                    }
                },
                enabled = !state.isBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.isBusy) {
                    CircularProgressIndicator(Modifier.height(18.dp))
                } else {
                    Text(strings.setupVault)
                }
            }
        }
    }
}

@Composable
private fun CheckRow(ok: Boolean, label: String) {
    Text(
        (if (ok) "✓ " else "• ") + label,
        style = MaterialTheme.typography.bodySmall,
        color = if (ok) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
    )
}

@Composable
fun UnlockScreen(state: VaultAppState) {
    val strings = state.strings
    val scope = rememberCoroutineScope()
    var secret by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth()) {
            Text(strings.appLocked, style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                strings.appLockedDesc,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            SecretField(
                strings.enterMasterPassword, secret, { secret = it },
                strings.viewDetails, strings.cancel,
            )
            if (state.unlockError) {
                Spacer(Modifier.height(8.dp))
                Text(
                    strings.wrongPassword,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    if (secret.isNotEmpty()) {
                        scope.launch { state.unlock(secret) }
                    }
                },
                enabled = !state.isBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.isBusy) {
                    CircularProgressIndicator(Modifier.height(18.dp))
                } else {
                    Text(strings.unlock)
                }
            }
            if (state.biometricUnlockAvailable) {
                // One automatic prompt per lock episode, plus a manual
                // retry button — the Capacitor edition's behavior.
                var prompted by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) {
                    if (!prompted) {
                        prompted = true
                        state.unlockWithBiometric()
                    }
                }
                Spacer(Modifier.height(8.dp))
                TextButton(
                    onClick = {
                        scope.launch { state.unlockWithBiometric() }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(strings.biometricUnlockBtn)
                }
            }
        }
    }
}

@Composable
fun CorruptScreen(state: VaultAppState) {
    val strings = state.strings
    var armed by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth()) {
            Text(
                strings.rootWarningTitle,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.error,
            )
            Spacer(Modifier.height(8.dp))
            Text(strings.rootWarningDesc, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    if (armed) {
                        state.eraseCorruptVault()
                    } else {
                        armed = true
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (armed) strings.permanentlyDelete else strings.deleteEntry)
            }
            if (armed) {
                TextButton(onClick = { armed = false }) {
                    Text(strings.cancel)
                }
            }
        }
    }
}
