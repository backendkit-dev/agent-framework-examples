#!/usr/bin/env node
/**
 * @description Reflection Bootstrap Bridge — Puente entre los loaders de bootstrap y el ReflectionEngine.
 *
 * Se invoca cuando falla la carga de configuración, memoria o detección de archivos.
 *
 * Uso:
 *   node scripts/reflection-bootstrap-bridge.mjs --type missing_config --path ".ai-assistant/config.yaml" [--message "No se encontró el archivo"]
 *
 * @example
 * ```powershell
 * node scripts/reflection-bootstrap-bridge.mjs --type missing_config --path ".ai-assistant/config.yaml"
 * node scripts/reflection-bootstrap-bridge.mjs --type manifest_corrupt --path "manifest.yaml" --message "Error de parseo YAML"
 * node scripts/reflection-bootstrap-bridge.mjs --type memory_load_failure --path "memory/sesion-actual.md" --message "Error de lectura"
 * ```
 */

import { ReflectionEngine } from '../src/reflection/reflection-engine.js';
import { BootstrapHook } from '../src/reflection/hooks/bootstrap-hook.js';
import * as path from 'path';

// ── Parseo de argumentos ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const parsedArgs = { type: 'missing_config_yaml', path: '', message: '' };

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--type' && args[i + 1]) {
    parsedArgs.type = args[++i];
  } else if (arg === '--path' && args[i + 1]) {
    parsedArgs.path = args[++i];
  } else if (arg === '--message' && args[i + 1]) {
    parsedArgs.message = args[++i];
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const type = parsedArgs.type;
  const filePath = parsedArgs.path;
  const message = parsedArgs.message || `Incidente de bootstrap: ${type}`;

  // Inicializar Reflection Engine
  const engine = new ReflectionEngine({
    projectRoot: process.cwd(),
    useGlobalDir: true,
  });

  try {
    await engine.initialize();
    const hook = new BootstrapHook(engine);

    let result;

    switch (type) {
      case 'missing_config_yaml':
      case 'missing_config': {
        result = await hook.reportMissingConfig(filePath);
        break;
      }
      case 'manifest_corrupt': {
        result = await hook.reportManifestCorrupt(message, filePath);
        break;
      }
      case 'memory_load_failure': {
        result = await hook.reportMemoryLoadFailure(filePath, message);
        break;
      }
      default: {
        result = await hook.reportBootstrapFailure(message, filePath ? [filePath] : []);
        break;
      }
    }

    console.log(`[BootstrapBridge] ✅ Incidente registrado: ${result.record.id} (${result.record.failureType})`);

    if (result.patterns.length > 0) {
      for (const pattern of result.patterns) {
        const status = pattern.promotedToPolicy
          ? `✅ Promovido a policy: ${pattern.policyRuleId}`
          : `⚠️ Patrón detectado (${pattern.count} ocurrencias)`;
        console.log(`[BootstrapBridge]   ${status}: ${pattern.domain}/${pattern.failureType}`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error(`[BootstrapBridge] ❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
