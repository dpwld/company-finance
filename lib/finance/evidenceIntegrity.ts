/** Read every page; Supabase's default row limit must not truncate evidence. */
export async function collectPages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, size = 500): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const result = await read(from, from + size - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < size) return rows;
  }
}

/** Names/months are not document identity. Compare actual bytes before reuse. */
export async function identicalEvidence<T extends { storagePath: string }>(file: Blob, candidates: T[], download: (path: string) => Promise<Blob>): Promise<T | undefined> {
  const digest = async (blob: Blob) => new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  const hash = await digest(file);
  for (const candidate of candidates) {
    const other = await digest(await download(candidate.storagePath));
    if (hash.every((byte, i) => byte === other[i])) return candidate;
  }
}
