#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStore } from './data-store.mjs';
import { createServer } from './server.mjs';

try {
  const store = createStore();
  const server = createServer(store);
  await server.connect(new StdioServerTransport());
  console.error(
    `korean-special-education-learning-map-mcp ${store.manifest.taxonomyVersion}: stdio 서버 시작됨 (성취기준 ${store.manifest.counts.standards}건${store.manifest.counts.previousEdition ? ` + 이전 판 ${store.manifest.counts.previousEdition}건` : ''})`
  );
} catch (error) {
  console.error(`서버 시작 실패: ${error.message}`);
  process.exit(1);
}
