package com.isecure.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import com.isecure.core.platform.PlatformServices
import com.isecure.core.state.VaultAppState
import com.isecure.core.state.VaultScreen
import kotlinx.coroutines.delay

/**
 * Root composable shared by the desktop window and the Android
 * activity: owns the VaultAppState, applies theme + layout direction
 * (RTL for fa/ar), runs the auto-lock ticker and routes screens.
 */
@Composable
fun ISecureApp(services: PlatformServices) {
    val scope = rememberCoroutineScope()
    val state = remember { VaultAppState(services, scope) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        state.initialize()
    }

    // Auto-lock ticker (the web app checks every 5 seconds).
    LaunchedEffect(state.screen) {
        while (state.screen == VaultScreen.MAIN) {
            delay(5_000)
            state.checkAutoLock()
        }
    }

    val saveError = state.saveError
    LaunchedEffect(saveError) {
        if (saveError != null) {
            snackbar.showSnackbar(saveError)
            state.dismissSaveError()
        }
    }

    val strings = state.strings
    val dark = when (state.settings.theme) {
        "dark", "amoled" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }

    MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
        CompositionLocalProvider(
            LocalLayoutDirection provides
                if (strings.isRTL) LayoutDirection.Rtl else LayoutDirection.Ltr,
        ) {
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
                Box(Modifier.fillMaxSize().padding(padding)) {
                    when (state.screen) {
                        VaultScreen.LOADING -> LoadingScreen()
                        VaultScreen.SETUP -> SetupScreen(state)
                        VaultScreen.UNLOCK -> UnlockScreen(state)
                        VaultScreen.CORRUPT -> CorruptScreen(state)
                        VaultScreen.MAIN -> MainScreen(state)
                    }
                }
            }
        }
    }
}
