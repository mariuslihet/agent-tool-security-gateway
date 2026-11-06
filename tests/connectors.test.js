import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, renameSync, linkSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Registry } from '../src/registry.js';
import { registerReadOnlyConnectors, loadConnectorConfig } from '../src/connectors.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-connectors-')), path = join(dir, 'catalog.sqlite'), registry = new Registry();
  t.after(() => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-connectors-')); rmSync(dir, { recursive: true, force: true }); });
  const db = new DatabaseSync(path); db.exec("CREATE TABLE products (sku TEXT PRIMARY KEY, title TEXT, stock INTEGER); INSERT INTO products VALUES ('A1','Paper',3),('B2','Pencil',8);"); db.close();
  const connector = { id: 'catalog', path: 'catalog.sqlite', description: 'Find a catalog item by SKU.', inputSchema: { type: 'object', properties: { sku: { type: 'string', maxLength: 64 } }, required: ['sku'], additionalProperties: false }, parameterNames: ['sku'], sql: 'SELECT title,stock FROM products WHERE sku=?' };
  const config = { version: 1, connectors: [connector] };
  return { dir, path, registry, connector, config, register: overrides => registerReadOnlyConnectors(registry, { config: { ...config, connectors: [{ ...connector, ...overrides }] }, baseDir: dir }) };
}

test('configured SQLite connector reads real records, binds injection data and returns safe metadata', async t => {
  const f = setup(t), metadata = f.register(), tool = f.registry.get('database.catalog');
  assert.equal(metadata[0].readOnly, true); assert.ok(!JSON.stringify(metadata).includes(f.dir)); assert.ok(!JSON.stringify(metadata).includes('SELECT'));
  assert.deepEqual(tool.definition.outputLabels, ['sensitive']); assert.equal(tool.definition.egress, false);
  assert.deepEqual(JSON.parse((await tool.handler({ sku: 'A1' })).text), [{ title: 'Paper', stock: 3 }]);
  assert.deepEqual(JSON.parse((await tool.handler({ sku: "' OR 1=1 --" })).text), []);
  await assert.rejects(tool.handler({ sku: 'A1', sql: 'DELETE FROM products' }), /UNKNOWN_ARGUMENT/);
});

test('public designation is explicit and configuration changes change tool fingerprints', async t => {
  const f = setup(t); f.register({ classification: 'public' }); assert.deepEqual(f.registry.get('database.catalog').definition.outputLabels, []);
  const second = new Registry(); registerReadOnlyConnectors(second, { config: f.config, baseDir: f.dir });
  assert.notEqual(second.get('database.catalog').fingerprint, f.registry.get('database.catalog').fingerprint);
});

test('mutating and multi-statement SQL, unsupported schemas and unbounded configurations fail at registration', t => {
  const f = setup(t);
  for (const sql of ['DELETE FROM products', 'PRAGMA query_only=OFF', 'ATTACH DATABASE ? AS x', 'SELECT 1; DELETE FROM products', 'WITH x AS (SELECT 1) SELECT * FROM x']) assert.throws(() => f.register({ sql }), /INVALID_CONNECTOR_CONFIG/);
  for (const bad of [{ maxRows: 101 }, { maxBytes: 8193 }, { timeoutMs: 3001 }, { maxRows: 0 }, { classification: 'trusted' }, { id: '../escape' }, { parameterNames: [] }, { extra: true }]) assert.throws(() => f.register(bad), /INVALID_CONNECTOR_CONFIG/);
  assert.throws(() => f.register({ inputSchema: { ...f.connector.inputSchema, properties: { sku: { type: 'object', properties: {}, required: [], additionalProperties: false } } } }), /INVALID_CONNECTOR_CONFIG/);
  const db = new DatabaseSync(f.path, { readOnly: true }); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 2); db.close();
});

test('row and byte limits withhold partial results and cancellation and deadlines terminate work', async t => {
  const f = setup(t); f.register({ sql: 'SELECT title,stock FROM products WHERE ? IS NOT NULL', maxRows: 1 }); await assert.rejects(f.registry.get('database.catalog').handler({ sku: 'all' }), /CONNECTOR_ROW_LIMIT/);
  const small = new Registry(); registerReadOnlyConnectors(small, { config: { version: 1, connectors: [{ ...f.connector, maxBytes: 2 }] }, baseDir: f.dir }); await assert.rejects(small.get('database.catalog').handler({ sku: 'A1' }), /CONNECTOR_OUTPUT_LIMIT/);
  const slow = new Registry(); registerReadOnlyConnectors(slow, { config: { version: 1, connectors: [{ ...f.connector, sql: 'SELECT (WITH RECURSIVE nums(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM nums WHERE x<1000000000) SELECT sum(x) FROM nums) AS total WHERE ? IS NOT NULL', timeoutMs: 50 }] }, baseDir: f.dir });
  await assert.rejects(slow.get('database.catalog').handler({ sku: 'A1' }), /CONNECTOR_TIMEOUT/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(f.registry.get('database.catalog').handler({ sku: 'A1' }, { signal: controller.signal }), /abort/i);
});

test('database replacement, hardlinks and a denied gateway database fail closed', async t => {
  const f = setup(t); f.register(); renameSync(f.path, join(f.dir, 'original.sqlite')); writeFileSync(f.path, 'replacement'); await assert.rejects(f.registry.get('database.catalog').handler({ sku: 'A1' }), /CONNECTOR_PATH_CHANGED/);
  rmSync(f.path); renameSync(join(f.dir, 'original.sqlite'), f.path);
  assert.throws(() => registerReadOnlyConnectors(new Registry(), { config: f.config, baseDir: f.dir, denyPaths: [f.path] }), /CONNECTOR_DATABASE_DENIED/);
  linkSync(f.path, join(f.dir, 'alias.sqlite')); assert.throws(() => registerReadOnlyConnectors(new Registry(), { config: f.config, baseDir: f.dir }), /CONNECTOR_PATH_REJECTED/);
});

test('configuration loading is bounded, strict JSON and never permits a database path in model arguments', t => {
  const f = setup(t), configPath = join(f.dir, 'connectors.json'); writeFileSync(configPath, JSON.stringify(f.config)); assert.deepEqual(loadConnectorConfig(configPath), f.config);
  writeFileSync(configPath, '{ invalid'); assert.throws(() => loadConnectorConfig(configPath), /CONNECTOR_CONFIG_REJECTED/);
  writeFileSync(configPath, 'x'.repeat(65537)); assert.throws(() => loadConnectorConfig(configPath), /CONNECTOR_CONFIG_REJECTED/);
  assert.throws(() => registerReadOnlyConnectors(new Registry(), { config: { version: 1, connectors: Array(9).fill(f.connector) }, baseDir: f.dir }), /INVALID_CONNECTOR_CONFIG/);
});
