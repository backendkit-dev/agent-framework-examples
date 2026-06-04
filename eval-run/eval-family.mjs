import { createCodingEngine, ConfigLoader } from '../bk-agent/node_modules/@bk/agent-coding/dist/index.js';
import { CallbackTransport } from '../bk-agent/node_modules/@bk/agent-core/dist/index.js';

const WORKDIR = 'C:/Users/mairon.cuello/development/workspace-ia/family-finance/family-finance';

const TASK = `
Implementa TransactionService en src/modules/transaction/transaction.service.ts

Lee primero el código existente para entender los patrones del proyecto:
- src/modules/auth/auth.service.ts (patrones NestJS, TypeORM)
- src/modules/transaction/entities/ (entidades disponibles)
- src/modules/transaction/dto/ (DTOs disponibles)
- src/modules/budget/budget.service.ts (referencia de lógica de negocio)

El servicio debe implementar:
1. create(dto, userId, familyGroupId) — crea una transacción, valida que el userId pertenezca al familyGroupId
2. findAll(familyGroupId, filters?) — lista transacciones del grupo, soft-delete filter automático
3. findOne(id, familyGroupId) — busca por id, valida que pertenezca al grupo (403 si no)
4. update(id, dto, familyGroupId) — actualiza, valida pertenencia y que no sea inmutable (>30 días)
5. remove(id, familyGroupId) — soft delete, valida pertenencia y regla de 30 días

Respeta los patrones del proyecto:
- Todas las queries filtradas por familyGroupId (nunca confiar en el body)
- Soft delete con deletedAt
- Lanzar NotFoundException, ForbiddenException, BadRequestException según corresponda
- Usar TypeORM Repository pattern

Luego escribe los unit tests en src/modules/transaction/transaction.service.spec.ts
cubriendo los casos happy path y los casos de error principales.
`.trim();

const stats = { tokens: 0, toolCalls: [], agentSwitches: [], routing: {} };
let startTime = Date.now();

const transport = new CallbackTransport((event) => {
    switch (event.type) {
        case 'token':
            process.stdout.write(event.content);
            break;
        case 'tool_call':
            stats.toolCalls.push({ name: event.name, args: event.args_preview ?? '' });
            process.stderr.write(`\n\x1b[33m[TOOL]\x1b[0m ${event.name}  ${(event.args_preview ?? '').slice(0, 80)}\n`);
            break;
        case 'tool_result':
            process.stderr.write(`\x1b[32m[OK]\x1b[0m   ${event.name} → ${(event.preview ?? '').slice(0, 80)}\n`);
            break;
        case 'agent_switch':
            stats.agentSwitches.push(`${event.from} → ${event.to}`);
            stats.routing[event.to] = (stats.routing[event.to] || 0) + 1;
            process.stderr.write(`\n\x1b[35m[SWITCH]\x1b[0m ${event.from} → ${event.to_name}\n`);
            break;
        case 'metrics':
            stats.tokens += (event.input_tokens ?? 0) + (event.output_tokens ?? 0);
            break;
        case 'error':
            process.stderr.write(`\n\x1b[31m[ERROR]\x1b[0m ${event.message}\n`);
            break;
        case 'system':
            process.stderr.write(`\x1b[36m[SYS]\x1b[0m  ${event.text}\n`);
            break;
    }
});

const fileConfig = new ConfigLoader('bk-agent').load();
const providers = { ...fileConfig.providers };
if (process.env.DEEPSEEK_API_KEY)
    providers.deepseek = { ...(providers.deepseek ?? {}), apiKey: process.env.DEEPSEEK_API_KEY, model: 'deepseek-chat' };
if (process.env.ANTHROPIC_API_KEY)
    providers.anthropic = { ...(providers.anthropic ?? {}), apiKey: process.env.ANTHROPIC_API_KEY };

const cliProvider = process.argv[2];
const defaultProvider = cliProvider
    ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : null)
    ?? (providers[fileConfig.defaultProvider]?.apiKey ? fileConfig.defaultProvider : null)
    ?? 'deepseek';

process.stderr.write(`\n=== EVAL family-finance | provider: ${defaultProvider} ===\n\n`);

const engine = createCodingEngine({
    providers,
    defaultProvider,
    appName: 'bk-agent',
    workingDir: WORKDIR,
    transport,
    maxIterations: 50,
    orchestration: true,
});

engine.setIterationMode('auto');

try {
    await engine.run(TASK);
} catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
process.stderr.write(`\n\n${'='.repeat(50)}\n`);
process.stderr.write(`EVAL REPORT — family-finance\n`);
process.stderr.write(`${'='.repeat(50)}\n`);
process.stderr.write(`Time:         ${elapsed}s\n`);
process.stderr.write(`Tokens:       ${stats.tokens}\n`);
process.stderr.write(`Tool calls:   ${stats.toolCalls.length}\n`);
stats.toolCalls.forEach(t => process.stderr.write(`  ${t.name.padEnd(20)} ${t.args.slice(0, 60)}\n`));
process.stderr.write(`Agent switches: ${stats.agentSwitches.length}\n`);
stats.agentSwitches.forEach(s => process.stderr.write(`  ${s}\n`));
process.stderr.write(`Routing:\n`);
Object.entries(stats.routing).forEach(([id, n]) => process.stderr.write(`  ${id.padEnd(20)} × ${n}\n`));

// Check memory was saved
const { execSync } = await import('child_process');
const projectKey = WORKDIR.replace(/[/\\]$/, '').replace(/:[/\\]/g, '--').replace(/[^a-zA-Z0-9-]/g, '-');
const memDir = `${process.env.USERPROFILE}/.bk-agent/projects/${projectKey}/memory`;
try {
    const memFiles = execSync(`dir /b "${memDir}" 2>nul`).toString().trim();
    process.stderr.write(`\nMemory files saved:\n  ${memDir}\n  ${memFiles.split('\n').join('\n  ')}\n`);
} catch {
    process.stderr.write(`\nMemory dir: ${memDir} (check manually)\n`);
}
process.stderr.write(`${'='.repeat(50)}\n`);
