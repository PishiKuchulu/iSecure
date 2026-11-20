package com.isecure.core

import com.isecure.core.platform.FileVaultStore
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** AUD-016 regression: vault writes must replace the existing file
 *  atomically (the Windows routine path) and never fall back to a
 *  direct overwrite of the only copy. */
class FileVaultStoreTest {

    private fun freshStore(): Pair<FileVaultStore, File> {
        val dir = createTempDir(prefix = "isecure-store-test")
        dir.deleteOnExit()
        return FileVaultStore(dir) to dir
    }

    private fun vaultFile(dir: File) =
        File(File(dir, "vault"), "pishisecure_vault_v2.json")

    @Test
    fun writeThenReadRoundTrips() {
        val (store, dir) = freshStore()
        assertFalse(store.exists())
        store.writeText("{\"v\":1}")
        assertTrue(store.exists())
        assertEquals("{\"v\":1}", store.readText())
        assertFalse(File(vaultFile(dir).parentFile, vaultFile(dir).name + ".tmp").exists())
    }

    @Test
    fun overwriteReplacesExistingVaultCompletely() {
        val (store, dir) = freshStore()
        store.writeText("{\"v\":1,\"long\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")
        // The second write is the case File.renameTo refused on Windows:
        // replacing an existing destination must still succeed atomically.
        store.writeText("{\"v\":2}")
        assertEquals("{\"v\":2}", store.readText())
        assertFalse(File(vaultFile(dir).parentFile, vaultFile(dir).name + ".tmp").exists())
    }

    @Test
    fun deleteRemovesVaultAndStagedTmp() {
        val (store, dir) = freshStore()
        store.writeText("{\"v\":1}")
        val tmp = File(vaultFile(dir).parentFile, vaultFile(dir).name + ".tmp")
        tmp.writeText("staged")
        store.delete()
        assertFalse(store.exists())
        assertFalse(tmp.exists())
    }
}
