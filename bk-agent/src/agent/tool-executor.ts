import { ToolCall } from '../api/types';
import { AIAssistantConfig, Instructions } from '../types/config';
import { MemoryContextInput } from './system-prompt';
import { ToolResult } from '../tools/types';
import { executeSkillHandler, sanitizeHandlerName } from '../skills/registry';

export interface ToolExecutorOptions {
    config: AIAssistantConfig;
    instructions: Instructions;
    vaultPath: string;
    askConfirmation: (message: string) => Promise<boolean>;
    commandTimeoutMs?: number;
    memoryContext?: MemoryContextInput | null;
    onMemoryUpdate?: () => Promise<void>;
}

/**
 * @description Ejecuta una tool_call del modelo, parseando los argumentos JSON
 * y delegando al handler registrado. Si el JSON es inválido, devuelve un error
 * descriptivo con la causa probable y una sugerencia de acción correctiva.
 * El sistema se recupera de errores de parseo sin interrumpir el flujo.
 */
export async function executeToolCall(
    toolCall: ToolCall,
    options: ToolExecutorOptions
): Promise<ToolResult<string>> {
    const { name, arguments: args } = toolCall.function;
    let parsedArgs: any;
    try {
        parsedArgs = JSON.parse(args);
    } catch {
        return ToolResult.fail(
            `Error: argumentos inválidos (JSON malformado). Causa probable: el campo "content" contiene caracteres sin escapar (comillas, backslashes, saltos de línea). Usá edit_file en lugar de write_file para modificar archivos existentes. Fragmento recibido: ${args.slice(0, 120)}`
        );
    }

    return await executeSkillHandler(sanitizeHandlerName(name), parsedArgs);
}
