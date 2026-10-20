# Development instructions

Read `docs/SERVICE-REQUIREMENTS.md` and `docs/FEATURE-PARITY.md` before changing behavior. Make focused changes that preserve the existing workflows. Keep credentials and business records out of Git and test fixtures out of runtime data. Preserve the Site ID and private audience. Run relevant tests, `npm run typecheck` and `npm run build` before claiming a change is verified. Document external connections that still require operator configuration.
