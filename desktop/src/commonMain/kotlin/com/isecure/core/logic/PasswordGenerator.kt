package com.isecure.core.logic

import com.isecure.core.platform.RandomSource

/**
 * Password generator — exact port of GeneratorView.triggerGeneration in
 * the web app: one mandatory character per enabled set, the rest filled
 * from the combined pool, then a CSPRNG Fisher-Yates shuffle.
 */
object PasswordGenerator {

    data class Options(
        val length: Int = 20,
        val includeLower: Boolean = true,
        val includeUpper: Boolean = true,
        val includeNumbers: Boolean = true,
        val includeSymbols: Boolean = true,
        val excludeSimilar: Boolean = false,
    )

    /** Returns null when no character set is enabled (the web app shows
     *  "Please select at least one character set" in that case). */
    fun generate(random: RandomSource, options: Options): String? {
        var lowercase = "abcdefghijklmnopqrstuvwxyz"
        var uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        var numbers = "0123456789"
        var symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?"

        if (options.excludeSimilar) {
            lowercase = lowercase.replace("l", "").replace("o", "")
            uppercase = uppercase.replace("I", "").replace("O", "")
            numbers = numbers.replace("0", "").replace("1", "")
            symbols = symbols.replace("|", "").replace(".", "").replace(",", "")
        }

        var activePool = ""
        val mandatory = ArrayList<Char>()

        if (options.includeLower && lowercase.isNotEmpty()) {
            activePool += lowercase
            mandatory.add(lowercase[VaultLogic.secureRandomInt(random, lowercase.length)])
        }
        if (options.includeUpper && uppercase.isNotEmpty()) {
            activePool += uppercase
            mandatory.add(uppercase[VaultLogic.secureRandomInt(random, uppercase.length)])
        }
        if (options.includeNumbers && numbers.isNotEmpty()) {
            activePool += numbers
            mandatory.add(numbers[VaultLogic.secureRandomInt(random, numbers.length)])
        }
        if (options.includeSymbols && symbols.isNotEmpty()) {
            activePool += symbols
            mandatory.add(symbols[VaultLogic.secureRandomInt(random, symbols.length)])
        }

        if (activePool.isEmpty()) return null

        val result = mandatory.toMutableList()
        val fillLength = maxOf(0, options.length - result.size)
        repeat(fillLength) {
            val idx = VaultLogic.secureRandomInt(random, activePool.length)
            result.add(activePool[idx])
        }

        // Fisher-Yates shuffle using the CSPRNG
        for (i in result.size - 1 downTo 1) {
            val j = VaultLogic.secureRandomInt(random, i + 1)
            val tmp = result[i]
            result[i] = result[j]
            result[j] = tmp
        }

        return result.joinToString("")
    }
}
