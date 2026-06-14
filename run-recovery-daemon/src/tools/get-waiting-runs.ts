import * as fs   from 'fs';
import * as path from 'path';
import { defineTool, z } from '@backendkit-labs/agent-core';

export interface RunState {
    id:            string;
    flowId:        string;
    status:        string;
    failedStepId?: string;
    error?:        string;
    createdAt:     string;
    updatedAt:     string;
}

export const getWaitingRunsTool = defineTool({
    name:        'get_waiting_runs',
    description: 'Returns all flow runs currently stuck in waiting_retry state',
    input:   z.object({}),
    execute: async (): Promise<string> => {
        const dataDir = process.env.ORCHESTRATOR_DATA_DIR ?? '';
        const runsDir = path.join(dataDir, 'runs');
        if (!fs.existsSync(runsDir)) return JSON.stringify([]);

        const runs = fs.readdirSync(runsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf-8')) as RunState)
            .filter(r => r.status === 'waiting_retry');

        return JSON.stringify(runs, null, 2);
    },
});
