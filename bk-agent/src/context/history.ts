import { Message } from '../api/types';
export class ConversationHistory {
    messages: Message[] = [];
    add(m: Message) { this.messages.push(m); }
    getAll() { return [...this.messages]; }
    clear() { this.messages = []; }
}