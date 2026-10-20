# Service requirements

- Preserve the existing service’s navigation, fields, workflow semantics and domain calculations when changing visual design.
- Use authenticated server APIs and owner-scoped D1 records for business data. Files require owner-checked R2 storage. Browser storage is limited to display preferences.
- New databases start empty. Test fixtures belong only in tests or isolated local verification databases; never seed hosted workspaces.
- Credentials, private company information, customer/financial records and operational URLs must not be committed. Integrations use the operator’s own server secrets and explicitly report missing configuration.
- Retain the Sites identity and storage bindings in `.openai/hosting.json`. Loopback development sign-in must never become hosted authentication.
- Keep the repository and hosted service private until the owner explicitly requests a visibility change.
- Validate input and ownership on the server. Preserve existing data after rejected updates, and test persistence, isolation and relevant domain rules.
- Keep README prerequisites, data formats, executed checks and integration limitations consistent with the implementation. See FEATURE-PARITY.md and IMPLEMENTATION-REPORT.md.
- Third-party code, parsers and fonts retain their notices. No project-wide open-source license is implied.
