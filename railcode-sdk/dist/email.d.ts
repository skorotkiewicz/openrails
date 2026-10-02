import type { EmailSendOptions, EmailSendResult } from "./types";
declare function send(opts: EmailSendOptions): Promise<EmailSendResult>;
export declare const email: {
    send: typeof send;
};
export {};
