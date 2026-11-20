/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Copy, Check, RefreshCw, Lock } from 'lucide-react';
import { LocaleStrings } from '../locales';
import { calculateEntropy, getPasswordStrength, getSecureRandomInt } from '../utils';
import { copyTextWithAutoClear } from '../services/clipboard';

interface GeneratorViewProps {
  strings: LocaleStrings;
  clipboardClearSeconds: number;
}

export default function GeneratorView({ strings, clipboardClearSeconds }: GeneratorViewProps) {
  const [length, setLength] = useState(20);
  const [includeUpper, setIncludeUpper] = useState(true);
  const [includeLower, setIncludeLower] = useState(true);
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [excludeSimilar, setExcludeSimilar] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [genError, setGenError] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [copyError, setCopyError] = useState('');

  // Generate password using Web Crypto CSPRNG (crypto.getRandomValues)
  const triggerGeneration = () => {
    let lowercaseCharset = 'abcdefghijklmnopqrstuvwxyz';
    let uppercaseCharset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let numbersCharset = '0123456789';
    let symbolsCharset = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (excludeSimilar) {
      lowercaseCharset = lowercaseCharset.replace(/[lo]/g, '');
      uppercaseCharset = uppercaseCharset.replace(/[IO]/g, '');
      numbersCharset = numbersCharset.replace(/[01]/g, '');
      symbolsCharset = symbolsCharset.replace(/[|.,]/g, '');
    }

    let activePool = '';
    const mandatoryChars: string[] = [];

    if (includeLower && lowercaseCharset) {
      activePool += lowercaseCharset;
      mandatoryChars.push(lowercaseCharset[getSecureRandomInt(lowercaseCharset.length)]);
    }
    if (includeUpper && uppercaseCharset) {
      activePool += uppercaseCharset;
      mandatoryChars.push(uppercaseCharset[getSecureRandomInt(uppercaseCharset.length)]);
    }
    if (includeNumbers && numbersCharset) {
      activePool += numbersCharset;
      mandatoryChars.push(numbersCharset[getSecureRandomInt(numbersCharset.length)]);
    }
    if (includeSymbols && symbolsCharset) {
      activePool += symbolsCharset;
      mandatoryChars.push(symbolsCharset[getSecureRandomInt(symbolsCharset.length)]);
    }

    if (!activePool) {
      setGenError('Please select at least one character set.');
      setGeneratedPassword('');
      setIsCopied(false);
      return;
    }

    setGenError('');
    setCopyError('');
    const result = [...mandatoryChars];
    const fillLength = Math.max(0, length - result.length);

    for (let i = 0; i < fillLength; i++) {
      const randomIdx = getSecureRandomInt(activePool.length);
      result.push(activePool[randomIdx]);
    }

    // Fisher-Yates shuffle using CSPRNG
    for (let i = result.length - 1; i > 0; i--) {
      const j = getSecureRandomInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }

    setGeneratedPassword(result.join(''));
    setIsCopied(false);
  };

  useEffect(() => {
    triggerGeneration();
  }, [length, includeUpper, includeLower, includeNumbers, includeSymbols, excludeSimilar]);

  const handleCopyToClipboard = () => {
    if (!generatedPassword || genError) return;
    // The clipboard service owns the auto-clear timer at module level,
    // so leaving this view no longer cancels the clear (P-04), and a
    // failed write is surfaced instead of showing a false "copied".
    void copyTextWithAutoClear(generatedPassword, clipboardClearSeconds).then(ok => {
      setIsCopied(ok);
      setCopyError(ok ? '' : 'Copy failed — clipboard unavailable');
      if (ok) {
        setTimeout(() => setIsCopied(false), 2000);
      }
    });
  };

  const entropyScore = genError ? 0 : calculateEntropy(generatedPassword);
  const strength = genError ? 'weak' : getPasswordStrength(generatedPassword);

  const getStrengthVisuals = () => {
    if (genError) {
      return { color: 'bg-gray-300 dark:bg-zinc-700', barCount: 0, text: '—', textColor: 'text-gray-400' };
    }
    switch (strength) {
      case 'weak':
        return { color: 'bg-rose-500', barCount: 1, text: strings.genStrengthWeak, textColor: 'text-rose-500' };
      case 'fair':
        return { color: 'bg-amber-500', barCount: 2, text: strings.genStrengthFair, textColor: 'text-amber-500' };
      case 'good':
        return { color: 'bg-indigo-500', barCount: 3, text: strings.genStrengthGood, textColor: 'text-indigo-500' };
      case 'excellent':
        return { color: 'bg-emerald-500', barCount: 4, text: strings.genStrengthExcellent, textColor: 'text-emerald-500' };
    }
  };

  const strengthDetails = getStrengthVisuals();

  return (
    <div className="max-w-2xl mx-auto bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm" id="generator_view_container">
      <div className="flex items-center gap-2 mb-6">
        <div className="p-2 bg-blue-500/10 text-blue-600 rounded-xl">
          <Lock className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-zinc-100">{strings.generator}</h2>
          <p className="text-xs text-gray-400">CSPRNG (crypto.getRandomValues) high-entropy password generator.</p>
        </div>
      </div>

      {/* Generated Result display bar */}
      <div className="relative mb-6 p-4 bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-4">
          {/* Wrapping text block, not a single-line input: a long generated
              password must stay fully visible instead of clipping its tail. */}
          <div
            aria-label={strings.password}
            className={`min-w-0 flex-1 font-mono text-sm sm:text-base tracking-wide select-all break-all ${
              genError ? 'text-rose-500 font-semibold text-xs' : 'text-gray-900 dark:text-white'
            }`}
          >
            {genError || generatedPassword}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={triggerGeneration}
            aria-label="Regenerate password"
            className="p-2 border border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-gray-500 dark:text-zinc-400 hover:text-gray-700 transition cursor-pointer"
            title="Regenerate"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleCopyToClipboard}
            disabled={!!genError || !generatedPassword}
            className={`p-2 flex items-center gap-1 text-xs px-3 rounded-lg font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isCopied
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-900 hover:bg-gray-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white'
            }`}
          >
            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {isCopied ? 'Copied' : strings.copy}
          </button>
          </div>
        </div>
        {copyError && (
          <p className="text-[11px] text-rose-500 font-bold mt-2">{copyError}</p>
        )}
      </div>

      {/* Strength and Entropy displays */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-50/50 dark:bg-zinc-900/40 rounded-xl border border-gray-200 dark:border-zinc-800/80">
          <p className="text-[10px] text-gray-400 font-medium uppercase font-mono">{strings.genEntropy}</p>
          <p className="text-lg font-bold font-mono text-gray-900 dark:text-white mt-1">
            {entropyScore} <span className="text-[10px] text-gray-400 font-normal">bits</span>
          </p>
        </div>
        <div className="p-4 bg-gray-50/50 dark:bg-zinc-900/40 rounded-xl border border-gray-200 dark:border-zinc-800/80">
          <p className="text-[10px] text-gray-400 font-medium uppercase font-mono">{strings.genStrength}</p>
          <p className={`text-sm font-bold mt-1 ${strengthDetails.textColor}`}>
            {strengthDetails.text}
          </p>
        </div>
      </div>

      {/* Strength indicator progress bar segment */}
      <div className="mb-8">
        <div className="flex gap-1.5 h-1.5 w-full">
          {[1, 2, 3, 4].map(idx => (
            <div
              key={idx}
              className={`h-full flex-1 rounded-full transition-all duration-300 ${
                idx <= strengthDetails.barCount
                  ? strengthDetails.color
                  : 'bg-gray-200 dark:bg-zinc-800'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {/* Length slider */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label htmlFor="generator-length-range" className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
              {strings.genLength}
            </label>
            <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
              {length}
            </span>
          </div>
          <input
            id="generator-length-range"
            type="range"
            min="8"
            max="128"
            value={length}
            onChange={(e) => setLength(parseInt(e.target.value, 10))}
            className="w-full accent-blue-600 h-1 bg-gray-200 dark:bg-zinc-800 rounded-lg cursor-pointer"
          />
        </div>

        {/* Checklist options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-800/80 border border-gray-200 dark:border-zinc-800/50 rounded-xl cursor-pointer select-none transition">
            <input
              type="checkbox"
              checked={includeUpper}
              onChange={(e) => setIncludeUpper(e.target.checked)}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-gray-700 dark:text-zinc-300">{strings.genUppercase}</span>
          </label>

          <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-800/80 border border-gray-200 dark:border-zinc-800/50 rounded-xl cursor-pointer select-none transition">
            <input
              type="checkbox"
              checked={includeLower}
              onChange={(e) => setIncludeLower(e.target.checked)}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-gray-700 dark:text-zinc-300">{strings.genLowercase}</span>
          </label>

          <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-800/80 border border-gray-200 dark:border-zinc-800/50 rounded-xl cursor-pointer select-none transition">
            <input
              type="checkbox"
              checked={includeNumbers}
              onChange={(e) => setIncludeNumbers(e.target.checked)}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-gray-700 dark:text-zinc-300">{strings.genNumbers}</span>
          </label>

          <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-800/80 border border-gray-200 dark:border-zinc-800/50 rounded-xl cursor-pointer select-none transition">
            <input
              type="checkbox"
              checked={includeSymbols}
              onChange={(e) => setIncludeSymbols(e.target.checked)}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-gray-700 dark:text-zinc-300">{strings.genSymbols}</span>
          </label>
        </div>

        {/* Exclude Similar characters toggle */}
        <label className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-zinc-900/60 hover:bg-gray-100 dark:hover:bg-zinc-900 border border-dashed border-gray-200 dark:border-zinc-800 rounded-xl cursor-pointer transition">
          <input
            type="checkbox"
            checked={excludeSimilar}
            onChange={(e) => setExcludeSimilar(e.target.checked)}
            className="w-4 h-4 accent-blue-600 cursor-pointer"
          />
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300">{strings.genExcludeSimilar}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Cleans up high-risk character confusions like (l, o, I, O, 0, 1)</p>
          </div>
        </label>
      </div>
    </div>
  );
}
