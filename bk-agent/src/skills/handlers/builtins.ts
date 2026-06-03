import * as path from 'path';
import * as fs from 'fs/promises';
import { exec, spawn } from 'child_process';
import { registerSkillHandler } from '../registry';
import { ripgrepSearch } from '../../tools/ripgrep-search';
import { gitDiff } from '../../tools/git-tools';
import { searchVaultPatterns } from '../../vault/search';
import { extractToVault } from '../../vault/extractor';
import { defaultInstructions } from '../../types/config';
import { updateProjectContext, updateSessionMemory } from '../../memory/updater';
import { BuiltinHandlerContext } from './builtin-context';
import { CommandClassifier, SERVER_STARTUP_WAIT_MS } from './command-classifier';

// -- Helpers puros ----------------------------------------------------------

function sanitizeErrorMessage(raw: string, projectRoot: string): string {
    const escapedRoot = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return raw
        .replace(new RegExp(escapedRoot, 'gi'), '<PROJECT_ROOT>')
        .replace(/[A-Z]:\\[^\s,;:")]*/gi, (m) =>
            m.includes(projectRoot.slice(0, 3))
                ? '<PROJECT_ROOT>' + m.slice(projectRoot.length)
                : '<SYSTEM_PATH>'
        );
}

function buildDiffPreview(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const preview: string[] = [];
    const maxLines = 30;
    let shown = 0;

    for (let i = 0; i < Math.max(oldLines.length, newLines.length) && shown < maxLines; i++) {
        const o = oldLines[i];
        const n = newLines[i];
        if (o === undefined) { preview.push(`+ ${n}`); shown++; }
        else if (n === undefined) { preview.push(`- ${o}`); shown++; }
        else if (o !== n) { preview.push(`- ${o}`); preview.push(`+ ${n}`); shown += 2; }
    }

    const total = Math.max(oldLines.length, newLines.length);
    if (total > maxLines) preview.push(`... (${maxLines} de ${total} lineas)`);
    return preview.length ? preview.join('\n') : '(sin cambios de lineas)';
}

// -- Registro de handlers ---------------------------------------------------

export function registerBuiltinHandlers(ctx: BuiltinHandlerContext) {
    const classifier = new CommandClassifier(ctx.classifierOptions);
    const allowlist = ctx.pathAllowlist;

    // -- read_file ----------------------------------------------------------
    registerSkillHandler('read_file', async (args) => {
        const file_path = args.file_path as string;
        if (!allowlist.isAllowed(file_path)) return `Acceso denegado: ${file_path} no esta en la lista blanca de rutas permitidas.`;
        if (classifier.isSensitivePath(file_path)) {
            const ok = ctx.askConfirmation ? await ctx.askConfirmation(`Leer archivo sensible: ${file_path}?`) : false;
            if (!ok) return 'Cancelado.';
        }
        return await fs.readFile(file_path, 'utf-8');
    });

    // -- write_file ---------------------------------------------------------
    registerSkillHandler('write_file', async (args) => {
        const file_path = args.file_path as string;
        const content = args.content as string;
        if (!allowlist.isAllowed(file_path)) return `Acceso denegado: ${file_path} no esta en la lista blanca de rutas permitidas.`;
        if (classifier.isSensitivePath(file_path)) {
            const ok = ctx.askConfirmation ? await ctx.askConfirmation(`Escribir archivo sensible: ${file_path}?`) : false;
            if (!ok) return 'Cancelado.';
        }
        let preview = '';
        try {
            const existing = await fs.readFile(file_path, 'utf-8');
            preview = `\n--- Diff (${path.basename(file_path)}) ---\n${buildDiffPreview(existing, content)}`;
        } catch {
            const lines = content.split('\n').slice(0, 20).join('\n');
            const more = content.split('\n').length > 20 ? `\n... (+${content.split('\n').length - 20} lineas)` : '';
            preview = `\n--- Contenido nuevo (${path.basename(file_path)}) ---\n${lines}${more}`;
        }
        const ok = ctx.askConfirmation ? await ctx.askConfirmation(`Escribir en ${file_path}?${preview}`) : true;
        if (!ok) return 'Cancelado.';
        await fs.mkdir(path.dirname(file_path), { recursive: true });
        await fs.writeFile(file_path, content, 'utf-8');
        return `Escrito en ${file_path}`;
    });

    // -- edit_file ----------------------------------------------------------
    registerSkillHandler('edit_file', async (args) => {
        const file_path = args.file_path as string;
        const old_string = args.old_string as string;
        const new_string = args.new_string as string;
        const replace_all = Boolean(args.replace_all ?? false);

        if (!allowlist.isAllowed(file_path)) return `Acceso denegado: ${file_path} no esta en la lista blanca de rutas permitidas.`;

        let content: string;
        try {
            content = await fs.readFile(file_path, 'utf-8');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return `Error: no se pudo leer ${file_path}: ${sanitizeErrorMessage(msg, ctx.projectRoot)}`;
        }

        const normalizeLE = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const normContent = normalizeLE(content);
        const normOld = normalizeLE(old_string);
        const normNew = normalizeLE(new_string);

        const occurrences = normContent.split(normOld).length - 1;
        if (occurrences === 0) return `Error: old_string no encontrado en ${path.basename(file_path)}. Verifica el texto exacto incluyendo espacios e indentacion.`;
        if (!replace_all && occurrences > 1) return `Error: old_string aparece ${occurrences} veces en ${path.basename(file_path)}. Amplia el contexto para hacerlo unico, o usa replace_all: true.`;

        const newContent = replace_all
            ? normContent.split(normOld).join(normNew)
            : normContent.replace(normOld, normNew);

        try { await fs.writeFile(file_path, newContent, 'utf-8'); }
        catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return `Error al escribir ${file_path}: ${sanitizeErrorMessage(msg, ctx.projectRoot)}`;
        }

        const countMsg = replace_all && occurrences > 1 ? ` (x${occurrences})` : '';
        const diff = buildDiffPreview(normContent, newContent);
        return `${path.basename(file_path)} editado${countMsg}\n${diff}`;
    });

    // -- multi_edit ---------------------------------------------------------
    registerSkillHandler('multi_edit', async (args) => {
        const file_path = args.file_path as string;
        const edits = args.edits as Array<{ old_string: string; new_string: string }>;

        if (!allowlist.isAllowed(file_path)) return `Acceso denegado: ${file_path} no esta en la lista blanca de rutas permitidas.`;
        if (!Array.isArray(edits) || edits.length === 0) return `Error: edits debe ser un array no vacio.`;

        let content: string;
        try {
            content = await fs.readFile(file_path, 'utf-8');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return `Error: no se pudo leer ${file_path}: ${sanitizeErrorMessage(msg, ctx.projectRoot)}`;
        }

        const normalizeLE = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        let current = normalizeLE(content);
        const results: string[] = [];

        for (let i = 0; i < edits.length; i++) {
            const { old_string, new_string } = edits[i];
            const normOld = normalizeLE(old_string);
            const normNew = normalizeLE(new_string);
            const occurrences = current.split(normOld).length - 1;
            if (occurrences === 0) {
                results.push(`[${i + 1}] SKIP: old_string not found — "${normOld.slice(0, 50).replace(/\n/g, '\\n')}"`);
                continue;
            }
            current = current.replace(normOld, normNew);
            results.push(`[${i + 1}] OK`);
        }

        try { await fs.writeFile(file_path, current, 'utf-8'); }
        catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return `Error al escribir ${file_path}: ${sanitizeErrorMessage(msg, ctx.projectRoot)}`;
        }

        const applied = results.filter(r => r.includes('OK')).length;
        return `${path.basename(file_path)} — ${applied}/${edits.length} edits applied\n${results.join('\n')}`;
    });

    // -- list_directory -----------------------------------------------------
    registerSkillHandler('list_directory', async (args) => {
        const dir_path = args.dir_path as string;
        if (!allowlist.isAllowed(dir_path)) return `Acceso denegado: ${dir_path} no esta en la lista blanca de rutas permitidas.`;
        try {
            const items = await fs.readdir(dir_path, { withFileTypes: true });
            return items.map(i => `${i.isDirectory() ? '[DIR]' : '[FILE]'} ${i.name}`).join('\n');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return `Error: ${sanitizeErrorMessage(msg, ctx.projectRoot)}`;
        }
    });

    // -- execute_command ----------------------------------------------------

    // Intercepta comandos de solo lectura de shell y los redirige a tools
    // internas sin abrir PowerShell ni pedir confirmacion al usuario.
    interface ReadInterceptResult {
        type: 'read_file' | 'list_directory' | 'ripgrep_search';
        filePath?: string;
        dirPath?: string;
        pattern?: string;
        searchPath?: string;
        fileTypes?: string;
    }

    function matchReadCommand(command: string): ReadInterceptResult | null {
        const cmd = command.trim();

        // Get-Content / gc / cat / type → read_file
        const readMatch = cmd.match(
            /^(?:Get-Content|gc|cat|type)\s+(?:-Path\s+)?["']?([^|;&`\n'"]+?)["']?\s*(?:\|.*)?$/i
        );
        if (readMatch) return { type: 'read_file', filePath: readMatch[1].trim() };

        // Get-ChildItem / gci / ls → list_directory
        // Solo intercepta cuando NO hay flags (-Recurse, -File, etc.) para no
        // confundir "ls -Recurse" o "dir /b" con rutas de directorio.
        const lsMatch = cmd.match(
            /^(?:Get-ChildItem|gci|ls)\s*(?:-Path\s+)?["']?([^|;&`\n'"]*?)["']?\s*(?:\|.*)?$/i
        );
        if (lsMatch) {
            const dirPath = lsMatch[1].trim();
            // Si el argumento empieza con "-" y no es ".", "..", es probable que sea una bandera (ej. -Recurse)
            if (dirPath.startsWith('-') && dirPath !== '-' && dirPath !== '--') {
                return null;
            }
            return { type: 'list_directory', dirPath: dirPath || '.' };
        }

        // Select-String -Pattern → ripgrep_search
        const ssMatch = cmd.match(/^Select-String\b.*?-Pattern\s+["']?([^'"\s]+)["']?/i);
        if (ssMatch) {
            const pathM = cmd.match(/-Path\s+["']?([^'"\s|;&`]+)["']?/i);
            const inclM = cmd.match(/-Include\s+["']?([^'"\s|;&`]+)["']?/i);
            return { type: 'ripgrep_search', pattern: ssMatch[1].trim(), searchPath: pathM?.[1]?.trim(), fileTypes: inclM?.[1]?.trim() };
        }

        return null;
    }

    registerSkillHandler('execute_command', async (args) => {
        const command = args.command as string;

        // Interceptar comandos de solo lectura → tools internas
        const readOp = matchReadCommand(command);
        if (readOp) {
            if (readOp.type === 'read_file' && readOp.filePath) {
                const resolved = path.isAbsolute(readOp.filePath)
                    ? readOp.filePath
                    : path.resolve(ctx.projectRoot, readOp.filePath);
                if (!allowlist.isAllowed(resolved)) return `Acceso denegado: ${resolved}`;
                try { return await fs.readFile(resolved, 'utf-8'); }
                catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    return `Error: ${sanitizeErrorMessage(msg, ctx.projectRoot)}`;
                }
            }
            if (readOp.type === 'list_directory') {
                const resolved = !readOp.dirPath || readOp.dirPath === '.'
                    ? ctx.projectRoot
                    : path.isAbsolute(readOp.dirPath) ? readOp.dirPath : path.resolve(ctx.projectRoot, readOp.dirPath);
                if (!allowlist.isAllowed(resolved)) return `Acceso denegado: ${resolved}`;
                try {
                    const items = await fs.readdir(resolved, { withFileTypes: true });
                    return items.map(i => `${i.isDirectory() ? '[DIR]' : '[FILE]'} ${i.name}`).join('\n');
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    return `Error: ${sanitizeErrorMessage(msg, ctx.projectRoot)}`;
                }
            }
            if (readOp.type === 'ripgrep_search' && readOp.pattern) {
                const searchPath = readOp.searchPath
                    ? (path.isAbsolute(readOp.searchPath) ? readOp.searchPath : path.resolve(ctx.projectRoot, readOp.searchPath))
                    : ctx.projectRoot;
                return await ripgrepSearch(readOp.pattern, searchPath, readOp.fileTypes);
            }
        }

        const isDangerous = classifier.isDangerous(command);
        const isServer = classifier.isServer(command);
        const serverNote = isServer ? '\n[server] Detectado como servidor - se iniciara en segundo plano si no termina en 8s' : '';
        const warning = isDangerous ? '\n[WARN] Comando potencialmente destructivo' : '';
        const ok = ctx.askConfirmation ? await ctx.askConfirmation(`Ejecutar en ${ctx.projectRoot}?\n  $ ${command}${serverNote}${warning}`) : false;
        if (!ok) return 'Cancelado.';

        if (isServer) {
            return new Promise<string>(resolve => {
                let captured = '';
                let finished = false;
                const spawnArgs = process.platform === 'win32'
                    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]] as const
                    : ['/bin/sh', ['-c', command]] as const;
                const proc = spawn(spawnArgs[0], spawnArgs[1], { cwd: ctx.projectRoot, detached: true });
                proc.stdout?.on('data', (d: Buffer) => { captured += d.toString(); });
                proc.stderr?.on('data', (d: Buffer) => { captured += d.toString(); });
                proc.on('close', (code: number | null) => {
                    if (!finished) { finished = true; resolve(code !== 0 ? `Error (exit ${code ?? '?'}):\n${captured}` : captured || '(sin output)'); }
                });
                proc.on('error', (e: Error) => { if (!finished) { finished = true; resolve(`Error: ${e.message}`); } });
                setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        try { proc.unref(); } catch { /* ignore */ }
                        const preview = captured.trim().slice(-600) || '(sin output todavia)';
                        resolve(`Servidor iniciado (PID: ${proc.pid})\nOutput inicial:\n${preview}`);
                    }
                }, SERVER_STARTUP_WAIT_MS);
            });
        }

        return new Promise<string>(resolve => {
            const timeoutMs = classifier.resolveTimeout(command);
            const timeoutSecs = timeoutMs / 1000;

            if (process.platform === 'win32') {
                let stdout = '';
                let stderr = '';
                let timedOut = false;
                const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: ctx.projectRoot });
                const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutMs);
                proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
                proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
                proc.on('close', (code: number | null) => {
                    clearTimeout(timer);
                    if (timedOut) resolve(`Error: timeout - el comando tardo mas de ${timeoutSecs}s`);
                    else if (code !== 0) resolve(`Error (exit ${code ?? '?'}):\n${stderr || stdout}`);
                    else resolve(stdout + (stderr ? `\nstderr: ${stderr}` : ''));
                });
                proc.on('error', (e: Error) => { clearTimeout(timer); resolve(`Error: ${e.message}`); });
            } else {
                exec(command, { cwd: ctx.projectRoot, maxBuffer: 5 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
                    if (err) resolve(err.killed ? `Error: timeout - el comando tardo mas de ${timeoutSecs}s` : `Error: ${err.message}\n${stderr}`);
                    else resolve(stdout + (stderr ? `\nstderr: ${stderr}` : ''));
                });
            }
        });
    });

    // -- ripgrep_search -----------------------------------------------------
    registerSkillHandler('ripgrep_search', async (args) => {
        const searchPath = (args.searchPath as string) || '.';
        if (!allowlist.isAllowed(searchPath)) return `Acceso denegado: ${searchPath} no esta en la lista blanca de rutas permitidas.`;
        return await ripgrepSearch(args.pattern as string, searchPath, args.file_types as string);
    });

    // -- git_diff -----------------------------------------------------------
    registerSkillHandler('git_diff', async (args) => {
        return await gitDiff(args.staged_only as boolean, args.file_path as string);
    });

    // -- vault_search -------------------------------------------------------
    registerSkillHandler('vault_search', async (args) => {
        const patterns = await searchVaultPatterns(
            args.keywords as string,
            ctx.instructions ?? defaultInstructions(),
            ctx.vaultPath,
            undefined,
            ctx.vaultProvider,
        );
        if (!patterns.length) return 'No se encontraron patrones.';
        const MAX_TOKENS = 2000;
        const MAX_CHARS = MAX_TOKENS * 4;
        let totalChars = 0;

        const blocks: string[] = [];
        for (const p of patterns) {
            const header = `[VAULT] ${path.basename(p.path)} | score: ${p.relevance} | trigger: ${p.trigger}`;
            const remaining = MAX_CHARS - totalChars - header.length - 10;
            if (remaining <= 0) break;

            const snippet = p.content.length > remaining
                ? p.content.substring(0, remaining) + '...'
                : p.content;

            blocks.push(`${header}\n${snippet}`);
            totalChars += header.length + snippet.length + 5;
        }

        const summary = `---\nEncontrados ${patterns.length} resultados. Mostrando ${blocks.length} bloques (~${Math.round(totalChars / 4)} tokens).\n---`;
        blocks.unshift(summary);

        return blocks.join('\n\n---\n\n');
    });

    // -- update_project_context ---------------------------------------------
    registerSkillHandler('update_project_context', async (args) => {
        if (!ctx.memoryContext?.projectDir) return 'Sin proyecto activo. Usa /switch para seleccionar un proyecto primero.';
        const result = await updateProjectContext(ctx.memoryContext.projectDir, args);
        if (ctx.onMemoryUpdate) await ctx.onMemoryUpdate();
        return result;
    });

    // -- update_session_memory ----------------------------------------------
    registerSkillHandler('update_session_memory', async (args) => {
        if (!ctx.memoryContext?.projectDir) return 'Sin proyecto activo. Usa /switch para seleccionar un proyecto primero.';
        const result = await updateSessionMemory(ctx.memoryContext.projectDir, args);
        if (ctx.onMemoryUpdate) await ctx.onMemoryUpdate();
        return result;
    });

    // -- extract_to_vault ---------------------------------------------------
    registerSkillHandler('extract_to_vault', async (args) => {
        if (!ctx.vaultPath) return 'No hay vault configurado. Usa /obsidian para conectarlo.';
        const vaultPath = args.path as string;
        const content = args.content as string;
        const tags = (args.tags as string[]) ?? [];

        if (!vaultPath || !content) return 'Parametros requeridos: path y content.';

        const fullPath = path.resolve(ctx.vaultPath, vaultPath);

        // Usar PathAllowlist en lugar de validacion manual
        if (!allowlist.isAllowed(fullPath)) {
            return `La ruta ${vaultPath} esta fuera del vault.`;
        }

        const today = new Date().toISOString().split('T')[0];
        const tagsYaml = tags.length > 0
            ? `tags:\n${tags.map((t: string) => `  - ${t}`).join('\n')}`
            : `tags: []`;
        const frontmatter = [
            '---',
            `title: "${args.name ?? path.basename(vaultPath, '.md')}"`,
            `description: "Patron extraido por DeepSeek Code"`,
            `date: ${today}`,
            `source: deepseek-code-extract`,
            tagsYaml,
            '---',
        ].join('\n');

        const fileContent = `${frontmatter}\n\n# ${args.name ?? path.basename(vaultPath, '.md')}\n\n${content}\n`;

        try {
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, fileContent, 'utf-8');
            return `Patron extraido a vault: ${vaultPath}`;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return `Error al escribir en vault: ${msg}`;
        }
    });
}
