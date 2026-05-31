#!/usr/bin/env node
/**
 * build-all.js — rebuild all examples (not the framework)
 * Run after pulling changes: npm run build
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXAMPLES_ROOT = path.resolve(__dirname, '..');
const BUILDABLE = ['git-analyst', 'code-explainer', 'pg-dev-server'];

function run(cmd, cwd) {
    console.log(`\n  $ ${cmd}  (${path.basename(cwd)})`);
    execSync(cmd, { cwd, stdio: 'inherit' });
}

for (const example of BUILDABLE) {
    const dir = path.join(EXAMPLES_ROOT, example);
    if (!fs.existsSync(dir)) continue;
    run('npm run build', dir);
}

console.log('\n  ✅  All examples built.\n');
