import { createCodingEngine, ConfigLoader } from '../bk-agent/node_modules/@bk/agent-coding/dist/index.js';
import { CallbackTransport } from '../bk-agent/node_modules/@bk/agent-core/dist/index.js';
import { mkdirSync } from 'fs';
import { join } from 'path';

const WORKDIR = join(import.meta.dirname, 'workspace');
mkdirSync(WORKDIR, { recursive: true });

const TASK = `
Crea un servicio TypeScript llamado UserService con las siguientes responsabilidades:

**src/user.service.ts**
- Método createUser(dto: { email: string; password: string; name: string })
  - Valida que el email tenga formato válido (regex)
  - Valida que el password tenga al menos 8 caracteres
  - Verifica que el email no exista ya (usa un Map interno como store)
  - Hashea el password con bcrypt (saltRounds: 10)
  - Retorna Result<User, AppError> donde:
    - User = { id: string; email: string; name: string; passwordHash: string }
    - AppError = { code: 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'EMAIL_EXISTS' | 'HASH_ERROR'; message: string }
- Método findByEmail(email: string): User | undefined

Usa el patrón Result propio (no librerías externas):
  type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

Luego escribe los tests unitarios cubriendo:
- createUser con datos válidos → retorna ok: true con User
- email inválido → retorna ok: false con code INVALID_EMAIL
- password corto → retorna ok: false con code WEAK_PASSWORD
- email duplicado → retorna ok: false con code EMAIL_EXISTS
- findByEmail existente → retorna el user
- findByEmail inexistente → retorna undefined

Ejecuta los tests al final.
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
    }
});

// Merge config file + env vars (env vars win)
const fileConfig = new ConfigLoader('bk-agent').load();
const providers = { ...fileConfig.providers };
if (process.env.DEEPSEEK_API_KEY)
    providers.deepseek = { ...(providers.deepseek ?? {}), apiKey: process.env.DEEPSEEK_API_KEY, model: 'deepseek-chat' };
if (process.env.ANTHROPIC_API_KEY)
    providers.anthropic = { ...(providers.anthropic ?? {}), apiKey: process.env.ANTHROPIC_API_KEY };

// Pick provider: CLI arg > env > config default
const cliProvider = process.argv[2];
const defaultProvider = cliProvider
    ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : null)
    ?? (providers[fileConfig.defaultProvider]?.apiKey ? fileConfig.defaultProvider : null)
    ?? (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'anthropic');

process.stderr.write(`\n=== EVAL START | provider: ${defaultProvider} | workdir: ${WORKDIR} ===\n\n`);

const engine = createCodingEngine({
    providers,
    defaultProvider,
    appName: 'eval',
    workingDir: WORKDIR,
    transport,
    maxIterations: 30,
    orchestration: false,
    disablePersistence: true,
});

engine.setIterationMode('auto');

try {
    await engine.run(TASK);
} catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

process.stderr.write(`\n\n${'='.repeat(50)}\n`);
process.stderr.write(`EVAL REPORT\n`);
process.stderr.write(`${'='.repeat(50)}\n`);
process.stderr.write(`Time:           ${elapsed}s\n`);
process.stderr.write(`Total tokens:   ${stats.tokens}\n`);
process.stderr.write(`Tool calls:     ${stats.toolCalls.length}\n`);
stats.toolCalls.forEach(t => process.stderr.write(`  ${t.name.padEnd(20)} ${t.args.slice(0, 60)}\n`));
process.stderr.write(`Agent switches: ${stats.agentSwitches.length}\n`);
stats.agentSwitches.forEach(s => process.stderr.write(`  ${s}\n`));
process.stderr.write(`Routing:\n`);
Object.entries(stats.routing).forEach(([id, n]) => process.stderr.write(`  ${id.padEnd(20)} × ${n}\n`));
process.stderr.write(`${'='.repeat(50)}\n`);
