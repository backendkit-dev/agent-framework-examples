#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
    createPostgresContainer,
    waitUntilReady,
    runSQL,
    stopContainer,
    getContainerStatus,
    getContainerCredentials,
    type PostgresContainer,
} from './docker.js';
import { entitiesToMigration, type EntityDef } from './sql-generator.js';

// ── State ─────────────────────────────────────────────────────────────────────
// Tracks containers created in this server process lifetime.
// In a persistent HTTP server this survives across requests.
const containers = new Map<string, PostgresContainer>();

// ── Schema helpers ─────────────────────────────────────────────────────────────

const EntityFieldSchema = z.object({
    name:       z.string(),
    type:       z.enum(['uuid', 'string', 'text', 'integer', 'bigint', 'decimal', 'boolean', 'timestamp', 'json', 'jsonb']),
    primary:    z.boolean().optional(),
    unique:     z.boolean().optional(),
    nullable:   z.boolean().optional(),
    default:    z.string().optional(),
    length:     z.number().optional(),
    references: z.object({ entity: z.string(), field: z.string() }).optional(),
});

const EntitySchema = z.object({
    name:    z.string(),
    fields:  z.array(EntityFieldSchema),
    indexes: z.array(z.object({
        fields: z.array(z.string()),
        unique: z.boolean().optional(),
    })).optional(),
});

// ── Server factory ─────────────────────────────────────────────────────────────

function buildServer(): McpServer {
    const srv = new McpServer({
        name: 'pg-dev-server',
        version: '1.0.0',
    });
    registerTools(srv);
    return srv;
}

function registerTools(srv: McpServer): void {

// ---------------------------------------------------------------------------
// pg_create — spins up a PostgreSQL container and waits until it's ready
// ---------------------------------------------------------------------------
srv.tool(
    'pg_create',
    'Start a PostgreSQL Docker container for development. Waits until the database is accepting connections before returning. Returns the connection string and container info.',
    {
        db_name:        z.string().optional().describe('Database name (default: devdb)'),
        user:           z.string().optional().describe('Postgres user (default: postgres)'),
        password:       z.string().optional().describe('Postgres password (default: postgres)'),
        port:           z.number().optional().describe('Host port to bind (default: 5432)'),
        pg_version:     z.string().optional().describe('Postgres image tag (default: 16-alpine)'),
        container_name: z.string().optional().describe('Docker container name (default: pg-dev-{timestamp})'),
        timeout_ms:     z.number().optional().describe('Max wait time in ms for postgres to be ready (default: 30000)'),
    },
    async ({ db_name, user, password, port, pg_version, container_name, timeout_ms }) => {
        try {
            const container = createPostgresContainer({
                dbName:        db_name,
                user,
                password,
                port,
                pgVersion:     pg_version,
                containerName: container_name,
            });

            await waitUntilReady(container.containerName, timeout_ms);
            containers.set(container.containerName, container);

            return {
                content: [{
                    type: 'text' as const,
                    text: [
                        '✅ PostgreSQL is ready.',
                        '',
                        `Container:         ${container.containerName} (${container.containerId})`,
                        `Port:              ${container.port}`,
                        `Database:          ${container.dbName}`,
                        `User:              ${container.user}`,
                        `Connection string: ${container.connectionString}`,
                        '',
                        'Next steps: call pg_apply_entities to create tables, or pg_run_sql to run migrations.',
                    ].join('\n'),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text' as const, text: `❌ Failed to start PostgreSQL: ${(err as Error).message}` }],
                isError: true,
            };
        }
    },
);

// ---------------------------------------------------------------------------
// pg_apply_entities — generate CREATE TABLE SQL from entity definitions and apply it
// ---------------------------------------------------------------------------
srv.tool(
    'pg_apply_entities',
    'Generate PostgreSQL CREATE TABLE statements from entity definitions and apply them to a running container. Accepts an array of entity objects describing table structure (fields, types, primary keys, foreign keys, indexes).',
    {
        container_name: z.string().describe('Name of the running postgres container (from pg_create)'),
        entities:       z.array(EntitySchema).describe('Entity definitions to apply as tables'),
        preview_only:   z.boolean().optional().describe('If true, return the SQL without executing it (default: false)'),
    },
    async ({ container_name, entities, preview_only }) => {
        const sql = entitiesToMigration(entities as EntityDef[]);

        if (preview_only) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `Generated migration SQL (not applied):\n\n\`\`\`sql\n${sql}\n\`\`\``,
                }],
            };
        }

        try {
            const container = containers.get(container_name);
            const user = container?.user ?? 'postgres';
            const dbName = container?.dbName ?? 'devdb';

            const result = runSQL(container_name, user, dbName, sql);
            const tableNames = entities.map((e: { name: string }) => e.name).join(', ');

            return {
                content: [{
                    type: 'text' as const,
                    text: [
                        `✅ Applied ${entities.length} entit${entities.length === 1 ? 'y' : 'ies'}: ${tableNames}`,
                        '',
                        'Postgres output:',
                        result,
                        '',
                        'Generated SQL:',
                        '```sql',
                        sql,
                        '```',
                    ].join('\n'),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text' as const, text: `❌ Migration failed: ${(err as Error).message}\n\nSQL attempted:\n${sql}` }],
                isError: true,
            };
        }
    },
);

// ---------------------------------------------------------------------------
// pg_run_sql — execute arbitrary SQL (migrations, seeds, queries)
// ---------------------------------------------------------------------------
srv.tool(
    'pg_run_sql',
    'Execute arbitrary SQL against a running PostgreSQL container. Use for manual migrations, seed data, or verification queries.',
    {
        container_name: z.string().describe('Name of the running postgres container'),
        sql:            z.string().describe('SQL to execute'),
        db_name:        z.string().optional().describe('Target database (overrides container default)'),
        user:           z.string().optional().describe('Postgres user (overrides container default)'),
    },
    async ({ container_name, sql, db_name, user }) => {
        try {
            const container = containers.get(container_name);
            const effectiveUser = user ?? container?.user ?? 'postgres';
            const effectiveDb = db_name ?? container?.dbName ?? 'devdb';

            const result = runSQL(container_name, effectiveUser, effectiveDb, sql);
            return {
                content: [{ type: 'text' as const, text: `✅ SQL executed successfully.\n\n${result}` }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text' as const, text: `❌ SQL error: ${(err as Error).message}` }],
                isError: true,
            };
        }
    },
);

// ---------------------------------------------------------------------------
// pg_status — check container health
// ---------------------------------------------------------------------------
srv.tool(
    'pg_status',
    'Check the status of a PostgreSQL Docker container — whether it exists, is running, and is accepting connections.',
    {
        container_name: z.string().describe('Name of the container to check'),
    },
    ({ container_name }) => {
        const container = containers.get(container_name);
        const status = getContainerStatus(container_name, container?.connectionString);

        if (!status.exists) {
            return {
                content: [{ type: 'text' as const, text: `❌ Container "${container_name}" not found.` }],
            };
        }

        const lines = [
            `Container:  ${container_name}`,
            `Running:    ${status.running ? '✅ yes' : '❌ no'}`,
            `Healthy:    ${status.healthy ? '✅ accepting connections' : '⏳ not ready'}`,
        ];
        if (status.connectionString) lines.push(`Connection: ${status.connectionString}`);

        return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
    },
);

// ---------------------------------------------------------------------------
// pg_stop — stop and remove a container
// ---------------------------------------------------------------------------
srv.tool(
    'pg_stop',
    'Stop and remove a PostgreSQL Docker container. All data in the container is lost — use this for ephemeral dev/test databases only.',
    {
        container_name: z.string().describe('Name of the container to stop and remove'),
    },
    ({ container_name }) => {
        try {
            stopContainer(container_name);
            containers.delete(container_name);
            return {
                content: [{ type: 'text' as const, text: `✅ Container "${container_name}" stopped and removed.` }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text' as const, text: `❌ Failed to stop container: ${(err as Error).message}` }],
                isError: true,
            };
        }
    },
);

// ---------------------------------------------------------------------------
// pg_get_env — return credentials ready for .env / connection pool config
// ---------------------------------------------------------------------------
srv.tool(
    'pg_get_env',
    'Return the credentials of a running PostgreSQL container in multiple formats: ' +
    '.env file content, individual variables, and connection string. ' +
    'Use this after pg_create so other agents (backend, infrastructure) can configure ' +
    'database connections without needing the credentials to be passed manually.',
    {
        container_name: z.string().describe('Name of the running postgres container'),
        format: z.enum(['env', 'json', 'url', 'all']).optional()
            .describe('Output format — env (.env file), json (object), url (connection string only), all (default: all)'),
    },
    ({ container_name, format = 'all' }) => {
        // Try in-memory map first (container created in this session)
        const cached = containers.get(container_name);
        const creds = cached
            ? {
                containerName: cached.containerName,
                host:          'localhost',
                port:          cached.port,
                dbName:        cached.dbName,
                user:          cached.user,
                password:      cached.password,
                connectionString: cached.connectionString,
            }
            : getContainerCredentials(container_name);

        if (!creds) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `❌ Container "${container_name}" not found or not running. Run pg_create first.`,
                }],
                isError: true,
            };
        }

        const envBlock = [
            `DATABASE_URL=${creds.connectionString}`,
            `POSTGRES_HOST=${creds.host}`,
            `POSTGRES_PORT=${creds.port}`,
            `POSTGRES_DB=${creds.dbName}`,
            `POSTGRES_USER=${creds.user}`,
            `POSTGRES_PASSWORD=${creds.password}`,
        ].join('\n');

        const jsonBlock = JSON.stringify({
            host:     creds.host,
            port:     creds.port,
            database: creds.dbName,
            user:     creds.user,
            password: creds.password,
        }, null, 2);

        if (format === 'url') {
            return { content: [{ type: 'text' as const, text: creds.connectionString }] };
        }

        if (format === 'env') {
            return { content: [{ type: 'text' as const, text: `\`\`\`env\n${envBlock}\n\`\`\`` }] };
        }

        if (format === 'json') {
            return { content: [{ type: 'text' as const, text: `\`\`\`json\n${jsonBlock}\n\`\`\`` }] };
        }

        // 'all' — return everything so any agent can pick what it needs
        return {
            content: [{
                type: 'text' as const,
                text: [
                    `## Credentials — ${container_name}`,
                    '',
                    '### .env',
                    '```env',
                    envBlock,
                    '```',
                    '',
                    '### Connection string',
                    '```',
                    creds.connectionString,
                    '```',
                    '',
                    '### JSON (for pg Pool config)',
                    '```json',
                    jsonBlock,
                    '```',
                ].join('\n'),
            }],
        };
    },
);

} // end registerTools

// ── Transport ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const HTTP_MODE = args.includes('--http');
const portIdx   = args.indexOf('--port');
const portArg   = args.find(a => a.startsWith('--port='))?.split('=')[1]
               ?? (portIdx !== -1 ? args[portIdx + 1] : undefined);
const HTTP_PORT = parseInt(portArg ?? '3012', 10);

async function main(): Promise<void> {
    if (HTTP_MODE) {
        await startHttp();
    } else {
        await startStdio();
    }
}

async function startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
}

async function startHttp(): Promise<void> {
    const sessions = new Map<string, StreamableHTTPServerTransport>();

    async function parseBody(req: IncomingMessage): Promise<unknown> {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw) return undefined;
        return JSON.parse(raw);
    }

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (req.url !== '/mcp') {
            res.writeHead(404);
            res.end('Use POST /mcp');
            return;
        }

        try {
            const sessionId = req.headers['mcp-session-id'] as string | undefined;

            if (sessionId && sessions.has(sessionId)) {
                const body = req.method === 'POST' ? await parseBody(req) : undefined;
                await sessions.get(sessionId)!.handleRequest(req, res, body);
                return;
            }

            if (req.method !== 'POST') {
                res.writeHead(400);
                res.end('Session ID required for GET');
                return;
            }

            const body = await parseBody(req);
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
            });

            const sessionServer = buildServer();
            await sessionServer.connect(transport);
            await transport.handleRequest(req, res, body);

            if (transport.sessionId) {
                sessions.set(transport.sessionId, transport);
                transport.onclose = () => sessions.delete(transport.sessionId!);
            }
        } catch (err) {
            if (!res.headersSent) {
                res.writeHead(500);
                res.end(String(err));
            }
        }
    });

    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
            process.stderr.write(
                `[pg-dev-server] HTTP listening on http://127.0.0.1:${HTTP_PORT}/mcp\n` +
                `[pg-dev-server] Tools: pg_create, pg_apply_entities, pg_run_sql, pg_status, pg_stop\n`
            );
            resolve();
        });
    });
}

main().catch(err => {
    process.stderr.write(`[pg-dev-server] Fatal: ${(err as Error).message}\n`);
    process.exit(1);
});
