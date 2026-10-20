# Company Finance

Statement-based bookkeeping for small companies. Import bank and card activity, define your own categories and rules, and track spending, balances, recurring payments and budgets.

English · [한국어](README.ko.md)

[Quickstart](#quickstart) · [Requirements](#requirements) · [Data formats](#supported-data) · [Self-hosting](docs/SELF-HOSTING.md) · [Contributing](CONTRIBUTING.md)

![Company Finance dashboard](docs/images/overview.png)

*Fictional demonstration data in a real local service. Installation starts with an empty database; examples are never inserted automatically.*

## Quickstart

Prerequisites: **Git, Node.js 22.13+ and npm**.

```sh
git clone https://github.com/dpwld/company-finance.git
cd company-finance
npm ci
npm run setup
npm run dev
```

Open the printed loopback address, normally `http://127.0.0.1:5173`. Local development needs no ChatGPT account or paid API keys. Setup builds the service and applies committed local database migrations without overwriting records or inserting samples.

Start with **Category rules** to create your categories, then import a supported statement and review the import preview. Saved rules categorize new transactions automatically. Existing transactions change only after an explicit preview and apply action.

See [Installation](docs/INSTALLATION.md) for updating and troubleshooting, or [Self-hosting](docs/SELF-HOSTING.md) to configure your own Cloudflare resources and authentication. The author's hosted service and Site ID are not required for your own deployment.

## Requirements

| Dependency | Used for | Without it |
|---|---|---|
| D1 binding `DB` | Transactions, categories, rules, budgets and settings | Required; local setup prepares an emulated database |
| R2 binding `BUCKET` | Receipt uploads and downloads | Core bookkeeping works; file actions report missing storage |
| Production authentication | User-scoped data | Use Cloudflare Access for your own deployment, or Sites authentication on Sites |
| Your categories and rules | Categorization and budgets | No preset categories or hidden merchant rules; unmatched records remain uncategorized |
| Optional `OPENAI_API_KEY`, `OPENAI_MODEL` | Explicit AI category suggestions | Manual categories and deterministic rules work without AI |

Copy [`.env.example`](.env.example) to the ignored `.dev.vars` only when configuring optional APIs. Add your own credentials and restart the local server. Production secrets belong in the deployment provider's secret store, never browser variables.

## Supported data

The interface is English. Source records retain their original language and currency. This release supports **KRW statements with the following Korean source headers**; it does not connect directly to bank or tax accounts.

| Source | File format and expected fields |
|---|---|
| KB card statements | XLSX, XLS or CSV with `승인일`, `가맹점명`, and `합계` or `승인금액`. Approval numbers are used for duplicate detection when present. Unknown KRW amounts remain null. |
| KB bank statements | XLSX, XLS or CSV with `거래일시` and `출금액` (unit suffixes allowed); also reads deposits, counterparty, description and optional balance. The source filename identifies the account. |
| Hometax tax invoices | XLSX, XLS or CSV with `작성일자`, `공급가액` or `합계금액`; reads tax, counterparty and approval number. Include `매출` (sales) or `매입` (purchase) in the filename/sheet name. Included in stored records and JSON backup. |
| Receipts | PDF, images and office documents under 20 MB. Filename-based suggestions require you to review and confirm the linked transaction. |

Header aliases and format detection are in [`lib/finance/parse.ts`](lib/finance/parse.ts). Arbitrary CSV formats are not automatically interpreted. Company-specific classification columns are ignored; categories come from your own rules or edits.

## Workflows

| Area | What you can do |
|---|---|
| Dashboard | Inspect net card spending, trends, uncategorized activity, bank balances and recent transactions |
| Recurring payments | Find merchants appearing in at least three months; inspect actual payment history |
| Spending | Explore category shares, previous-month comparisons and six-month trends |
| Budget | Save monthly category limits and compare them with net card spending |
| Accounts & cards | Review source-file account balances and domestic/international card spending |
| Transactions | Search/filter across months, export CSV, edit notes and journal fields, categorize, split and link receipts |
| Categories & rules | Create/rename/delete categories; create/edit/delete exact or contains rules; preview and apply to uncategorized history |

**Calculation boundaries.** Card spending uses the posting month (approval date if unavailable), including negative refunds and cancellations. Unknown KRW amounts are excluded from totals. Bank cash flow remains separate to avoid counting card settlement twice. Different source filenames are separate accounts.

**Rule behavior.** Rules compare merchant/counterparty names, falling back to item/description. Matching ignores case and surrounding spaces. Lower priority numbers run first; ties use rule ID order. Manual categories are preserved. Renaming a category updates linked transactions, splits, rules and budgets; in-use categories cannot be deleted until detached. Optional AI is restricted to your saved transactions and categories and requires review before applying.

![User-defined category rules](docs/images/classification-rules.png)

*Fictional categories and transaction names. No company rules or business data are included.*

## Example screenshots

Use an isolated local preview on **port 5182**. The helper rejects hosted URLs, records created IDs and refuses collisions.

```sh
npm run dev -- --port 5182
# In another terminal:
node scripts/seed-fictional-finance.mjs seed http://127.0.0.1:5182
node scripts/seed-fictional-finance.mjs status http://127.0.0.1:5182
# Remove only the helper's recorded example data:
node scripts/seed-fictional-finance.mjs cleanup http://127.0.0.1:5182
```

Examples contain 30 card transactions, 9 bank transactions, 6 categories, 9 rules and 5 budgets. Names are invented. No real account numbers, contacts or identifiers are used. The ignored `.sites-runtime/fictional-finance-manifest.json` tracks cleanup; keep it until cleanup completes.

## Development and verification

```sh
npm run typecheck
npm test
node --test tests/deployment-auth.test.mjs tests/deployment-config.test.mjs
npm run build
# With the local development server on port 5182:
node scripts/test-http.mjs
```

React/Vinext UI → authenticated APIs → owner-scoped D1 records. R2 files are owner-checked. Tests cover actual temporary D1 persistence, rule precedence/preview/apply, duplicate imports, invalid-input preservation, atomic field updates, splits, invoice integrity, balances and original statement parsers. HTTP checks cover sign-in requirements, origin rejection, D1 mutations and R2 bytes, and clean up their test records. Paid AI calls are not part of QA.

The six core screens exclude research-grant finance workflows. See [feature scope](docs/FEATURE-PARITY.md) and [implementation report](docs/IMPLEMENTATION-REPORT.md). Cross-account team sharing, live bank connections and arbitrary multi-currency bookkeeping are not implemented. Preserve [source notices](THIRD_PARTY_NOTICES.md) and bundled third-party notices when reusing the code.
