import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDeploymentConfig } from '../scripts/configure-deployment.mjs';

const settings = {
 authMode: 'cloudflare-access', name: 'my-workspace', accountId: '1'.repeat(32),
 databaseId: '11111111-2222-4333-8444-555555555555', databaseName: 'my-workspace-db',
 bucketName: 'my-workspace-files', hostname: 'workspace.example.com',
 teamDomain: 'https://workspace-test.cloudflareaccess.com', audience: 'a'.repeat(64),
};
const built = {
 name: 'original-site', main: 'index.js', compatibility_date: '2026-05-15', compatibility_flags: ['nodejs_compat'],
 no_bundle: true, rules: [{type: 'ESModule', globs: ['**/*.js']}],
 assets: {directory: '../client'}, vars: {ORIGINAL: 'must-not-copy'},
 d1_databases: [{binding: 'DB', database_id: '00000000-0000-4000-8000-000000000000'}],
 r2_buckets: [{binding: 'BUCKET', bucket_name: 'site-creator-r2'}],
 services: [{binding: 'CONNECTORS', service: 'local-preview'}],
};

test('standalone config uses only explicit operator resources and authenticated asset routing', () => {
 const config = createDeploymentConfig(settings, built);
 assert.equal(config.name, settings.name);
 assert.equal(config.account_id, settings.accountId);
 assert.equal(config.main, '../dist/server/index.js');
 assert.equal(config.assets.directory, '../dist/client');
 assert.equal(config.assets.run_worker_first, true);
 assert.equal(config.assets.binding, 'ASSETS');
 assert.equal(config.assets.not_found_handling, 'none');
 assert.deepEqual(config.vars, {DEPLOYMENT_AUTH: 'cloudflare-access', CF_ACCESS_TEAM_DOMAIN: settings.teamDomain, CF_ACCESS_AUD: settings.audience});
 assert.deepEqual(config.d1_databases, [{binding: 'DB', database_name: settings.databaseName, database_id: settings.databaseId, migrations_dir: '../drizzle'}]);
 assert.deepEqual(config.r2_buckets, [{binding: 'BUCKET', bucket_name: settings.bucketName}]);
 assert.deepEqual(config.routes, [{pattern: settings.hostname, custom_domain: true}]);
 assert.equal(config.workers_dev, false);
 assert.equal(config.preview_urls, false);
 assert.equal(config.services, undefined);
 assert.equal(built.name, 'original-site');
});
test('config generation requires Access and rejects placeholders or malformed resources', () => {
 for (const invalid of [
  {authMode: undefined}, {authMode: 'sites'}, {authMode: 'none'}, {accountId: ''},
  {databaseId: '00000000-0000-4000-8000-000000000000'},
  {databaseName: 'site-creator-d1'}, {bucketName: 'site-creator-r2'},
  {hostname: 'https://workspace.example.com'}, {hostname: 'workspace.workers.dev'},
  {teamDomain: 'http://workspace-test.cloudflareaccess.com'}, {audience: ''},
 ]) assert.throws(() => createDeploymentConfig({...settings, ...invalid}, built));
});
test('CLI writes only ignored deployment output and preserves the existing Sites identity', async () => {
 const root = await mkdtemp(path.join(tmpdir(), 'deployment-config-'));
 try {
  await mkdir(path.join(root, 'dist/server'), {recursive: true});
  await mkdir(path.join(root, 'dist/client'), {recursive: true});
  await mkdir(path.join(root, '.openai'));
  await writeFile(path.join(root, 'dist/server/wrangler.json'), JSON.stringify(built));
  await writeFile(path.join(root, 'dist/server/index.js'), 'export default {};');
  await writeFile(path.join(root, '.openai/hosting.json'), '{"project_id":"unchanged-site"}');
  await writeFile(path.join(root, 'settings.json'), JSON.stringify(settings));
  const cli = fileURLToPath(new URL('../scripts/configure-deployment.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'settings.json'], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(await readFile(path.join(root, '.deploy/wrangler.json'), 'utf8'));
  assert.equal(output.vars.DEPLOYMENT_AUTH, 'cloudflare-access');
  assert.equal(await readFile(path.join(root, '.openai/hosting.json'), 'utf8'), '{"project_id":"unchanged-site"}');
 } finally { await rm(root, {recursive: true, force: true}); }
});
