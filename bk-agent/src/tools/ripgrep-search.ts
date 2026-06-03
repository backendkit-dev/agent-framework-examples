import { execFile } from 'child_process';
import { processBuffer } from '../shared/utils/encoding';

// Usa el rg del sistema si está disponible; si no, el binario bundleado por @vscode/ripgrep.
// Esto garantiza que la herramienta funcione sin requerir instalación manual de ripgrep.
function getRgBin(): string {
    if (process.env.RG_PATH) return process.env.RG_PATH;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('@vscode/ripgrep').rgPath as string;
    } catch {
        return 'rg';
    }
}

const RG_BIN = getRgBin();

export function ripgrepSearch(pattern: string, searchPath = '.', fileTypes?: string): Promise<string> {
    const args = ['--line-number', '--no-heading', pattern, searchPath];
    if (fileTypes) args.push('--type', fileTypes);

    return new Promise(resolve => {
        execFile(RG_BIN, args, { maxBuffer: 5 * 1024 * 1024, encoding: 'buffer', cwd: process.cwd() }, (err, stdout) => {
            if (err && (err as any).code === 1) resolve('Sin resultados.');
            else if (err) resolve(`Error: ${err.message}`);
            else {
                const text = processBuffer(stdout);
                resolve(text || 'Sin resultados.');
            }
        });
    });
}
