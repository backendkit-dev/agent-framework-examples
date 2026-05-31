#!/usr/bin/env node
/**
 * bootstrap.js — one-time setup for agent-framework-examples
 *
 * 1. Builds the framework packages (core → coding → mcp-server)
 * 2. Installs and builds each example
 *
 * Run once after cloning:  npm run bootstrap
 * Re-run after framework changes to pick up updates.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../agent-framework');
const EXAMPLES_ROOT  = path.resolve(__dirname, '..');

const FRAMEWORK_PACKAGES = [
    'packages/core',
    'packages/coding',
    'packages/mcp-server',
];

const EXAMPLES = [
    'git-analyst',
    'code-explainer',
    'pg-dev-server',
    'coding-assistant',
];

function run(cmd, cwd) {
    console.log(`\n  $ ${cmd}  (${path.relative(process.cwd(), cwd) || '.'})`);
    execSync(cmd, { cwd, stdio: 'inherit' });
}

function header(title) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log('─'.repeat(60));
}

// ── 1. Framework ──────────────────────────────────────────────────────────────
if (!fs.existsSync(FRAMEWORK_ROOT)) {
    console.error(
        `\n  ✗ Framework not found at: ${FRAMEWORK_ROOT}\n` +
        `    Clone it side-by-side:\n` +
        `    git clone https://github.com/backendkit-dev/agent-framework\n`
    );
    process.exit(1);
}

header('Building @bk/agent-framework packages');
for (const pkg of FRAMEWORK_PACKAGES) {
    const pkgDir = path.join(FRAMEWORK_ROOT, pkg);
    run('npm install', pkgDir);
    run('npm run build', pkgDir);
}

// ── 2. Examples ───────────────────────────────────────────────────────────────
header('Installing examples');
run('npm install', EXAMPLES_ROOT); // root (installs concurrently)

for (const example of EXAMPLES) {
    const dir = path.join(EXAMPLES_ROOT, example);
    if (!fs.existsSync(dir)) continue;
    header(`Building ${example}`);
    run('npm install', dir);
    // coding-assistant has no dist to build for `npm run dev` (ts-node)
    if (example !== 'coding-assistant') {
        run('npm run build', dir);
    }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ✅  Bootstrap complete!\n`);
console.log(`  Start MCP servers + assistant:`);
console.log(`    npm start\n`);
console.log(`  Or start only the MCP servers:`);
console.log(`    npm run servers\n`);
console.log(`  Then open the assistant separately:`);
console.log(`    npm run dev\n`);
console.log('═'.repeat(60));
