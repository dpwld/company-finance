export function storageKey(owner: string, bucket: string, path: string): string { if (bucket !== "evidence" || !path || path.includes("..") || path.length > 500)
    throw new Error("A valid file path is required."); return `${encodeURIComponent(owner)}/${bucket}/${path}`; }
