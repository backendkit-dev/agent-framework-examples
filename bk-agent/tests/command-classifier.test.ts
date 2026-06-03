import { CommandClassifier, DEFAULT_TIMEOUT_MS, LONG_RUNNING_TIMEOUT_MS } from '../src/skills/handlers/command-classifier';

describe('CommandClassifier — base patterns', () => {
    const classifier = new CommandClassifier();

    it.each([
        'rm -rf /',
        'rm -rf /tmp/foo',
        ':(){:|:&};:',
        'DROP TABLE users',
        'truncate users',
    ])('isDangerous: "%s"', (cmd) => {
        expect(classifier.isDangerous(cmd)).toBe(true);
    });

    it.each([
        'ls -la',
        'git status',
        'npm test',
        'echo hello',
    ])('not dangerous: "%s"', (cmd) => {
        expect(classifier.isDangerous(cmd)).toBe(false);
    });

    it.each([
        'npm run dev',
        'npm start',
        'yarn dev',
        'nodemon src/index.ts',
        'next dev',
        'vite',
    ])('isServer: "%s"', (cmd) => {
        expect(classifier.isServer(cmd)).toBe(true);
    });

    it.each([
        'npm install',
        'yarn add lodash',
        'tsc',
        'cargo build',
        'next build',
    ])('isLongRunning: "%s"', (cmd) => {
        expect(classifier.isLongRunning(cmd)).toBe(true);
    });

    it.each([
        '.env',
        'path/to/.ssh/id_rsa',
        'credentials.json',
        'service-account.json',
    ])('isSensitivePath: "%s"', (p) => {
        expect(classifier.isSensitivePath(p)).toBe(true);
    });

    it('resolveTimeout: long-running returns LONG_RUNNING_TIMEOUT_MS', () => {
        expect(classifier.resolveTimeout('npm install')).toBe(LONG_RUNNING_TIMEOUT_MS);
    });

    it('resolveTimeout: normal command returns DEFAULT_TIMEOUT_MS', () => {
        expect(classifier.resolveTimeout('ls -la')).toBe(DEFAULT_TIMEOUT_MS);
    });

    it('resolveTimeout: override takes precedence', () => {
        expect(classifier.resolveTimeout('npm install', 9999)).toBe(9999);
    });
});

describe('CommandClassifier — additionalLongRunning', () => {
    const classifier = new CommandClassifier({
        additionalLongRunning: ['bun\\s+install', 'bun\\s+add'],
    });

    it('bun install → long-running', () => {
        expect(classifier.isLongRunning('bun install')).toBe(true);
        expect(classifier.resolveTimeout('bun install')).toBe(LONG_RUNNING_TIMEOUT_MS);
    });

    it('bun add react → long-running', () => {
        expect(classifier.isLongRunning('bun add react')).toBe(true);
    });

    it('npm install still long-running', () => {
        expect(classifier.isLongRunning('npm install')).toBe(true);
    });

    it('bun run dev not long-running (no pattern match)', () => {
        expect(classifier.isLongRunning('bun run dev')).toBe(false);
    });
});

describe('CommandClassifier — additionalServer', () => {
    const classifier = new CommandClassifier({
        additionalServer: ['bun\\s+run\\s+dev'],
    });

    it('bun run dev → server', () => {
        expect(classifier.isServer('bun run dev')).toBe(true);
    });

    it('npm run dev still server', () => {
        expect(classifier.isServer('npm run dev')).toBe(true);
    });
});

describe('CommandClassifier — additionalDangerous', () => {
    const classifier = new CommandClassifier({
        additionalDangerous: ['custom-nuke'],
    });

    it('custom-nuke → dangerous', () => {
        expect(classifier.isDangerous('custom-nuke')).toBe(true);
    });

    it('rm -rf still dangerous', () => {
        expect(classifier.isDangerous('rm -rf /')).toBe(true);
    });
});
