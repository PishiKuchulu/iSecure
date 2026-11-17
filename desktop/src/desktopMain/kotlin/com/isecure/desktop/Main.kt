package com.isecure.desktop

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application

/**
 * Scaffold entry point — proves the Compose Multiplatform desktop
 * toolchain. The vault UI lands in the next phase on top of the
 * vector-verified crypto core (see crypto/VaultCrypto.kt).
 */
fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "iSecure") {
        MaterialTheme {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("iSecure Desktop — scaffold")
            }
        }
    }
}
