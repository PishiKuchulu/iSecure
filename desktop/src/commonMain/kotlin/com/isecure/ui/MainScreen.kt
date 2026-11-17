package com.isecure.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.isecure.core.state.MainTab
import com.isecure.core.state.VaultAppState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(state: VaultAppState) {
    val strings = state.strings
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(strings.appName) },
                actions = {
                    TextButton(onClick = { state.lock() }) {
                        Text(strings.appLocked)
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = state.tab == MainTab.VAULT,
                    onClick = { state.tab = MainTab.VAULT; state.touch() },
                    label = { Text(strings.vault) },
                    icon = { Text("▦") },
                )
                NavigationBarItem(
                    selected = state.tab == MainTab.GENERATOR,
                    onClick = { state.tab = MainTab.GENERATOR; state.touch() },
                    label = { Text(strings.generator) },
                    icon = { Text("⚄") },
                )
                NavigationBarItem(
                    selected = state.tab == MainTab.AUDIT,
                    onClick = { state.tab = MainTab.AUDIT; state.touch() },
                    label = { Text(strings.auditTitle) },
                    icon = { Text("✓") },
                )
                NavigationBarItem(
                    selected = state.tab == MainTab.TRASH,
                    onClick = { state.tab = MainTab.TRASH; state.touch() },
                    label = { Text(strings.trashBin) },
                    icon = { Text("✕") },
                )
                NavigationBarItem(
                    selected = state.tab == MainTab.SETTINGS,
                    onClick = { state.tab = MainTab.SETTINGS; state.touch() },
                    label = { Text(strings.settingsTitle) },
                    icon = { Text("⚙") },
                )
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (state.tab) {
                MainTab.VAULT -> VaultTab(state)
                MainTab.GENERATOR -> GeneratorTab(state)
                MainTab.AUDIT -> AuditTab(state)
                MainTab.TRASH -> TrashTab(state)
                MainTab.SETTINGS -> SettingsTab(state)
            }
        }
    }
}
