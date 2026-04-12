import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/mcp-server.ts',  // MCP server for ask_human tool
  ],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Don't bundle dependencies - they should be installed via npm
  external: [
    'axios',
    '@octokit/rest',
    'chalk',
    'commander',
    'inquirer',
    'js-yaml',
    'ora',
    'pino',
    'pino-pretty',
    'zod',
    '@modelcontextprotocol/sdk',
  ],
});
