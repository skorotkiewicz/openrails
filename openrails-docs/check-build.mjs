import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./doc_build/', import.meta.url));
const base = process.env.DOCS_BASE || '/';
const pages = (await readdir(output, { recursive: true })).filter(name => name.endsWith('.html'));
assert(pages.includes('index.html'), 'Missing built homepage');
for (const page of pages) {
  const html = await readFile(join(output, page), 'utf8');
  for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = new URL(href, `https://docs.invalid${base}${page}`);
    if (url.origin !== 'https://docs.invalid') continue;
    assert(url.pathname.startsWith(base), `${page}: URL outside site base: ${href}`);
    const path = decodeURIComponent(url.pathname.slice(base.length));
    await access(join(output, path.endsWith('/') || !path ? `${path}index.html` : path));
  }
}
const configPage = await readFile(join(output, 'server/configuration.html'), 'utf8');
for (const name of ['server.json', 'projects.json', 'client.json', 'server.env.example']) {
  assert(configPage.includes(`href="../examples/${name}"`), `Missing config download: ${name}`);
  const content = await readFile(join(output, 'examples', name), 'utf8');
  if (name.endsWith('.json')) JSON.parse(content);
}
console.log('Built pages, local links, assets and config downloads verified.');
