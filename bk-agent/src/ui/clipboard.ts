import { execSync } from 'child_process';

export function copyToClipboard(text: string): boolean {
    try {
        const platform = process.platform;
        if (platform === 'win32') {
            execSync('clip', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
        } else if (platform === 'darwin') {
            execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
        } else {
            execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
        }
        return true;
    } catch {
        return false;
    }
}
