# Finance source feature inventory

Source: original `src/components/finance/FinanceWorkspace.tsx` and its imported dependency closure. Original components are retained. Empty initial server database; user imports real records.

| Original feature | Port target | Verification |
|---|---|---|
| Home balances, cumulative flows, category summaries, transaction drilldown | FinanceWorkspace, MoneyDashboard, original money integrity modules | Domain totals/refund tests; build |
| Recurring merchant grouping, frequency and spend review | MoneyRecurring | Original grouping functions; build |
| Spend category charts/trends and month drilldown | MoneySpending, MoneyCharts | Original aggregation tests; build |
| Category budgets, editing and comparison | MoneyBudget, finance budget contract | D1 save/read/validation/ownership |
| Account balances and full bank history | MoneyAccounts | Original balance sorting; D1 reads |
| Transaction filters, detail editing, categories, custom categories and rules | MoneyTransactions, MoneyTransactionDetail | D1 CRUD/ownership/invalid input preservation |
| Internal/nonspend analysis and accounting split journal | legacy/SpendingTab, SplitModal | Original algorithms; D1 split ownership/integrity |
| TIPS 9th–8th window, classification review and spreadsheet export | TipsTab | Window boundary tests; real AI adapter configuration errors |
| Bank/card/Hometax Excel/CSV parser and duplicate import | original parse.ts + finance.ts contracts | Deterministic parser fixture; D1 duplicate persistence |
| RCMS transfer upload and bank reconciliation | RcmsUploader, rcmsParse | Original matching tests; no company constants |
| Receipt upload, filename matching, manual/AI review and links | EvidenceUploader, evidenceMatch, evidenceIntegrity | R2 file ownership; D1 links; actual external adapter |
| Backup JSON and CSV/XLSX exports | original components/shared helpers | Build; no seeded records |
| Request creation, request history, follow-up evidence, documents | Original Lumos components and requirement catalogs | Owner-scoped D1 requests; R2 documents; explicit external configuration |
| AI classify, journal, invoice extraction, receipt split, bot review | Authenticated server adapters | Missing-key error; no paid calls in tests |
| RCMS companion registration and generated request forms | Authenticated integration and forms APIs | Missing-user-owned integration setup; gaps documented |

Settings replace project/company metadata, business registration number and private merchant aliases; account suffixes are removed. Original Supabase transport is replaced by an owner-scoped server contract backed by D1; no localStorage business records. Actual evidence and remaining integration gaps are recorded in IMPLEMENTATION-REPORT.md.
