import { Instructions } from '../../types/config';
import { CommandClassifierConfig } from '../../types/config';
import { PathAllowlist } from './path-allowlist';
import { VaultProvider } from '../../vault/vault-provider';

export interface BuiltinHandlerContext {
    projectRoot: string;
    vaultPath: string;
    instructions: Instructions;
    askConfirmation: ((msg: string) => Promise<boolean>) | null;
    memoryContext: { projectDir?: string } | null;
    onMemoryUpdate: (() => Promise<void>) | null;
    /** Patrones adicionales para el CommandClassifier — opcional */
    classifierOptions?: CommandClassifierConfig;
    /** Lista blanca de rutas permitidas para operaciones de archivos */
    pathAllowlist: PathAllowlist;
    /** Provider de vault inyectado (Fase 2). Si no se provee, se usa FileSystemVaultProvider */
    vaultProvider?: VaultProvider;
}
