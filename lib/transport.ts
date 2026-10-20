/** HTTP compatibility transport for the original Finance data contracts. */
export type Row = Record<string, any>;
export type Query = {
    table: string;
    action: string;
    rows?: Row | Row[];
    filters: [
        string,
        string,
        unknown
    ][];
    orders: [
        string,
        boolean
    ][];
    select: string;
    single?: boolean;
    maybeSingle?: boolean;
    from?: number;
    to?: number;
    limit?: number;
    options?: Row;
};
export class Builder implements PromiseLike<{
    data: any;
    error: any;
}> {
    query: Query;
    constructor(table: string, private execute?: (query: Query) => Promise<{
        data: any;
        error: any;
    }>) { this.query = { table, action: "select", filters: [], orders: [], select: "*" }; }
    select(columns = "*") { this.query.select = columns; return this; }
    insert(rows: Row | Row[]) { this.query.action = "insert"; this.query.rows = rows; return this; }
    upsert(rows: Row | Row[], options?: Row) { this.query.action = "upsert"; this.query.rows = rows; this.query.options = options; return this; }
    update(rows: Row) { this.query.action = "update"; this.query.rows = rows; return this; }
    delete() { this.query.action = "delete"; return this; }
    eq(key: string, value: unknown) { return this.filter(key, "eq", value); }
    neq(key: string, value: unknown) { return this.filter(key, "neq", value); }
    gte(key: string, value: unknown) { return this.filter(key, "gte", value); }
    lt(key: string, value: unknown) { return this.filter(key, "lt", value); }
    in(key: string, value: unknown[]) { return this.filter(key, "in", value); }
    or(value: string) { return this.filter("", "or", value); }
    filter(key: string, op: string, value: unknown) { this.query.filters.push([key, op, value]); return this; }
    order(key: string, options?: {
        ascending?: boolean;
    }) { this.query.orders.push([key, options?.ascending !== false]); return this; }
    range(from: number, to: number) { this.query.from = from; this.query.to = to; return this; }
    limit(limit: number) { this.query.limit = limit; return this; }
    single() { this.query.single = true; return this; }
    maybeSingle() { this.query.maybeSingle = true; return this; }
    then<T = {
        data: any;
        error: any;
    }, U = never>(onfulfilled?: ((value: {
        data: any;
        error: any;
    }) => T | PromiseLike<T>) | null, onrejected?: ((reason: any) => U | PromiseLike<U>) | null): Promise<T | U> {
        if (this.execute)
            return this.execute(this.query).then(onfulfilled, onrejected);
        return fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.query) }).then(async (response) => {
            const result = (await response.json() as any);
            return response.ok ? { data: result.data, error: null } : { data: null, error: result.error ?? { message: "Server request failed" } };
        }).then(onfulfilled, onrejected);
    }
}
const fileUrl = (bucket: string, path: string) => `/api/files?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
export function createClient() {
    return {
        from: (table: string) => new Builder(table),
        storage: { from: (bucket: string) => ({
                async upload(path: string, file: Blob, _options?: unknown) {
                    const response = await fetch(fileUrl(bucket, path), { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
                    const result = (await response.json() as any);
                    return response.ok ? { data: result, error: null } : { data: null, error: result.error };
                },
                async download(path: string) { const r = await fetch(fileUrl(bucket, path)); return r.ok ? { data: await r.blob(), error: null } : { data: null, error: new Error(((await r.json() as any)).error?.message || "Could not read the file.") }; },
                async remove(paths: string[]) { for (const path of paths) {
                    const r = await fetch(fileUrl(bucket, path), { method: "DELETE" });
                    if (!r.ok)
                        return { error: ((await r.json() as any)).error };
                } return { error: null }; },
                async createSignedUrl(path: string, _seconds: number) { return { data: { signedUrl: fileUrl(bucket, path) }, error: null }; },
                async uploadToSignedUrl(path: string, _token: string, file: Blob, _options?: unknown) { return this.upload(path, file); },
            }) },
    };
}
