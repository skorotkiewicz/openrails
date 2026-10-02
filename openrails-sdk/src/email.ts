import { call } from './http.js';
import type { EmailSendOptions, EmailSendResult } from './types.js';
export const email = {
  send(options: EmailSendOptions): Promise<EmailSendResult> { return call('POST', '/email/send', { body: options }); },
};
