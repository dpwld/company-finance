# Ledgernote final feature scope

The latest user scope supersedes the earlier research-finance inventory. The six original core screens retain their layout and underlying ledger behavior. New workspaces have no categories, rules, budgets or transactions.

| Retained capability | Implementation | Verification |
|---|---|---|
| Dashboard, cumulative card spend, recent transactions and category drilldown | FinanceWorkspace, MoneyDashboard, MoneyCharts | Domain totals, build, authenticated SSR |
| Three-month recurring merchant history | MoneyRecurring, recurringMerchants | Deterministic grouping test |
| Spending categories, monthly comparison and trend | MoneySpending | Card cancellation/unknown-amount/split totals |
| Category budgets | MoneyBudget | Actual D1 save/read, validation and HTTP persistence |
| Source-file account groups, bank balances, domestic/foreign cards | MoneyAccounts | Latest chronological balance anchor, gaps, ordering and month cutoff |
| Ledger filtering, detail, memo, manual journal fields, CSV | MoneyTransactions, MoneyTransactionDetail | Owner-scoped reads/writes, atomic field patch, explicit null |
| User category create/read/rename/delete | SpendRulesModal, D1 finance_categories | Linked record/rule/budget rename; in-use deletion rejection; owner isolation |
| User rule create/read/edit/delete, exact/contains, priority | SpendRulesModal, rules domain/server | Priority/ties, normalization, no match, no rules, missing owner category, real D1 persistence |
| Rule preview/apply, new-import rules | /api/rules, /api/data | Preview is read-only, only unclassified records updated, manual and other-owner values preserved |
| Bank/card/Hometax XLSX/XLS/CSV parsing and duplicate import | Original parse.ts, data contracts | Deterministic parser, duplicate key and invalid batch preservation |
| Manual splits, evidence upload/filename suggestion/confirmed linking | SplitModal, EvidenceUploader, R2 and D1 | Parent ownership, total integrity, invalid replacement preservation, R2 bytes/auth |
| CSV and JSON backup | Core UI and retained data contracts | Build; user-owned ledger export |
| Optional explicit AI category suggestions | /api/finance/spend-classify | Only persisted owner category keys/transaction IDs accepted; missing credentials observable |

Removed, rather than hidden: TIPS worksheet/toggle/flags/refund pairing/window/export, research requests/history/follow-up evidence/forms, internal/nonspend screen, RCMS upload/registration/runner adapter, grant/company settings and their API/component/dependency trees. No built-in category catalog, company merchant keyword rules or silent classification fallback remains. General transaction receipt evidence remains available; it is separate from the removed research follow-up product.

Card net spending and bank cash flow remain separate measures. Bank account identity is the user-readable source filename, not special grant/account keywords. User categories are arbitrary labels and do not silently exclude transactions from aggregates. In-use categories must be detached before deletion; renames update existing references atomically.
