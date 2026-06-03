#!/usr/bin/env node
/**
 * @description Reflection Commit Bridge — Puente entre commit-workflow.ps1 y el ReflectionEngine.
 *
 * El script PowerShell (commit-workflow.ps1) invoca este bridge cuando fallan
 * el typecheck o los tests durante el Test Validation Gate.
 *
 * Uso desde PowerShell:
 *   node scripts/reflection-commit-bridge.mjs --message "Error TS2345: ..." --files "src/file.ts" [--type typecheck|test|commit]
 *
 * @example
 * ```powershell
 * # Typecheck failure
 * node scripts/reflection-commit-bridge.mjs --type typecheck --message "TypeScript error TS2345" --files "src/file.ts"
 *
 * # Test failure
 * node scripts/reflection-commit-bridge.mjs --type test --message "FAIL test/unit/foo.test.ts" --files "test/unit/foo.test.ts"
 *
 * # Commit format failure
 * node scripts/reflection-commit-bridge.mjs --type commit --message "Missing conventional commit type" --files "."
 * ```
 */

import { ReflectionEngine } from '../src/reflection/reflection-engine.js';
import { CommitHook } from '../src/reflection/hooks/commit-hook.js';
import { TestHook } from '../src/reflection/hooks/test-hook.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// ── Parseo de argumentos ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const parsedArgs = { type: 'commit', message: '', files: [] };

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--type' && args[i + 1]) {
    parsedArgs.type = args[++i];
  } else if (arg === '--message' && args[i + 1]) {
    parsedArgs.message = args[++i];
  } else if (arg === '--files' && args[i + 1]) {
    parsedArgs.files = args[++i].split(',').map(f => f.trim()).filter(Boolean);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!parsedArgs.message) {
    console.error('[ReflectionBridge] Uso: --message "..." [--type typecheck|test|commit] [--files "a.ts,b.ts"]');
    process.exit(1);
  }

  // Inicializar Reflection Engine
  const engine = new ReflectionEngine({
    projectRoot: process.cwd(),
    useGlobalDir: true,
  });

  try {
    await engine.initialize();

    const hookType = parsedArgs.type;
    let result;

    switch (hookType) {
      case 'typecheck': {
        const hook = new CommitHook(engine);
        result = await hook.reportTypecheckFailure(parsedArgs.message, parsedArgs.files);
        break;
      }
      case 'test': {
        const hook = new TestHook(engine);
        result = await hook.reportTestFailure(parsedArgs.message, parsedArgs.files);
        break;
      }
      case 'commit':
      default: {
        const hook = new CommitHook(engine);
        result = await hook.reportCommitFailure(parsedArgs.message, parsedArgs.files);
        break;
      }
    }

    console.log(`[ReflectionBridge] ✅ Incidente registrado: ${result.record.id} (${result.record.failureType})`);

    if (result.patterns.length > 0) {
      for (const pattern of result.patterns) {
        const status = pattern.promotedToPolicy
          ? `✅ Promovido a policy: ${pattern.policyRuleId}`
          : `⚠️ Patrón detectado (${pattern.count} ocurrencias)`;
        console.log(`[ReflectionBridge]   ${status}: ${pattern.domain}/${pattern.failureType}`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error(`[ReflectionBridge] ❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
