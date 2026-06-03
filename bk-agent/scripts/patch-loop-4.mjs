import { readFileSync, writeFileSync } from 'fs';

const path = 'C:\\Users\\mairon.cuello\\development\\workspace-ia\\deepseek-code\\src\\agent\\loop.ts';
let content = readFileSync(path, 'utf-8');

let changed = 0;

// 4. Find the specific "try {" that comes after "let askAgentStreamed = false;"
const askPos = content.indexOf('let askAgentStreamed = false;');
if (askPos < 0) {
    console.log('FAIL 4: askAgentStreamed not found');
    process.exit(1);
}

// Search for the NEXT "try {" after askPos
const afterAsk = content.substring(askPos);
const nextTryPos = afterAsk.indexOf('try {');
if (nextTryPos < 0) {
    console.log('FAIL 4: try not found after askAgentStreamed');
    process.exit(1);
}

const absoluteTryPos = askPos + nextTryPos;
const beforeTry = content.substring(0, absoluteTryPos);
const afterTry = content.substring(absoluteTryPos);

const newCode = `try {
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
                        }

                        if (toolCall.function.name === 'ask_agent') {`;

// The afterTry content starts with "try {\n                        if (toolCall.function.name === 'ask_agent') {"
// We need to replace from "try {" to the end of that specific line
const oldTryBlock = afterTry.substring(0, afterTry.indexOf("if (toolCall.function.name === 'ask_agent') {") + "if (toolCall.function.name === 'ask_agent') {".length);
const restAfterOld = afterTry.substring(oldTryBlock.length);

content = beforeTry + newCode + restAfterOld;
console.log('OK 4: Tool interception added');
changed++;

writeFileSync(path, content, 'utf-8');
console.log('DONE: ' + changed + ' change(s) applied');
