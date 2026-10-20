# Company Finance implementation report

## Final authorized scope

The latest user request narrows this service to the original dashboard, recurring payments, spending analytics, budgets, accounts/cards and transaction ledger. Their original main layouts remain, with monochrome tokens and authenticated D1/R2 persistence. TIPS, research requests/history/follow-up evidence, internal/nonspend analysis, RCMS file/import/registration, company/grant settings and all corresponding component/API/dependency trees have been removed. Optional research classification, receipt AI split, journal AI, invoice extraction and research form adapters were removed with that coupling. Manual transaction receipts, splits and journal fields remain.

The remaining build routes are `/`, `/api/data`, `/api/files`, `/api/rules`, `/api/splits`, `/api/jobs` and `/api/finance/spend-classify`. Removed grant settings cannot be written through the generic data API. The new Drizzle migration `0002_complete_hiroim.sql` removes the obsolete refund-source index/column; earlier migration files remain as migration history. No request-time DDL is used.

## User classification

There is no built-in category catalog or merchant keyword rule set. New ledgers have no categories or rules. Categories and rules are owner-scoped D1 records. The classification manager supports category create/read/rename/delete; a rename updates linked card/bank/split/rule/budget references in the same batch, while deletion is rejected if referenced. Rules support create/read/edit/delete, exact or contains matching, and numeric priority. Smaller numbers win; rule ID resolves ties. Comparison trims surrounding whitespace and ignores case. The subject is card merchant/item name or bank counterparty/description fallback. No match remains unclassified.

The server applies saved user rules to new imported records. Existing classifications are stored values, not virtual labels generated at read time. Rule preview is read-only; explicit apply writes only currently unclassified records with a conditional SQL guard and preserves manual classifications. Removing a rule does not retroactively erase prior classifications.

Optional AI receives persisted owner transactions and owner category keys, never a fixed category prompt. Unknown categories/IDs and duplicate proposal IDs are rejected. Uncertain suggestions may remain empty. The user reviews suggestions before applying. Missing server `OPENAI_API_KEY`/`OPENAI_MODEL` produces a setup error and a durable failed job. No paid model calls were made.

## Financial and storage integrity

- Authenticated owner identity comes from the platform, never request JSON. D1 keys and queries are owner scoped, and writes check origin.
- Generic update/upsert uses atomic JSON field patches, including explicit nulls, so independent concurrent fields preserve each other. Invoice/bank reciprocal links clear together on deletion.
- Split replacement validates owner and exact total before an atomic batch. Parent amount edits/reimports that invalidate stored splits are rejected. Manual splits use only the owner's categories or unclassified.
- Account balances use the latest chronological statement balance plus only subsequent movements. Missing earlier history does not override a later known balance. Accounts are grouped by source filename without special grant keywords.
- Card net spending uses purchase date, approval-date fallback, negative cancellations/refunds and unknown-amount exclusion. Bank cash flow is shown separately so card settlements do not double-count spending. Arbitrary user category labels do not change this financial treatment.
- Receipt files use authenticated owner-prefixed R2 storage with size checks; metadata failures roll back file creation. File-name suggestions require human confirmation. JSON/CSV exports use persisted user records.

## Verification evidence

- `npm test`: passed against actual temporary Miniflare D1, including empty DB, CRUD, owner isolation, duplicate import, invalid input/batch preservation, restart persistence, reciprocal invoice deletions, forced concurrent initial reads, explicit nulls, parent amount/split preservation, statement balances with gaps/shuffled ordering, card totals/recurring detection and original SheetJS parser.
- Rules/category regressions cover exact/contains, priority/ties, no rules/no match, import application, preview without writes, explicit apply/idempotence, manual classification preservation, category ownership rejection, category rename/reference propagation, in-use deletion rejection, category/rule CRUD and database reopen persistence. Removed source routes/navigation and disabled grant settings are checked.
- `npm run typecheck`: passed after the scope cleanup.
- `npm run build`: passed; output contains only the remaining route list above. Vinext emits its expected dynamic-page classification notice for `/`.
- `node scripts/test-http.mjs` on loopback 5182: passed authentication, original core SSR, category/budget persistence, invalid budget preservation, origin rejection, split replacement integrity, R2 byte persistence/auth, missing AI-key error and durable failed-job observation. Test records/files are removed in cleanup.
- Parent browser QA verified all six menus, absence of removed actions, category creation, an exact-match priority-20 rule, preview of two historical records, explicit apply and persistence after page reload. The parent captured the filled dashboard and classification manager screenshots.
- Earlier clean-install verification proved `npm ci` and idempotent local migrations in isolated temporary state. The current D1 integration suite applies all three committed migrations from an empty database. Vite/migration/start storage consistently uses `.wrangler/state` and `wrangler.local.json` identity.

## FICTIONAL screenshot fixture

Only the local loopback preview on port 5182 contains an explicitly requested fictional demonstration ledger: 30 card records (August 3, September 12, October 15), 9 bank rows, 6 user-created categories, 9 saved rules and 5 category budgets. October card spend is KRW 1,967,000 with two unclassified cards; three recurring merchants have three-month history. Two fictional source accounts have known balances KRW 12,550,000 and KRW 2,008,000. Names are invented and explicitly marked fictional; no business IDs, contacts or bank/card numbers are included.

`scripts/seed-fictional-finance.mjs` explicitly calls the real authenticated local API and D1. It rejects hosted/non-loopback targets and all ports except 5182; no runtime imports or automatic seeds exist. Preflight rejects identifier/category/rule collisions without overwriting user records. Created IDs and pre-existing counts are stored in ignored `.sites-runtime/fictional-finance-manifest.json`. Cleanup deletes only manifest-listed IDs, after dependent records/rules/budgets, preserving pre-existing data. Commands are in README. The parent captured both screenshots; README captions label all example content FICTIONAL. Browser QA additionally created one explicitly fictional category/rule and applied it to two demo rows. Their exact IDs and expected fields were added to the local cleanup manifest with parent authorization.

Cleanup was executed after the parent finished both screenshots. All nine local business collections (cards, bank, categories, rules, budgets, splits, invoices, evidence metadata and links) were verified empty. The two browser-created demo records were removed using exact IDs and expected-field checks. The ignored `.sites-runtime/fictional-finance-cleanup.json` preserves the bounded ID audit; the active manifest was removed so the fixture can be recreated. No pre-existing business data was present or overwritten. Final `npm test`, typecheck, build and diff whitespace checks passed after cleanup.

## Limitations and release boundaries

1. Bank identity is source-filename based. Differently named statements from the same account appear separately; no bank-login integration or automatic account-number inference is included.
2. Compatibility queries load an owner's collection and filter/order/page in the Worker. Imports accept at most 2,000 rows per mutation. Large-ledger performance is unverified.
3. Browser import enrichment and multi-record manual classification can partially finish if a later request fails; the UI reports failure and preserves completed writes. Individual D1 mutations/split replacements validate before batch execution.
4. AI execution is request-bound rather than Queue-backed; a browser closing can interrupt the client batch and no background retry is claimed. Paid provider results remain unverified.
5. The screenshot fixture is local only. This agent made no hosted calls, pushes or deployments. Root owns browser QA, screenshots and publication. Production starts empty without an explicitly executed local fixture helper.
6. No source history, actual company records, aliases, business numbers, operational accounts or API secrets were copied. Source ownership is documented privately; SheetJS/font/starter licenses are retained without relicensing the inherited source.

## Product naming update

The user-facing product is Company Finance. Browser metadata, sidebar brand, help/error copy, README title/introduction/image descriptions and npm package/lockfile root names use Company Finance/company-finance. Internal Finance component, API, schema, folder and demo identifiers remain unchanged. Typecheck, production build and local authenticated SSR/title verification passed after this rename. The bounded fictional fixture was recreated locally on port 5182 for branded screenshot recapture and remains in place until the parent finishes; the active manifest again lists its exact IDs.
