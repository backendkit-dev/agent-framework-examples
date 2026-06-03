import { searchVaultPatterns } from '../src/vault/search';
import { defaultInstructions } from '../src/types/config';
import { getDefaultConfig } from '../src/bootstrap/config-loader';
import { MockVaultProvider } from '../src/vault/vault-provider';

describe('searchVaultPatterns', () => {
    let mockProvider: MockVaultProvider;

    beforeEach(() => {
        mockProvider = new MockVaultProvider();
        mockProvider.addEntry('04-Recursos/nestjs-pattern.md', '# NestJS Module\nEste patron describe un modulo de NestJS con TypeORM.');
        mockProvider.addEntry('04-Recursos/docker-deploy.md', '# Docker Deploy\nDeploy con docker compose y kubernetes.');
    });

    afterEach(() => {
        mockProvider.clear();
    });

    it('encuentra patrones por keyword dinamica', async () => {
        const results = await searchVaultPatterns(
            'crea un modulo nestjs',
            defaultInstructions(),
            '/fake/vault',
            getDefaultConfig(),
            mockProvider,
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].path).toContain('nestjs');
    });

    it('retorna vacio si no hay keywords relevantes', async () => {
        const results = await searchVaultPatterns(
            'hola',
            defaultInstructions(),
            '/fake/vault',
            getDefaultConfig(),
            mockProvider,
        );
        expect(results.length).toBe(0);
    });

    it('retorna vacio si vaultPath esta vacio', async () => {
        const results = await searchVaultPatterns(
            'nestjs',
            defaultInstructions(),
            '',
            getDefaultConfig(),
            mockProvider,
        );
        expect(results.length).toBe(0);
    });

    it('retorna resultados con MockVaultProvider sin disco real', async () => {
        const results = await searchVaultPatterns(
            'docker deploy',
            defaultInstructions(),
            '/fake/vault',
            getDefaultConfig(),
            mockProvider,
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].path).toContain('docker');
    });

    it('retorna vacio si el mock no tiene entradas relevantes', async () => {
        const emptyMock = new MockVaultProvider();
        emptyMock.addEntry('04-Recursos/irrelevant.md', '# Cosas irrelevantes');
        const results = await searchVaultPatterns(
            'nestjs',
            defaultInstructions(),
            '/fake/vault',
            getDefaultConfig(),
            emptyMock,
        );
        expect(results.length).toBe(0);
    });
});
