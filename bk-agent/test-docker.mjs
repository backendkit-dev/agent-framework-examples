// Quick headless test: verify docker plugin connects and answers a task
import { spawn } from 'child_process';
import { createInterface } from 'readline';

const proc = spawn(
    process.execPath,
    ['dist/bin/cli.js', '--headless'],
    {
        cwd: import.meta.dirname,
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env },
        shell: false,
    },
);

const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
const lines = [];
rl.on('line', l => {
    lines.push(l);
    process.stdout.write('[BK] ' + l + '\n');
});

const task = 'Listá todos los contenedores Docker corriendo en formato tabla';
const payload = JSON.stringify({ type: 'user_input', text: task });
proc.stdin.write(payload + '\n');

await new Promise(resolve => rl.on('close', resolve));
await new Promise(resolve => proc.on('close', resolve));

const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const pluginEvents = events.filter(e => e.type === 'system' && typeof e.text === 'string' && e.text.includes('docker'));
const errorEvents  = events.filter(e => e.type === 'error');

console.log('\n─── Summary ───');
console.log('Plugins online:', pluginEvents.length > 0 ? 'yes' : 'NONE (check config)');
console.log('Errors:', errorEvents.length);
if (errorEvents.length) errorEvents.forEach(e => console.log(' -', e.message));
const done = events.find(e => e.type === 'done');
console.log('Done:', done ? 'yes' : 'no');
