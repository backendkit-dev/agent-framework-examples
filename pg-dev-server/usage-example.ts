/**
 * Usage example — how to wire pg-dev-server into a coding engine.
 *
 * Flow:
 *   1. Start this server: node dist/server.js --http --port=3012
 *   2. Configure the engine with mode='tools', assignTo=['backend','data']
 *   3. The backend/data agents get pg_create, pg_apply_entities, pg_run_sql,
 *      pg_status, pg_stop in their allowedTools — no wrapper agent, no double hop.
 *
 * Sample conversation:
 *   User  → "The project needs a Postgres database. Entities: User, Product, Order"
 *   General → delegates to backend (which has the pg tools in its toolbelt)
 *   Backend → calls pg_create({db_name: 'myapp'})
 *           → calls pg_apply_entities({container_name, entities: [...]})
 *           → reports back: connection string, tables created, ready to use
 */

import { createCodingEngine } from '@bk/agent-coding';
import { CallbackTransport } from '@bk/agent-core';

const transport = new CallbackTransport((event) => {
    if (event.type === 'token') process.stdout.write(event.content);
    if (event.type === 'block_start') console.log(`\n[${event.agent_name ?? event.agent_id}]`);
    if (event.type === 'tool_call') console.log(`  → ${event.name}`);
    if (event.type === 'system') console.log(`  [${event.level}] ${event.text}`);
    if (event.type === 'done') console.log('\n--- done ---');
});

const engine = createCodingEngine({
    providers: {
        anthropic: {
            provider: 'anthropic',
            apiKey: process.env.ANTHROPIC_API_KEY ?? '',
        },
    },
    defaultProvider: 'anthropic',
    transport,

    mcpServers: [
        {
            name: 'pg-dev',

            // HTTP mode: server running separately
            url: 'http://127.0.0.1:3012/mcp',

            // Or stdio mode: server spawned as subprocess
            // command: 'node',
            // args: ['./examples/pg-dev-server/dist/server.js'],

            // mode='tools': tools injected into assignTo agents — no wrapper agent
            mode: 'tools',
            assignTo: ['backend', 'data'],

            // Optional: keyword shortcuts that bypass the LLM entirely
            toolTriggers: {
                'pg status': 'pg_status',
                'stop postgres': 'pg_stop',
            },
        },
    ],
});

// The backend and data agents now have these tools in their allowedTools:
//   mcp__pg_dev__pg_create
//   mcp__pg_dev__pg_apply_entities
//   mcp__pg_dev__pg_run_sql
//   mcp__pg_dev__pg_status
//   mcp__pg_dev__pg_stop
//
// Example interaction:
await engine.run(
    'The project needs a Postgres database. ' +
    'Create a local instance and set up these entities: ' +
    'User (id: uuid PK, email: string unique, name: string, created_at: timestamp default now()), ' +
    'Product (id: uuid PK, name: string, price: decimal, stock: integer default 0), ' +
    'Order (id: uuid PK, user_id: uuid FK→User.id, total: decimal, status: string default pending, created_at: timestamp default now()). ' +
    'Report the connection string when ready.'
);
