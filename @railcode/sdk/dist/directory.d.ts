import type { AppUser } from "./types";
/**
 * Every member of the app's org — name, email, and whether they're an admin.
 * Build assignee pickers, @mentions, ownership rows.
 *
 * Each member's `id` is the same value as `ctx.user.id`, so you can locate the
 * caller in the list. `is_admin` is information, not an ACL: the worker is the
 * app's authorization engine, so gate what admins may do in YOUR own code.
 */
export declare const appUsers: () => Promise<AppUser[]>;
