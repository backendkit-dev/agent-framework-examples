import { readFileSync, writeFileSync } from 'fs';

const path = 'C:\\Users\\mairon.cuello\\development\\workspace-ia\\deepseek-code\\src\\agent\\loop.ts';
let content = readFileSync(path, 'utf-8');

let changed = 0;

// 4. Tool call interception: add before "try {"
const oldToolBlock = `                    let result = '';
                    let askAgentStreamed = false;
                    try {`;

const newToolBlock = `                    let result = '';
                    let askAgentStreamed = false;
                    try {
                        // ⛔ DelegationEnforcer: block write tools when General is active
                        if (this.effectiveAgentId === 'general' && toolCall.function.name !== 'ask_agent') {
                            const interceptResult = this.delegationEnforcer.interceptToolCall(toolCall, this.effectiveAgentId);
                            if (interceptResult) {
                                result = interceptResult.message;
                                this.options.onToolResult?.(toolCall.function.name, result);
                                this.options.onToolDone?.();
                                this.messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
                                continue;
                            }
                        }`;

if (content.includes(oldToolBlock)) {
    content = content.replace(oldToolBlock, newToolBlock);
    console.log('OK 4: Tool interception added');
    changed++;
} else {
    console.log('FAIL 4: oldToolBlock not found');
    const idx = content.indexOf('let askAgentStreamed = false;');
    if (idx >= 0) {
        console.log('  Context:', JSON.stringify(content.substring(idx, idx + 80)));
    }
}

// 5. Post-response audit: add after evalResult and before shouldCorrect
const oldAudit = `                if (!this.abortRequested && evalResult.shouldCorrect) {`;

const newAudit = `                // ⛔ DelegationEnforcer: audit General's response for delegation violations
                if (!this.abortRequested && this.effectiveAgentId === 'general') {
                    const violations = this.delegationEnforcer.auditResponse(clean);
                    if (violations.length > 0) {
                        const lines = violations.map(v => '  - Dominio: ' + v.domain + ' (' + v.filePath + ') -> debe usar ask_agent para ' + v.specialistAgentId);
                        const auditMsg = '[Delegation Audit] El agente General implemento codigo que debio delegar.\\nViolaciones:\\n' + lines.join('\\n') + '\\n\\nUsa ask_agent para delegar al especialista correspondiente.';
                        this.messages.push({ role: 'system', content: auditMsg });
                        this.router.recordFailure(this.effectiveAgentId);
                    }
                }

                if (!this.abortRequested && evalResult.shouldCorrect) {`;

if (content.includes(oldAudit)) {
    content = content.replace(oldAudit, newAudit);
    console.log('OK 5: Post-response audit added');
    changed++;
} else {
    console.log('FAIL 5: oldAudit not found');
}

if (changed > 0) {
    writeFileSync(path, content, 'utf-8');
    console.log('DONE: ' + changed + ' change(s) applied');
} else {
    console.log('No changes applied');
}
