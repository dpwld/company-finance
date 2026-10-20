# Install and configure

These are web services you can run from source. You do not need the author's GitHub account, ChatGPT account, API keys, database, or company data to develop locally.

## Local quickstart

Install Git and Node.js **22.13 or newer** with npm. Clone this repository, open its directory, then run:

```sh
npm ci
npm run setup
npm run dev
```

Open the printed `http://127.0.0.1:5173` address. The development server supplies a loopback-only development identity. This is not a real ChatGPT sign-in and is never used for production authentication. If port 5173 is busy, use `npm run dev -- --port 5180`.

`npm run setup` builds the web service and applies committed migrations to a local D1 database. Run it again after pulling migrations: applied migrations are skipped and existing records are preserved. No demonstration data is inserted. Local D1 and R2 data live under the ignored `.wrangler/state` directory; preserve it between sessions.

The core service works without paid API keys. Follow the first-run configuration and input requirements in the README. For optional integrations, copy `.env.example` to `.dev.vars` and add only your own values. Restart the development server after changing server variables. Do not put secrets in `NEXT_PUBLIC_*` variables or commit `.dev.vars`.

## Production in your own account

Follow [Self-hosting](SELF-HOSTING.md) to use your own Cloudflare Workers, D1, R2 where needed, and Cloudflare Access identity provider. The configuration helper produces an ignored `.deploy/wrangler.json` from your own resource identifiers. It does not change the author's `.openai/hosting.json` or deploy anything automatically.

The existing Sites deployment is a separate supported path. Keep its Site ID when updating that same deployment. A repository clone is not an invitation to the author's hosted database.

## Updating and customizing

1. Back up your database and files before applying a release.
2. Pull code and run `npm ci` when dependency lockfiles change.
3. Run `npm run setup` locally, then the checks in the README.
4. For your production deployment, build, regenerate the own-account config, and apply reviewed migrations before publishing, as described in the self-hosting guide.

The account identity is the data boundary. Replacing an identity provider does not automatically migrate records between owner IDs. Company/project/member records are application data, not authentication invitations or cross-account sharing permissions.

For UI changes, start with the product components and `app/globals.css`. For domain changes, update the server validators and tests. Database changes need a committed migration; do not edit an applied migration.

## Troubleshooting

| Symptom | Check |
|---|---|
| Unsupported Node version | Use Node 22.13+ and rerun `npm ci` |
| Missing table | Run `npm run setup` from the repository root |
| Local sign-in fails | Use the printed loopback address, not a LAN address; do not expose the development server publicly |
| Optional action reports missing settings | Add the specific keys listed in `.env.example` and the README; restart the server |
| Existing records seem missing | Check the owner identity, repository directory and `.wrangler/state`; do not delete the database |
| Native dependency fails after moving `node_modules` | Run `npm ci` on the target operating system instead of copying installed dependencies |

The production Access integration must be configured in the operator's account. Local tests validate signed tokens and configuration behavior; they do not establish a live identity-provider session for you.
