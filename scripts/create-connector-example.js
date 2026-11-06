#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Creates explicitly labeled fixture data only; never reads .env or gateway storage.
try {
  if (process.argv.length !== 3 || !process.argv[2].trim()) throw new Error('USAGE');
  const directory = resolve(process.argv[2]);
  mkdirSync(directory, { recursive: false, mode: 0o700 }); // Exclusive: existing directories fail.
  const database = new DatabaseSync(join(directory, 'inventory.sqlite'));
  try {
    database.exec('CREATE TABLE products (sku TEXT PRIMARY KEY, name TEXT NOT NULL, stock INTEGER NOT NULL)');
    const insert = database.prepare('INSERT INTO products (sku,name,stock) VALUES (?,?,?)');
    for (const row of [['A1', 'Paper', 24], ['B2', 'Pencil', 80], ['C3', 'Marker', 0]]) insert.run(...row);
  } finally { database.close(); }
  const config = {
    version: 1,
    connectors: [{
      id: 'inventory', path: 'inventory.sqlite', description: 'Read a SKU from the explicitly labeled example inventory fixture.',
      inputSchema: { type: 'object', properties: { sku: { type: 'string', maxLength: 64 } }, required: ['sku'], additionalProperties: false },
      parameterNames: ['sku'], sql: 'SELECT name, stock FROM products WHERE sku = ?', classification: 'public', maxRows: 10, maxBytes: 4096, timeoutMs: 3000,
    }],
  };
  writeFileSync(join(directory, 'connector.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'README.txt'), 'EXAMPLE FIXTURE DATA — not a production inventory.\nA1: Paper, stock 24\nB2: Pencil, stock 80\nC3: Marker, stock 0\nThe connector performs actual read-only SQLite queries over these sample records.\n', { flag: 'wx', mode: 0o600 });
  console.log('Created a real SQLite database containing EXAMPLE FIXTURE DATA in a new directory.');
  console.log(`Configuration: ${join(directory, 'connector.json')}`);
  console.log('Set GATEWAY_CONNECTORS_FILE to that configuration path and restart the gateway.');
  console.log('Use read-only tool access and ask database.inventory for SKU A1 (Paper, stock 24).');
} catch (error) {
  console.error(error.message === 'USAGE' ? 'Usage: node scripts/create-connector-example.js <new-directory>' : error.code === 'EEXIST' ? 'Example directory already exists; choose a new directory. Nothing was overwritten.' : 'Example creation failed. Check the parent directory and inspect any newly created files before retrying.');
  process.exitCode = 1;
}
