package com.isecure.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.isecure.core.model.CustomField
import com.isecure.core.model.VaultEntry
import com.isecure.core.state.VaultAppState

@Composable
fun VaultTab(state: VaultAppState) {
    val strings = state.strings
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf<String?>(null) } // null=all, "*"=favorites
    var selected by remember { mutableStateOf<VaultEntry?>(null) }
    var editing by remember { mutableStateOf<VaultEntry?>(null) }
    var creating by remember { mutableStateOf(false) }

    val active = state.entries.filter { !it.isTrash }
    val categories = (VaultAppState.DEFAULT_CATEGORIES + state.customCategories +
        active.map { it.category }).distinct()
    val visible = active.filter { entry ->
        val matchesFilter = when (filter) {
            null -> true
            "*" -> entry.isFavorite
            else -> entry.category == filter
        }
        val q = query.trim().lowercase()
        val matchesQuery = q.isEmpty() ||
            entry.title.lowercase().contains(q) ||
            entry.username.lowercase().contains(q) ||
            (entry.url ?: "").lowercase().contains(q) ||
            entry.tags.any { it.lowercase().contains(q) }
        matchesFilter && matchesQuery
    }

    Scaffold(
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { creating = true }) {
                Text("+ " + strings.addEntry)
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    "${strings.totalPasswords}: ${active.size}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    "${strings.favorites}: ${active.count { it.isFavorite }}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    "${strings.secureNotes}: ${active.count { it.entryType == "note" }}",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text(strings.searchPlaceholder) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    FilterChip(
                        selected = filter == null,
                        onClick = { filter = null },
                        label = { Text(strings.dashboard) },
                    )
                }
                item {
                    FilterChip(
                        selected = filter == "*",
                        onClick = { filter = "*" },
                        label = { Text("★ " + strings.favorites) },
                    )
                }
                items(categories) { category ->
                    FilterChip(
                        selected = filter == category,
                        onClick = { filter = category },
                        label = { Text(category) },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            if (visible.isEmpty()) {
                Text(
                    strings.noEntries,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 24.dp),
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(visible, key = { it.id }) { entry ->
                        Card(
                            Modifier.fillMaxWidth().clickable { selected = entry },
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        entry.title,
                                        style = MaterialTheme.typography.titleMedium,
                                        modifier = Modifier.weight(1f),
                                    )
                                    if (entry.isFavorite) {
                                        Text("★", color = MaterialTheme.colorScheme.primary)
                                    }
                                }
                                if (entry.username.isNotEmpty()) {
                                    Text(
                                        entry.username,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(
                                    entry.category,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    selected?.let { entry ->
        EntryDetailDialog(
            state = state,
            entry = state.entries.firstOrNull { it.id == entry.id } ?: entry,
            onDismiss = { selected = null },
            onEdit = { editing = entry; selected = null },
        )
    }
    if (creating) {
        EntryEditorDialog(
            state = state,
            initial = null,
            onDismiss = { creating = false },
            onSave = { draft ->
                state.addEntry(draft)
                creating = false
            },
        )
    }
    editing?.let { entry ->
        EntryEditorDialog(
            state = state,
            initial = entry,
            onDismiss = { editing = null },
            onSave = { draft ->
                state.editEntry(entry.id, draft)
                editing = null
            },
        )
    }
}

@Composable
private fun EntryDetailDialog(
    state: VaultAppState,
    entry: VaultEntry,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
) {
    val strings = state.strings
    var showSecret by remember { mutableStateOf(false) }
    var confirmTrash by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(entry.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (entry.username.isNotEmpty()) {
                    DetailRow(strings.username, entry.username) {
                        state.copySecret(entry.username)
                    }
                }
                entry.password?.takeIf { it.isNotEmpty() }?.let { secret ->
                    DetailRow(
                        strings.password,
                        if (showSecret) secret else "••••••••",
                    ) {
                        state.copySecret(secret)
                    }
                    TextButton(onClick = { showSecret = !showSecret }) {
                        Text(strings.viewDetails)
                    }
                }
                entry.url?.takeIf { it.isNotEmpty() }?.let {
                    DetailRow(strings.url, it) { state.copySecret(it) }
                }
                entry.notes?.takeIf { it.isNotEmpty() }?.let {
                    DetailRow(strings.notes, it) { state.copySecret(it) }
                }
                if (entry.tags.isNotEmpty()) {
                    DetailRow(strings.tags, entry.tags.joinToString(", ")) {}
                }
                DetailRow(strings.category, entry.category) {}
                DetailRow(strings.entryType, entry.entryType) {}
                entry.customFields?.forEach { field ->
                    DetailRow(
                        field.label,
                        if (field.isSecret && !showSecret) "••••••••" else field.value,
                    ) {
                        state.copySecret(field.value)
                    }
                }
                if (entry.history.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Text(strings.history, style = MaterialTheme.typography.titleSmall)
                    entry.history.forEach { item ->
                        DetailRow(item.changedAt.take(10), "••••••••") {
                            state.copySecret(item.password)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onEdit) { Text(strings.editEntry) }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { confirmTrash = true }) {
                    Text(strings.deleteEntry, color = MaterialTheme.colorScheme.error)
                }
                TextButton(onClick = onDismiss) { Text(strings.cancel) }
            }
        },
    )

    if (confirmTrash) {
        AlertDialog(
            onDismissRequest = { confirmTrash = false },
            title = { Text(strings.trash) },
            text = { Text(entry.title) },
            confirmButton = {
                TextButton(onClick = {
                    state.trashEntry(entry.id)
                    confirmTrash = false
                    onDismiss()
                }) {
                    Text(strings.deleteEntry, color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmTrash = false }) {
                    Text(strings.cancel)
                }
            },
        )
    }
}

@Composable
private fun DetailRow(label: String, value: String, onCopy: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(value, style = MaterialTheme.typography.bodyMedium)
        }
        TextButton(onClick = onCopy) { Text("⧉") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EntryEditorDialog(
    state: VaultAppState,
    initial: VaultEntry?,
    onDismiss: () -> Unit,
    onSave: (VaultEntry) -> Unit,
) {
    val strings = state.strings
    var title by remember { mutableStateOf(initial?.title ?: "") }
    var username by remember { mutableStateOf(initial?.username ?: "") }
    var secret by remember { mutableStateOf(initial?.password ?: "") }
    var url by remember { mutableStateOf(initial?.url ?: "") }
    var notes by remember { mutableStateOf(initial?.notes ?: "") }
    var tagsText by remember { mutableStateOf(initial?.tags?.joinToString(", ") ?: "") }
    var category by remember { mutableStateOf(initial?.category ?: "website") }
    var entryType by remember { mutableStateOf(initial?.entryType ?: "website") }
    var isFavorite by remember { mutableStateOf(initial?.isFavorite ?: false) }
    var fields by remember {
        mutableStateOf(initial?.customFields ?: emptyList())
    }
    var showSecret by remember { mutableStateOf(false) }
    var titleError by remember { mutableStateOf(false) }

    val categories = (VaultAppState.DEFAULT_CATEGORIES + state.customCategories +
        state.entries.map { it.category }).distinct()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) strings.addEntry else strings.editEntry) },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it; titleError = false },
                        label = { Text(strings.title) },
                        isError = titleError,
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text(strings.username) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    OutlinedTextField(
                        value = secret,
                        onValueChange = { secret = it },
                        label = { Text(strings.password) },
                        singleLine = true,
                        visualTransformation = if (showSecret) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        trailingIcon = {
                            TextButton(onClick = { showSecret = !showSecret }) {
                                Text(strings.viewDetails)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    OutlinedTextField(
                        value = url,
                        onValueChange = { url = it },
                        label = { Text(strings.url) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it },
                        label = { Text(strings.notes) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    OutlinedTextField(
                        value = tagsText,
                        onValueChange = { tagsText = it },
                        label = { Text(strings.tags) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    DropdownField(
                        label = strings.entryType,
                        value = entryType,
                        options = VaultAppState.ENTRY_TYPES,
                        onSelect = { entryType = it },
                    )
                }
                item {
                    DropdownField(
                        label = strings.category,
                        value = category,
                        options = categories,
                        onSelect = { category = it },
                    )
                }
                item {
                    OutlinedTextField(
                        value = category,
                        onValueChange = { category = it },
                        label = { Text(strings.category) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(strings.isFavorite, Modifier.weight(1f))
                        Switch(checked = isFavorite, onCheckedChange = { isFavorite = it })
                    }
                }
                item {
                    Text(strings.customFields, style = MaterialTheme.typography.titleSmall)
                }
                items(fields.size) { index ->
                    val field = fields[index]
                    Column {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = field.label,
                                onValueChange = { value ->
                                    fields = fields.toMutableList().also {
                                        it[index] = field.copy(label = value)
                                    }
                                },
                                label = { Text(strings.fieldLabel) },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = field.value,
                                onValueChange = { value ->
                                    fields = fields.toMutableList().also {
                                        it[index] = field.copy(value = value)
                                    }
                                },
                                label = { Text(strings.fieldValue) },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = field.isSecret,
                                onCheckedChange = { checked ->
                                    fields = fields.toMutableList().also {
                                        it[index] = field.copy(isSecret = checked)
                                    }
                                },
                            )
                            Text(strings.secretField)
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = {
                                fields = fields.filterIndexed { i, _ -> i != index }
                            }) {
                                Text(strings.deleteEntry)
                            }
                        }
                    }
                }
                item {
                    TextButton(onClick = {
                        fields = fields + CustomField("", "", false)
                    }) {
                        Text("+ " + strings.addField)
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                if (title.isBlank()) {
                    titleError = true
                } else {
                    onSave(
                        VaultEntry(
                            id = initial?.id ?: "",
                            title = title.trim(),
                            username = username,
                            password = secret.ifEmpty { null },
                            url = url.ifEmpty { null },
                            notes = notes.ifEmpty { null },
                            tags = tagsText.split(",")
                                .map { it.trim() }
                                .filter { it.isNotEmpty() },
                            category = category.ifBlank { "custom" },
                            isFavorite = isFavorite,
                            isTrash = initial?.isTrash ?: false,
                            deletedAt = initial?.deletedAt,
                            createdDate = initial?.createdDate ?: "",
                            modifiedDate = initial?.modifiedDate ?: "",
                            entryType = entryType,
                            history = initial?.history ?: emptyList(),
                            customFields = fields.filter {
                                it.label.isNotEmpty() || it.value.isNotEmpty()
                            }.ifEmpty { null },
                        ),
                    )
                }
            }) {
                Text(strings.save)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(strings.cancel) }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DropdownField(
    label: String,
    value: String,
    options: List<String>,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                )
            }
        }
    }
}
