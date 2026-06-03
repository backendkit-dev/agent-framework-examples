import { loadContextFiles, loadLessonsMemo } from './context-files-loader';

export function extractDeveloperProfile(userMd: string): string | null {
    const match = userMd.match(/^(?:role|profile|developer)\s*:\s*(.+)$/im);
    return match?.[1].trim().toLowerCase().replace(/\s+/g, '-') ?? null;
}

export interface LoadedContext {
    contextMarkdown: string | null;
    agentMd: string | null;
    userMd: string | null;
    lessonsMemo: string | null;
}

export interface ContextLoaderOptions {
    cwd?: string;
    contextMarkdown?: string;
}

export class ContextLoader {
    private opts: ContextLoaderOptions;

    constructor(opts: ContextLoaderOptions) {
        this.opts = opts;
    }

    async load(): Promise<LoadedContext> {
        const cwd = this.opts.cwd ?? process.cwd();
        const [contextFiles, lessonsMemo] = await Promise.all([
            loadContextFiles(cwd),
            loadLessonsMemo(),
        ]);
        return {
            contextMarkdown: this.opts.contextMarkdown ?? null,
            agentMd: contextFiles.agentMd,
            userMd: contextFiles.userMd,
            lessonsMemo,
        };
    }

    async reload(partial?: Partial<ContextLoaderOptions>): Promise<LoadedContext> {
        if (partial) this.opts = { ...this.opts, ...partial };
        return this.load();
    }
}
