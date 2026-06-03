import { CommandClassifierConfig } from '../../types/config';

// ── Patrones base (privados) ───────────────────────────────────────────────

const DANGEROUS_BASE = /(\brm\s+-rf|\brm\s+-rf\s+\/|:\(\)\s*\{[^}]*\}|\bdd\s+if=\/dev\/zero\s+of=\/dev|chmod\s+-R\s+777\s+\/|>\s*\/dev\/(null|zero|sda|sdb|sdc)|>\s*\/etc\/(passwd|shadow|sudoers)|\bwget\s+\S+.*\|\s*(bash|sh)|\bcurl\s+\S+.*\|\s*(bash|sh)|DROP\s+TABLE|truncate\b|mkfs\b|format\b|del\s+\/[sqf])/i;
const SENSITIVE_PATH_BASE = /(\bpassword|\bcredential|\bsecret|\bprivate[._-]?key|\bid_rsa|\.env\b|\.ssh[\\/]|\.pem\b|\.pfx\b|\.keystore\b|credentials\.json|service-account\.json|kubeconfig\b|kube-config|terraform\.tfvars|\.tfvars\b|\.htpasswd\b|\.netrc\b|_netrc\b|dockerconfigjson|docker-config|id_ecdsa|id_ed25519)/i;
const SERVER_BASE = /\b(npm\s+run\s+(dev|serve|preview|watch)|npm\s+start|yarn\s+(dev|serve|preview|run\s+(dev|serve|preview|watch))|pnpm\s+(dev|serve|preview|run\s+(dev|serve|preview|watch))|nodemon\b|ts-node-dev\b|next\s+dev\b|vite\b|uvicorn\b|flask\s+run\b|python\s+-m\s+flask\b|python\s+manage\.py\s+runserver\b|rails\s+s(erver)?\b|php\s+artisan\s+serve\b|dotnet\s+run\b|air\b)\b/i;
const LONG_RUNNING_BASE = /\b(npm\s+(install|i|ci|run\b)|yarn\s+(install|add|remove|build)|pnpm\s+(install|add|build)|pip3?\s+install|cargo\s+(build|test|run|fetch)|tsc\b|next\s+build|vite\s+build|webpack\b|docker\s+build|gradle\b|mvnw?\b|go\s+(build|mod\s+download|generate)|composer\s+install|bundle\s+install)\b/i;

export const DEFAULT_TIMEOUT_MS      = 120_000;
export const LONG_RUNNING_TIMEOUT_MS = 600_000;
export const SERVER_STARTUP_WAIT_MS  = 8_000;

// ── CommandClassifier ──────────────────────────────────────────────────────

export class CommandClassifier {
    private dangerous: RegExp;
    private sensitivePath: RegExp;
    private server: RegExp;
    private longRunning: RegExp;

    constructor(opts?: CommandClassifierConfig) {
        this.dangerous    = mergePatterns(DANGEROUS_BASE,      opts?.additionalDangerous);
        this.sensitivePath = SENSITIVE_PATH_BASE;
        this.server       = mergePatterns(SERVER_BASE,         opts?.additionalServer);
        this.longRunning  = mergePatterns(LONG_RUNNING_BASE,   opts?.additionalLongRunning);
    }

    isDangerous(command: string): boolean    { return this.dangerous.test(command); }
    isServer(command: string): boolean       { return this.server.test(command); }
    isLongRunning(command: string): boolean  { return this.longRunning.test(command); }
    isSensitivePath(filePath: string): boolean { return this.sensitivePath.test(filePath); }

    resolveTimeout(command: string, override?: number): number {
        if (override !== undefined) return override;
        return this.isLongRunning(command) ? LONG_RUNNING_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    }
}

function mergePatterns(base: RegExp, extras?: string[]): RegExp {
    if (!extras?.length) return base;
    const combined = [base.source, ...extras].join('|');
    return new RegExp(combined, 'i');
}
