# Install in your own Cloudflare account

This service can run on your own Cloudflare Workers, D1 and R2 resources with Cloudflare Access authentication. It does not require access to the original owner’s Sites project. Local development continues to use the loopback development sign-in described in the README.

The database starts empty. Each authenticated Access identity receives its own data namespace; signing in does not share another account’s records. User-created directory entries do not grant account access. The entire hostname is private: recipients of any signed customer links must also satisfy your Access policy.

## Prepare your account

1. Install the README’s supported Node.js version and run `npm ci`.
2. Authenticate Wrangler with your Cloudflare account: `npx wrangler login`.
3. Create a D1 database and R2 bucket with names you choose:

   ```sh
   npx wrangler d1 create my-workspace-db
   npx wrangler r2 bucket create my-workspace-files
   ```

4. In Cloudflare Zero Trust, create a **self-hosted Access application** covering the entire custom hostname you will use, such as `workspace.example.com`. Configure an allow policy for the intended users and your chosen identity provider. Use a hostname in a Cloudflare-managed zone in the same account.
5. Copy your Cloudflare account ID, the new D1 database ID, Access team domain and application audience (AUD) tag.
6. Create your local settings file:

   ```sh
   mkdir -p .deploy
   cp deployment.settings.example.json .deploy/settings.json
   ```

Replace every placeholder in `.deploy/settings.json`. Keep `authMode` set to `cloudflare-access`. The team domain must be the HTTPS origin `https://<team>.cloudflareaccess.com`, and the audience must be your Access application’s 64-character AUD tag. The generated configuration disables `workers.dev` and preview URLs and uses your custom domain.

## Build, review and deploy

These commands prepare an installation in your account. Migration and deployment commands change your Cloudflare resources.

```sh
npm run build
node scripts/configure-deployment.mjs .deploy/settings.json

# Inspect .deploy/wrangler.json, then validate packaging without publishing:
npx wrangler deploy --config .deploy/wrangler.json --dry-run

# Apply the committed schema to your new remote database:
npx wrangler d1 migrations apply DB --remote --config .deploy/wrangler.json

# Publish to your own account:
npx wrangler deploy --config .deploy/wrangler.json
```

Rerun the build and configuration commands before each deployment. The generator writes only the ignored `.deploy/wrangler.json`; it does not create resources, upload code, copy existing business data, or edit `.openai/hosting.json`. Review the generated account ID, resource bindings and hostname before any remote command. The original Sites configuration remains available independently.

Open your custom domain and complete Access sign-in. Verify that your new workspace is empty, create a record, reload it, and test an attachment if your service uses files. A direct request without a valid Access JWT must be rejected even if it supplies `oai-authenticated-*` headers.

## Authentication and optional integrations

Standalone mode is explicit: `DEPLOYMENT_AUTH=cloudflare-access`, with `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`. Invalid configuration fails closed. The worker verifies the Access JWT’s RS256 signature, issuer, audience, expiry and user claims using `jose` and the team’s rotating JWKS endpoint. It removes incoming internal identity headers and derives them from the verified token. Existing sign-in links return safely to the app; sign-out links use Access logout. Access logout ends the user’s Access session across applications, as documented by Cloudflare.

The owner ID is a stable `cf-access:` identifier derived from the team issuer and subject. Access and Sites identities are separate; this installation does not import or reassign the original owner’s data. Leave the default authentication mode unchanged for Sites deployments, where Sites supplies trusted identity upstream. Never deploy the default Sites mode directly as a standalone public Worker.

Optional integrations still require your own credentials, as listed in the README. Set secrets using your own generated configuration, for example:

```sh
npx wrangler secret put OPENAI_API_KEY --config .deploy/wrangler.json
```

Use the current installation’s authenticated owner ID where `INTEGRATION_OWNER_ID` is required. Do not put provider secrets in settings JSON, source files, screenshots or Git. A missing provider credential does not disable core records or bypass authentication.

## Verification and references

```sh
node --test tests/deployment-auth.test.mjs tests/deployment-config.test.mjs
npm run typecheck
npm run build
```

The tests generate temporary signing keys locally and simulate the public JWKS response. They exercise valid, expired, forged, wrong-issuer, wrong-audience, missing-claim and spoofed-header requests, key identifiers, JWKS outages, safe auth redirects, and generated resource configuration. They do not contact an identity provider or deploy infrastructure. A real Access/Workers deployment still needs verification with your account.

Implementation references: [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Access session/logout behavior](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/), [Workers static assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/), and [jose](https://github.com/panva/jose).
