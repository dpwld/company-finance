import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * @typedef {{ DEPLOYMENT_AUTH?: string, CF_ACCESS_TEAM_DOMAIN?: string, CF_ACCESS_AUD?: string }} DeploymentAuthEnv
 */

const jwksByIssuer = new Map();
const reservedPaths = new Set(['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback']);

/** Validate operator configuration, never a JWT-provided issuer or key URL.
 * @param {DeploymentAuthEnv} env
 */
export function accessConfiguration(env) {
 if (typeof env.CF_ACCESS_TEAM_DOMAIN !== 'string') throw new Error('Provide your Cloudflare Access team origin.');
 const domain = new URL(env.CF_ACCESS_TEAM_DOMAIN || '');
 if (domain.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(domain.hostname)
  || domain.port || domain.username || domain.password || domain.pathname !== '/' || domain.search || domain.hash) {
  throw new Error('CF_ACCESS_TEAM_DOMAIN must be your HTTPS Cloudflare Access team origin.');
 }
 if (typeof env.CF_ACCESS_AUD !== 'string' || !/^[a-f0-9]{64}$/i.test(env.CF_ACCESS_AUD)) throw new Error('CF_ACCESS_AUD must be your application audience tag.');
 return {issuer: domain.origin, audience: env.CF_ACCESS_AUD};
}

/** @param {string} message @param {number} status */
function deny(message, status) {
 return Response.json({error: message}, {status, headers: {'Cache-Control': 'no-store'}});
}
/** @param {URL} url */
function safeReturnTo(url) {
 const value = url.searchParams.get('return_to') || '/';
 if (!value.startsWith('/') || value.startsWith('//')) return new URL('/', url);
 const target = new URL(value, url);
 return target.origin === url.origin && !reservedPaths.has(target.pathname) ? target : new URL('/', url);
}

/** Sites supplies trusted identity upstream. Standalone installations must opt
 * into Access and authenticate before the existing application sees a request.
 * @param {Request} request
 * @param {DeploymentAuthEnv} env
 * @returns {Promise<Request | Response>}
 */
export async function authenticateDeploymentRequest(request, env) {
 if (env.DEPLOYMENT_AUTH === undefined || env.DEPLOYMENT_AUTH === 'sites') return request;
 if (env.DEPLOYMENT_AUTH !== 'cloudflare-access') return deny('Invalid deployment authentication mode.', 503);
 let config;
 try { config = accessConfiguration(env); }
 catch { return deny('Cloudflare Access authentication is not configured correctly.', 503); }

 const headers = new Headers(request.headers);
 for (const name of [...headers.keys()]) if (name.startsWith('oai-authenticated-')) headers.delete(name);
 const token = headers.get('cf-access-jwt-assertion');
 headers.delete('cf-access-jwt-assertion');
 if (!token) return deny('Sign in through the configured Cloudflare Access application.', 401);

 try {
  let jwks = jwksByIssuer.get(config.issuer);
  if (!jwks) {
   jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', config.issuer), {timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000});
   jwksByIssuer.set(config.issuer, jwks);
  }
  const {payload} = await jwtVerify(token, jwks, {
   issuer: config.issuer, audience: config.audience, algorithms: ['RS256'],
   requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'email'],
  });
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string'
   || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || payload.email.length > 254
   || typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1000) + 30) {
   return deny('A valid Cloudflare Access user identity is required.', 401);
  }

  const url = new URL(request.url);
  if (reservedPaths.has(url.pathname)) {
   const target = url.pathname === '/signout-with-chatgpt' ? new URL('/cdn-cgi/access/logout', url) : safeReturnTo(url);
   return new Response(null, {status: 302, headers: {Location: target.href, 'Cache-Control': 'no-store'}});
  }

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${config.issuer}\0${payload.sub}`));
  const ownerId = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  headers.set('oai-authenticated-user-id', `cf-access:${ownerId}`);
  headers.set('oai-authenticated-user-email', payload.email);
  if (typeof payload.name === 'string' && payload.name.trim()) {
   headers.set('oai-authenticated-user-full-name', encodeURIComponent(payload.name));
   headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
  }
  return new Request(request, {headers});
 } catch {
  // Do not expose token contents, provider errors or request identity in logs.
  return deny('Cloudflare Access authentication failed. Sign in again.', 401);
 }
}
