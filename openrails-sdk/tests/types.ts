import { configure, db, files, data, llm, connector, type LlmTool, type SqlRows, type OpenRailsUser } from '../src/index.js';

configure({ url: 'http://localhost:8787', token: 'server-token' });
const tasks = db.collection<{ title: string; done: boolean }>('tasks');
async function check(): Promise<void> {
  const task = await tasks.put('first', { title: 'typed', done: false });
  const title: string = task.title;
  // @ts-expect-error Typed collections must not accept invalid values.
  tasks.put('wrong', { title: 42, done: false });
  // @ts-expect-error Collection values preserve their field types.
  const wrong: number = task.title;
  const first = await tasks.where('done', 'eq', false).first();
  const done: boolean | undefined = first?.value.done;
  const rows: SqlRows = await data.runSQL('SELECT key FROM kv');
  const columns: string[] = rows.columns;
  const bytes = new Uint8Array([1, 2, 3]);
  await files.put('typed.bin', bytes);
  await files.put('stream.bin', new ReadableStream<Uint8Array>());
  const double: LlmTool<{ n: number }> = { name: 'double', description: 'Double', run: ({ n }) => n * 2 };
  const result = await llm.generate('double', { tools: [double] });
  const text: string = result.text;
  const answer = await connector('example').call<{ id: string }>('reserved');
  const id: string = answer.id;
  const user: OpenRailsUser | null = null;
  void [title, wrong, done, columns, text, id, user];
}
void check;
// @ts-expect-error OpenRails owns SQLite and has no cloud SQL provider exports.
import { bigquery, turso, postgres } from '../src/index.js';
void [bigquery, turso, postgres];
