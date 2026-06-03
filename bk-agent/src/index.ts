#!/usr/bin/env node
import { Command } from 'commander';
import { runHeadless } from './headless';
import { runInteractive } from './interactive';

const program = new Command();

program
    .name('bk-agent')
    .description('Multi-agent coding assistant — interactive or headless (JSON-Lines) mode')
    .option('--headless',              'Run in headless mode (JSON-Lines stdin/stdout)')
    .option('--api-key <key>',         'API key (overrides env var)')
    .option('--model <model>',         'LLM model to use')
    .option('--cwd <path>',            'Working directory', process.cwd())
    .option('--agent <id>',            'Default agent id', 'general')
    .option('--app-name <name>',       'App name for config/memory dirs', 'bk-agent')
    .option('--iteration-mode <mode>', 'auto | interactive | step', 'interactive')
    .option('--max-iterations <n>',    'Max tool iterations per run', '25')
    .option('--provider <name>',       'Provider: anthropic | deepseek | openai')
    .parse(process.argv);

const opts = program.opts<{
    headless:       boolean;
    apiKey?:        string;
    model?:         string;
    cwd:            string;
    agent:          string;
    appName:        string;
    iterationMode:  string;
    maxIterations:  string;
    provider?:      string;
}>();

// Inject CLI args into env so ConfigLoader picks them up
if (opts.apiKey) {
    const prov = opts.provider ?? guessProvider(opts.apiKey);
    if (prov === 'anthropic') process.env.ANTHROPIC_API_KEY = opts.apiKey;
    else if (prov === 'deepseek') process.env.DEEPSEEK_API_KEY = opts.apiKey;
    else process.env.OPENAI_API_KEY = opts.apiKey;
}

function guessProvider(key: string): string {
    if (key.startsWith('sk-ant-')) return 'anthropic';
    return 'deepseek';
}

const ctx = {
    appName:       opts.appName,
    cwd:           opts.cwd,
    agentId:       opts.agent,
    model:         opts.model,
    iterationMode: opts.iterationMode as 'auto' | 'interactive' | 'step-by-step',
    maxIterations: parseInt(opts.maxIterations, 10),
};

if (opts.headless) {
    runHeadless(ctx).catch(err => { console.error(err); process.exit(1); });
} else {
    runInteractive(ctx).catch(err => { console.error(err); process.exit(1); });
}
