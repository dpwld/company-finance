/* Account classification uses the user-provided statement filename, not the bank processing-branch label. */

export type AccountKey = "general" | "tips" | "unknown";

export const ACCOUNT_LABEL: Record<AccountKey, string> = {
  general: "일반 통장",
  tips: "TIPS 통장",
  unknown: "통장",
};

/** 계좌번호 뒷자리와 한국어 표기 둘 다 본다 — 업로드 파일 이름이 둘 중 하나는 담고 있다. */
export function accountOf(sourceFile: string | null | undefined): AccountKey {
  const s = (sourceFile ?? "").normalize("NFC");
  if (!s) return "unknown";
  if (/TIPS|팁스/i.test(s)) return "tips";
  if (/일반/.test(s)) return "general";
  return "unknown";
}
