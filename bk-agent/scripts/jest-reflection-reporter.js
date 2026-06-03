/**
 * @description Jest custom reporter para el Reflection Engine.
 *
 * Captura fallos de test suite y cobertura baja y los reporta al
 * ReflectionEngine via reflection-commit-bridge.mjs, acumulando
 * incidentes en test-domain para deteccion de patrones.
 *
 * Instalacion: agregar '<rootDir>/scripts/jest-reflection-reporter.js'
 * al array reporters en jest.config.js.
 */

'use strict';

const { execFile } = require('child_process');
const path = require('path');

const BRIDGE_PATH = path.join(__dirname, 'reflection-commit-bridge.mjs');
const COVERAGE_THRESHOLD_PCT = 70;

function callBridge(type, message, files) {
    execFile(
        'node',
        [BRIDGE_PATH, '--type', type, '--message', message, '--files', files || '.'],
        { timeout: 10000 },
        () => {} // fail silencioso — nunca bloquear el test run
    );
}

class ReflectionReporter {
    constructor(_globalConfig, _options) {}

    // TASK-05: Reportar fallos de test suite
    onTestResult(_test, result) {
        if (!result.failureMessage) return;

        const message = result.failureMessage
            .slice(0, 200)
            .replace(/\r?\n/g, ' ')
            .replace(/"/g, "'");

        const testFile = result.testFilePath || '';
        callBridge('test', message, testFile);
    }

    // TASK-06: Reportar cobertura baja al finalizar el run
    onRunComplete(_contexts, results) {
        if (!results.coverageMap) return;

        const files = results.coverageMap.files();
        if (!files || files.length === 0) return;

        const lowCoverage = files
            .map(f => {
                try {
                    const summary = results.coverageMap.fileCoverageFor(f).toSummary();
                    return { file: f, pct: summary.lines.pct };
                } catch {
                    return null;
                }
            })
            .filter(s => s !== null && s.pct < COVERAGE_THRESHOLD_PCT);

        if (lowCoverage.length === 0) return;

        const worst = lowCoverage.reduce((a, b) => (a.pct < b.pct ? a : b));
        const fileList = lowCoverage.map(s => s.file).join(',').slice(0, 500);
        const message = `Coverage ${worst.pct.toFixed(1)}% < threshold ${COVERAGE_THRESHOLD_PCT}% (${lowCoverage.length} archivos)`;

        callBridge('test', message, fileList);
    }
}

module.exports = ReflectionReporter;
