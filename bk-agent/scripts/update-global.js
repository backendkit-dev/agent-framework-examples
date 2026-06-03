#!/usr/bin/env node
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const exec = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

console.log(`\nActualizando ${pkg.name} v${pkg.version} en instalacion global...\n`);

console.log('[1/2] Compilando TypeScript...');
exec('npx tsc');
console.log('  OK\n');

// Limpiar shims huerfanos de instalaciones anteriores con nombre distinto
try {
    const globalPrefix = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
    const oldShims = ['deepseek-code', 'deepseek-code.cmd', 'deepseek-code.ps1'];
    for (const shim of oldShims) {
        try { fs.unlinkSync(path.join(globalPrefix, shim)); } catch { /* ya no existe */ }
    }
} catch { /* opcional */ }

console.log('[2/2] Instalando globalmente...');
exec('npm install -g .');
console.log('  OK\n');

// Verificacion rapida
try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const globalPkg = path.join(globalRoot, pkg.name, 'package.json');
    if (fs.existsSync(globalPkg)) {
        const installedVersion = require(globalPkg).version;
        const distCli = path.join(globalRoot, pkg.name, 'dist', 'bin', 'cli.js');
        const mtime = fs.statSync(distCli).mtime.toISOString().replace('T', ' ').slice(0, 19);
        console.log(`bk-agent v${installedVersion} — dist actualizado: ${mtime} UTC`);
    }
} catch { /* verificacion opcional, no bloquea */ }

console.log('\nListo. Usa "bk-agent" para correr la version actualizada.\n');
