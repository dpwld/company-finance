import { sql } from "drizzle-orm";
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
/** Original Finance record shapes retained as validated JSON; ownership is never client supplied. */
export const financeRecords = sqliteTable("finance_records", {
    id: text("id").notNull(), owner: text("owner").notNull(), kind: text("kind").notNull(),
    dedupe: text("dedupe").notNull(), payload: text("payload").notNull(), refundSource: text("refund_source"),
}, table => [uniqueIndex("finance_record_identity").on(table.owner, table.kind, table.id), uniqueIndex("finance_record_dedupe").on(table.owner, table.kind, table.dedupe), uniqueIndex("finance_refund_source").on(table.owner, table.refundSource).where(sql `${table.refundSource} IS NOT NULL`)]);
