import * as path from 'node:path';
import { defineConfig } from '@rspress/core';

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  base: process.env.DOCS_BASE || '/',
  lang: 'en',
  title: 'OpenRails',
  description: 'Self-hosted API server and TypeScript SDK.',
  themeConfig: {
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/skorotkiewicz/openrails',
      },
    ],
  },
});
