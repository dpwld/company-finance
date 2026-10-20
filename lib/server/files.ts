export function storageKey(owner: string, bucket: string, path: string): string { if (!["evidence", "lumos-documents"].includes(bucket) || !path || path.includes("..") || path.length > 500)
    throw new Error("올바른 파일 경로가 필요합니다."); return `${encodeURIComponent(owner)}/${bucket}/${path}`; }
