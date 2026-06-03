import { AgentClient } from '../api/client';
import { AgentLoop } from '../agent/loop';
import { ToolCall } from '../api/types';
import { ToolExecutorOptions } from '../agent/tool-executor';
import { AIAssistantConfig, Instructions } from '../types/config';
import { getToolDefinitions } from '../tools/definitions';
import { ToolResult } from '../tools/types';
import { saveToVault } from './save-to-vault';
import chalk from 'chalk';

export async function runResearch(
    topic: string,
    client: AgentClient,
    config: AIAssistantConfig,
    instructions: Instructions,
    vaultPath: string
) {
    if (!vaultPath) return '❌ No hay vault configurado.';

    const tools = [
        ...getToolDefinitions().filter(t => !['write_file', 'execute_command'].includes(t.function.name)),
        {
            type: 'function' as const,
            function: {
                name: 'save_to_vault',
                description: 'Guarda artículo en vault',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        content: { type: 'string' },
                        category: { type: 'string' },
                        tags: { type: 'string' },
                    },
                    required: ['title', 'content', 'category'],
                },
            },
        },
    ];

    const agent = new AgentLoop({
        client,
        config: { ...config, extraction: { ...config.extraction, enabled: false } },
        instructions,
        vaultPath,
        contextMarkdown: '',
        tools,
        askConfirmation: async (msg: string) => {
            console.log(chalk.yellow(`\n⚠️  Confirmación requerida: ${msg}`));
            return true;
        },
        onToolCall: name => console.log(chalk.blue(`🔍 ${name}`)),
        onResponse: content => process.stdout.write(chalk.green(content)),
    });

    agent.setToolExecutor(async (tc: ToolCall, opts: ToolExecutorOptions) => {
        if (tc.function.name === 'save_to_vault') {
            const a = JSON.parse(tc.function.arguments);
            const data = await saveToVault(a.title, a.content, a.category, a.tags || '', vaultPath);
            return ToolResult.success(data);
        }
        return agent.executeBuiltinTool(tc, opts);
    });

    console.log(chalk.cyan(`\n🔬 Investigando: "${topic}"\n`));
    return agent.processInput(`Investiga y genera artículo markdown sobre: ${topic}`);
}
