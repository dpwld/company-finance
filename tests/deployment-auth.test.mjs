import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticateDeploymentRequest } from '../lib/server/deployment-auth.mjs';

const issuer = 'https://workspace-test.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const env = { DEPLOYMENT_AUTH: 'cloudflare-access', CF_ACCESS_TEAM_DOMAIN: issuer, CF_ACCESS_AUD: audience };
const originalFetch = globalThis.fetch;
let signingKey, otherKey, publicKeys;
before(async () => {
 const first = await generateKeyPair('RS256');
 const second = await generateKeyPair('RS256');
 signingKey = first.privateKey;
 otherKey = second.privateKey;
 publicKeys = [
  {...await exportJWK(first.publicKey), kid: 'first', alg: 'RS256', use: 'sig'},
  {...await exportJWK(second.publicKey), kid: 'rotated', alg: 'RS256', use: 'sig'},
 ];
 globalThis.fetch = async input => {
  const url = String(input);
  assert.match(url, /^https:\/\/[\w-]+\.cloudflareaccess\.com\/cdn-cgi\/access\/certs$/);
  if (url.includes('unavailable.')) throw new Error('Offline test JWKS failure');
  return Response.json({keys: publicKeys});
 };
});
after(() => { globalThis.fetch = originalFetch; });

async function token(overrides = {}, key = signingKey, kid = 'first') {
 const now = Math.floor(Date.now() / 1000);
 return new SignJWT({iss: issuer, aud: [audience], sub: 'test-user', email: 'user@example.test', name: 'Test User', iat: now, exp: now + 300, ...overrides})
  .setProtectedHeader({alg: 'RS256', kid}).sign(key);
}
function request(jwt, path = '/', headers = {}) {
 return new Request(`https://workspace.example${path}`, {headers: {
  ...(jwt ? {'cf-access-jwt-assertion': jwt} : {}),
  'oai-authenticated-user-id': 'spoofed-owner',
  'oai-authenticated-user-email': 'spoofed@example.test',
  'oai-authenticated-user-full-name': 'Spoofed',
  'oai-authenticated-admin': 'true',
  ...headers,
 }});
}
async function rejected(jwt, configuration = env, status = 401) {
 const result = await authenticateDeploymentRequest(request(jwt), configuration);
 assert.ok(result instanceof Response);
 assert.equal(result.status, status);
 assert.equal(result.headers.get('cache-control'), 'no-store');
 assert.ok(!(await result.text()).includes(jwt || 'spoofed-owner'));
}

test('default Sites mode preserves its existing trusted request boundary', async () => {
 const original = request(null);
 assert.equal(await authenticateDeploymentRequest(original, {}), original);
 assert.equal(await authenticateDeploymentRequest(original, {DEPLOYMENT_AUTH: 'sites'}), original);
});
test('Access mode rejects missing tokens even with spoofed identity headers', async () => {
 await rejected(null);
});
test('verified JWT supplies identity and strips every incoming internal identity header', async () => {
 const result = await authenticateDeploymentRequest(request(await token()), env);
 assert.ok(result instanceof Request);
 assert.match(result.headers.get('oai-authenticated-user-id'), /^cf-access:[a-f0-9]{64}$/);
 assert.equal(result.headers.get('oai-authenticated-user-email'), 'user@example.test');
 assert.equal(decodeURIComponent(result.headers.get('oai-authenticated-user-full-name')), 'Test User');
 assert.equal(result.headers.get('oai-authenticated-user-full-name-encoding'), 'percent-encoded-utf-8');
 assert.equal(result.headers.get('oai-authenticated-admin'), null);
 assert.equal(result.headers.get('cf-access-jwt-assertion'), null);
 const repeat = await authenticateDeploymentRequest(request(await token()), env);
 assert.equal(repeat.headers.get('oai-authenticated-user-id'), result.headers.get('oai-authenticated-user-id'));
 const other = await authenticateDeploymentRequest(request(await token({sub: 'other-user'})), env);
 assert.notEqual(other.headers.get('oai-authenticated-user-id'), result.headers.get('oai-authenticated-user-id'));
});
test('tampered, expired, future, wrong-issuer and wrong-audience tokens fail closed', async () => {
 const now = Math.floor(Date.now() / 1000);
 for (const claims of [{exp: now - 60}, {nbf: now + 600}, {iat: now + 600}, {iss: 'https://other.cloudflareaccess.com'}, {aud: ['another-app']}, {exp: undefined}, {iat: undefined}, {sub: undefined}, {email: undefined}, {email: ''}]) {
  await rejected(await token(claims));
 }
 await rejected(await token({}, otherKey, 'first'));
 await rejected('not.a.valid-jwt');
 const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`;
 await rejected(unsigned);
});
test('JWKS key identifiers support rotated keys and reject unknown keys', async () => {
 assert.ok(await authenticateDeploymentRequest(request(await token({}, otherKey, 'rotated')), env) instanceof Request);
 await rejected(await token({}, signingKey, 'unknown'));
});
test('missing or invalid mode, issuer and audience configuration never falls back to Sites', async () => {
 for (const configuration of [
  {DEPLOYMENT_AUTH: 'disabled'}, {...env, CF_ACCESS_AUD: ''}, {...env, CF_ACCESS_AUD: [audience]},
  {...env, CF_ACCESS_TEAM_DOMAIN: 'http://workspace-test.cloudflareaccess.com'},
  {...env, CF_ACCESS_TEAM_DOMAIN: `${issuer}.attacker.test`},
  {...env, CF_ACCESS_TEAM_DOMAIN: `${issuer}/path`},
  {...env, CF_ACCESS_TEAM_DOMAIN: ''},
 ]) await rejected(null, configuration, 503);
});
test('JWKS network failure rejects authentication without exposing the token', async () => {
 const unavailable = 'https://unavailable.cloudflareaccess.com';
 await rejected(await token({iss: unavailable}), {...env, CF_ACCESS_TEAM_DOMAIN: unavailable});
});
test('Access sessions use Access logout and safe local sign-in redirects', async () => {
 const jwt = await token();
 for (const path of ['/signin-with-chatgpt?return_to=%2F%3Fview%3Dboard', '/callback?return_to=%2F%3Fview%3Dboard']) {
  const result = await authenticateDeploymentRequest(request(jwt, path), env);
  assert.equal(result.status, 302);
  assert.equal(result.headers.get('location'), 'https://workspace.example/?view=board');
 }
 for (const target of ['https://evil.example/', '//evil.example/', '/signin-with-chatgpt', '/\\evil.example/']) {
  const result = await authenticateDeploymentRequest(request(jwt, `/signin-with-chatgpt?return_to=${encodeURIComponent(target)}`), env);
  assert.equal(result.headers.get('location'), 'https://workspace.example/');
 }
 const logout = await authenticateDeploymentRequest(request(jwt, '/signout-with-chatgpt'), env);
 assert.equal(logout.status, 302);
 assert.equal(logout.headers.get('location'), 'https://workspace.example/cdn-cgi/access/logout');
});
