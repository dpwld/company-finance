# Contributing

Start with the [installation guide](docs/INSTALLATION.md) and the README's product requirements. Use a separate local database for experiments. Keep credentials, customer records, company templates, exports and database files out of commits.

Make one focused change per pull request. Describe the user-visible behavior and the checks you ran. Changes to persistence, permissions, calculation or configuration need relevant regression tests. Run `npm run typecheck`, `npm test` and `npm run build`. Self-hosting changes also require `node --test tests/deployment-auth.test.mjs tests/deployment-config.test.mjs`.

New UI and validation messages should be English. Preserve user input and external source data in their original language. Use the existing sky-blue theme tokens and semantic status colors, with text labels for important states.

This repository is currently private. Access and source availability do not by themselves grant an open-source license; retain existing third-party notices and confirm distribution rights before publishing a fork.
