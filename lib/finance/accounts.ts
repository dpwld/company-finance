/** Account identity is a user-readable statement source, with no grant-specific filename convention. */
export type AccountKey = string;
export function accountOf(sourceFile: string | null | undefined): AccountKey {
  return sourceFile?.trim() || "통장 (출처 미지정)";
}
