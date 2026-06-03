import { profileVaultSearch, getVaultProfileSummary, saveProfileReport, buildInstructions } from '../src/vault/profiler';
import { AIAssistantConfig } from '../src/types/config';
import * as fs from 'fs';
import * as path from 'path';

const TEST_QUERIES = [
    '@obsidian crear un modulo nestjs con typeorm',
    '@obsidian patron repository en typescript',
    '@obsidian configurar autenticacion jwt',
    '@obsidian value object daterange',
    '@obsidian docker compose postgres',
    '@obsidian patrones de diseno en typescript',
    '@obsidian configurar swagger nestjs',
    '@obsidian entity typeorm decoradores',
    '@obsidian middleware nestjs ejemplo',
    '@obsidian guard jwt nestjs',
];

function resolveVaultPath(): string {
    const linkPath = path.join(__dirname, '..', '.obsidian-vault', 'link.txt');
    const raw = fs.readFileSync(linkPath, 'utf-8').trim();
    // Normalizar separadores a forward slash
    return raw.replace(/\\/g, '/');
}

async function main(): Promise<void> {
    console.log('=== VAULT PROFILE RUNNER ===\n');

    const vaultPath = resolveVaultPath();
    console.log(`Vault path: ${vaultPath}\n`);

    const triggers = [
        'patron',
        'patrones',
        'pattern',
        'value object',
        'domain error',
        'branded type',
        'use case',
        'nestjs',
        'typescript',
        'jwt',
        'docker',
        'postgres',
        'git',
        'typeorm',
        'swagger',
        'middleware',
        'guard',
        'entity',
        'decorador',
        'modulo',
        'repository',
        'autenticacion',
        'configuracion',
    ];

    const instructions = buildInstructions(triggers);

    const config: AIAssistantConfig = {
        vault: {
            path: vaultPath,
            auto_sync: true,
            auto_use: true,
            search_paths: ['04-Recursos'],
        },
        extraction: {
            enabled: true,
            trigger: 'extract',
            patterns: true,
            snippets: true,
            configs: true,
            ask_before_extract: false,
        },
        usage: {
            enabled: true,
            priority: 'vault_first',
            search_before_generate: true,
        },
        notification: {
            enabled: true,
            style: 'inline',
            emojis: false,
        },
    };

    for (const query of TEST_QUERIES) {
        console.log(`Query: "${query}"`);
        const { result, report } = await profileVaultSearch(query, instructions, vaultPath, config);
        console.log(`  -> ${report.resultCount} results in ${report.elapsedMs}ms\n`);
    }

    console.log(getVaultProfileSummary());

    const savedPath = await saveProfileReport();
    console.log(`\nReport saved to: ${savedPath}`);
}

main().catch((err) => {
    console.error('Profile runner failed:', err);
    process.exit(1);
});
