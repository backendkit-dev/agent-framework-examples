# Ejemplos de Implementación: Autocompletado sin `/`

## Opción 1: Extender Terminal Completer (Para REPL Interactivo)

### Paso 1: Actualizar `src/ui/terminal.ts`

```typescript
// En TerminalOptions interface (línea 25):
export interface TerminalOptions {
    completions?: string[];
    cliCommands?: CliCommandDef[];  // NUEVO
    onLine: (line: string) => Promise<void>;
    onEscape?: () => void;
    onClose?: () => void | Promise<void>;
    messageBuffer?: MessageBuffer;
}

// Nuevo tipo para definir comandos CLI
export interface CliCommandDef {
    name: string;
    subcommands?: string[];
    flags?: string[];
    description?: string;
}

// En el constructor, actualizar el completer (línea 144):
const completer = opts.completions || opts.cliCommands
    ? (line: string, callback: (err: Error | null, result: readline.CompleterResult) => void): void => {
        // 1. Slash commands (código existente)
        if (line.startsWith('/')) {
            const hits = (opts.completions ?? []).filter(c => c.startsWith(line));
            callback(null, [hits.length ? hits : (opts.completions ?? []).filter(c => c.startsWith('/')), line]);
            return;
        }

        // 2. CLI commands (NUEVO)
        const trimmed = line.trim();
        const parts = trimmed.split(/\s+/);
        
        // Si es el primer token (sin espacio), completar comandos principales
        if (parts.length === 1 && !line.endsWith(' ')) {
            const cliCmds = opts.cliCommands ?? [];
            const matches = cliCmds
                .map(cmd => cmd.name)
                .filter(name => name.startsWith(trimmed))
                .map(name => name);
            
            if (matches.length > 0) {
                callback(null, [matches, line]);
                return;
            }
        }

        // Si hay 1+ espacios, completar subcomandos o flags
        if (parts.length >= 1 && line.endsWith(' ')) {
            const cmdName = parts[0];
            const cmd = opts.cliCommands?.find(c => c.name === cmdName);
            
            if (cmd && cmd.subcommands) {
                const suggestions = cmd.subcommands.map(sub => cmdName + ' ' + sub);
                callback(null, [suggestions, line]);
                return;
            }
        }

        // Si está escribiendo flags (--flag)
        if (line.includes('--')) {
            const cmdName = parts[0];
            const cmd = opts.cliCommands?.find(c => c.name === cmdName);
            
            if (cmd && cmd.flags) {
                const prefix = line.match(/--\w*$/)?.[0] || '--';
                const matches = cmd.flags
                    .filter(f => f.startsWith(prefix))
                    .map(f => line.slice(0, -prefix.length) + f);
                
                if (matches.length > 0) {
                    callback(null, [matches, line]);
                    return;
                }
            }
        }

        // 3. @ file autocomplete (código existente)
        const atMatch = line.match(/@(\S*)$/);
        if (atMatch) {
            const prefix = atMatch[1];
            import('fs').then(fs => {
                import('path').then(pathMod => {
                    try {
                        const dir = prefix.includes('/') ? pathMod.dirname(prefix) : '.';
                        const base = prefix.includes('/') ? pathMod.basename(prefix) : prefix;
                        const entries = fs.readdirSync(dir === '' ? '.' : dir, { withFileTypes: true });
                        const matches = entries
                            .filter(e => e.name.startsWith(base))
                            .slice(0, 15)
                            .map(e => {
                                const rel = dir === '.' ? e.name : dir + '/' + e.name;
                                return line.slice(0, line.length - atMatch[1].length) + rel + (e.isDirectory() ? '/' : '');
                            });
                        callback(null, [matches, line]);
                    } catch {
                        callback(null, [[], line]);
                    }
                });
            });
            return;
        }

        callback(null, [[], line]);
    }
    : undefined;
```

### Paso 2: Actualizar `bin/cli.ts`

```typescript
// Agregar función para extraer comandos (antes del programa):
function extractCliCommands(): CliCommandDef[] {
    return [
        {
            name: 'domain',
            subcommands: ['add', 'remove', 'enable', 'disable', 'list', 'show'],
            flags: ['--name', '--description', '--failure-types', '--help'],
            description: 'Gestionar dominios de aprendizaje'
        },
        {
            name: 'skills',
            subcommands: ['list', 'install', 'remove', 'enable', 'disable'],
            flags: ['--name', '--help'],
            description: 'Gestionar skills'
        },
        {
            name: 'checkpoint',
            subcommands: ['create', 'list', 'load', 'delete'],
            flags: ['--name', '--id', '--help'],
            description: 'Gestionar checkpoints'
        },
        {
            name: 'workspace',
            subcommands: ['create', 'list', 'add', 'remove', 'switch'],
            flags: ['--name', '--path', '--workspace', '--project', '--help'],
            description: 'Gestionar workspaces'
        }
    ];
}

// En la sección donde se crea el Terminal (buscar "new Terminal"):
const cliCommands = extractCliCommands();
terminal = new Terminal({
    completions: SLASH_COMMANDS,
    cliCommands,  // NUEVO
    onLine: async (raw) => {
        // ... código existente
    },
    onEscape: () => { ... },
    onClose: () => { ... },
    messageBuffer,
});
```

---

## Opción 2: Commander.js Shell Completions (Para Shell Directo)

### Paso 1: Crear `src/shell-completion.ts`

```typescript
import { Command } from 'commander';

/**
 * Genera completions para bash, zsh, pwsh
 * Uso: eval "$(bk-agent completion bash)"
 */
export function createCompletionCommand(program: Command): Command {
    const completionCmd = new Command('completion')
        .description('Generate shell completion script')
        .arguments('<shell>')
        .option('-o, --output <file>', 'Save to file instead of stdout')
        .action(async (shell, options) => {
            const script = generateCompletionScript(program, shell);
            
            if (options.output) {
                const fs = await import('fs');
                fs.writeFileSync(options.output, script);
                console.log(`Completion script saved to ${options.output}`);
            } else {
                console.log(script);
            }
        });

    return completionCmd;
}

function generateCompletionScript(program: Command, shell: string): string {
    const commands = extractCommandsForCompletion(program);

    switch (shell) {
        case 'bash':
            return generateBashCompletion(commands);
        case 'zsh':
            return generateZshCompletion(commands);
        case 'pwsh':
        case 'powershell':
            return generatePowershellCompletion(commands);
        default:
            throw new Error(`Unsupported shell: ${shell}`);
    }
}

interface CommandInfo {
    name: string;
    subcommands: string[];
    flags: string[];
    description: string;
}

function extractCommandsForCompletion(program: Command): CommandInfo[] {
    // Aquí iría la lógica para extraer comandos del programa commander
    // Por ahora, retornar comandos conocidos
    return [
        {
            name: 'domain',
            subcommands: ['add', 'remove', 'enable', 'disable', 'list', 'show'],
            flags: ['-n, --name', '-d, --description', '--failure-types'],
            description: 'Manage domains'
        },
        {
            name: 'skills',
            subcommands: ['list', 'install', 'remove'],
            flags: ['-n, --name'],
            description: 'Manage skills'
        },
        // ... más comandos
    ];
}

function generateBashCompletion(commands: CommandInfo[]): string {
    const cmdNames = commands.map(c => c.name).join(' ');
    
    return `#!/bin/bash

# bk-agent bash completion script
# To enable: eval "$(bk-agent completion bash)"

_bk_agent_complete() {
    local cur prev words cword
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    
    # Main commands
    local commands="${cmdNames}"
    
    # Si estamos en el primer argumento, completar comandos
    if [[ \$COMP_CWORD -eq 1 ]]; then
        COMPREPLY=($(compgen -W "\$commands" -- "\$cur"))
        return 0
    fi
    
    # Si el primer argumento es 'domain', completar subcomandos
    if [[ "\${COMP_WORDS[1]}" == "domain" && \$COMP_CWORD -eq 2 ]]; then
        COMPREPLY=($(compgen -W "add remove enable disable list show" -- "\$cur"))
        return 0
    fi
    
    # Completar flags
    if [[ \$cur == -* ]]; then
        local flags="--help --api-key --model --base-url --max-iterations --iteration-mode --command-timeout"
        COMPREPLY=($(compgen -W "\$flags" -- "\$cur"))
        return 0
    fi
}

complete -o bashdefault -o default -o nospace -F _bk_agent_complete bk-agent
complete -o bashdefault -o default -o nospace -F _bk_agent_complete deepseek-code
`;
}

function generateZshCompletion(commands: CommandInfo[]): string {
    const zshCmds = commands
        .map(c => `'${c.name}:${c.description}'`)
        .join(' ');

    return `#compdef bk-agent deepseek-code

_bk_agent() {
    local -a commands=(
        ${zshCmds}
    )

    _describe 'bk-agent commands' commands
}

_bk_agent
`;
}

function generatePowershellCompletion(commands: CommandInfo[]): string {
    return `# PowerShell completion for bk-agent
# Save to $PROFILE and add: . "$PSScriptRoot/completion.ps1"

$scriptblock = {
    param($wordToComplete, $commandAst, $cursorPosition)

    $tokens = $commandAst.ToString().Split()
    $cmdName = $tokens[0]
    $firstArg = if ($tokens.Count -gt 1) { $tokens[1] } else { '' }
    
    $allCommands = @('domain', 'skills', 'checkpoint', 'workspace')
    
    if ($tokens.Count -eq 1) {
        # Complete main commands
        $allCommands | Where-Object { $_ -like "$wordToComplete*" } | 
            ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
}

Register-ArgumentCompleter -CommandName bk-agent -ScriptBlock $scriptblock
Register-ArgumentCompleter -CommandName deepseek-code -ScriptBlock $scriptblock
`;
}
```

### Paso 2: Registrar en `bin/cli.ts`

```typescript
import { createCompletionCommand } from '../src/shell-completion';

// Antes de program.parse():
program.addCommand(createCompletionCommand(program));

// Luego los usuarios pueden hacer:
// $ eval "$(bk-agent completion bash)"
// $ eval "$(bk-agent completion zsh)"
// $ . (bk-agent completion powershell | Out-String)
```

---

## Uso Final

### Terminal Interactivo (Opción 1)
```bash
$ bk-agent
❯ domai<TAB>
domain

❯ domain <TAB>
add  disable  enable  list  remove  show

❯ domain add --<TAB>
--name  --description  --failure-types  --help
```

### Shell Directo (Opción 2)
```bash
# Instalación (una sola vez)
$ eval "$(bk-agent completion bash)"

# Uso
$ bk-agent domain <TAB>
add  disable  enable  list  remove  show
```

---

## Próximos Pasos

1. ¿Empezamos por Opción 1 (Terminal) o Opción 2 (Shell)?
2. ¿Necesitas que incluya más comandos específicos del proyecto?
3. ¿Quieres que implemente ambas versiones?
