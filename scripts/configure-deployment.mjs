import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessConfiguration } from '../lib/server/deployment-auth.mjs';

export function createDeploymentConfig(settings, built) {
 assert.equal(settings.authMode, 'cloudflare-access', 'Standalone deployment requires authMode: cloudflare-access.');
 const {issuer, audience} = accessConfiguration({CF_ACCESS_TEAM_DOMAIN: settings.teamDomain, CF_ACCESS_AUD: settings.audience});
 assert.match(settings.name || '', /^[a-z0-9][a-z0-9-]{0,62}$/, 'Provide your Worker name.');
 assert.match(settings.accountId || '', /^[a-f0-9]{32}$/i, 'Provide your Cloudflare account ID.');
 assert.match(settings.databaseId || '', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, 'Provide your D1 database ID.');
 assert.notEqual(settings.databaseId, '00000000-0000-4000-8000-000000000000', 'Replace the local placeholder database.');
 assert.match(settings.databaseName || '', /^[a-z0-9][a-z0-9_-]{0,62}$/i, 'Provide your D1 database name.');
 assert.notEqual(settings.databaseName, 'site-creator-d1', 'Use your own database name.');
 assert.match(settings.bucketName || '', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'Provide your R2 bucket name.');
 assert.notEqual(settings.bucketName, 'site-creator-r2', 'Use your own bucket name.');
 assert.match(settings.hostname || '', /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Provide a custom hostname, without a URL scheme or path.');
 assert.ok(!settings.hostname.endsWith('.workers.dev'), 'Use a custom domain protected by your Access application.');
 assert.equal(typeof built.main, 'string', 'Run npm run build first.');
 assert.equal(typeof built.assets?.directory, 'string', 'The build must include static assets.');
 const relative = value => path.relative('.deploy', path.resolve('dist/server', value)).split(path.sep).join('/');
 return {
  name: settings.name, account_id: settings.accountId,
  main: relative(built.main), compatibility_date: built.compatibility_date,
  compatibility_flags: built.compatibility_flags, no_bundle: built.no_bundle, rules: built.rules,
  assets: {...built.assets, directory: relative(built.assets.directory), binding: 'ASSETS', run_worker_first: true, not_found_handling: 'none'},
  d1_databases: [{binding: 'DB', database_name: settings.databaseName, database_id: settings.databaseId, migrations_dir: '../drizzle'}],
  r2_buckets: [{binding: 'BUCKET', bucket_name: settings.bucketName}],
  vars: {DEPLOYMENT_AUTH: 'cloudflare-access', CF_ACCESS_TEAM_DOMAIN: issuer, CF_ACCESS_AUD: audience},
  routes: [{pattern: settings.hostname, custom_domain: true}],
  workers_dev: false, preview_urls: false, observability: {enabled: true},
 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/configure-deployment.mjs <settings.json>');
  const settings = JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'));
  const built = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
  await access(path.resolve('dist/server', built.main));
  await access(path.resolve('dist/server', built.assets.directory));
  const config = createDeploymentConfig(settings, built);
  await mkdir('.deploy', {recursive: true});
  await writeFile('.deploy/wrangler.json', JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
  console.log('Prepared .deploy/wrangler.json for your Cloudflare account. No resources were created or deployed.');
 } catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not prepare deployment configuration.');
  process.exitCode = 1;
 }
}
