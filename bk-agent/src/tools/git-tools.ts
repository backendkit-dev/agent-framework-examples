import { execFile } from 'child_process';

export function gitDiff(staged?: boolean, file?: string): Promise<string> {
    const args = ['diff'];
    if (staged) args.push('--staged');
    if (file) args.push('--', file);

    return new Promise(resolve => {
        execFile('git', args, { cwd: process.cwd() }, (err, stdout) => {
            if (err) resolve(`Error: ${err.message}`);
            else resolve(stdout || 'No changes.');
        });
    });
}
