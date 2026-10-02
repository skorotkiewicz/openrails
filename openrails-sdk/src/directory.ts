import { call } from './http.js';
import type { AppUser } from './types.js';
export async function appUsers(): Promise<AppUser[]> {
  return (await call<Array<Omit<AppUser, 'id'> & { uuid: string }>>('GET', '/app-users')).map(({ uuid, ...user }) => ({ id: uuid, ...user }));
}
