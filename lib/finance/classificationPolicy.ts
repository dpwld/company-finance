export const PROPOSAL_STATUSES = ["검토가능", "확인필요", "처리불가(연구관련X)", "해당없음"] as const;
export interface CardProposal { id: string; classification: string; status: string; note: string }
export interface BankProposal { id: string; category: string; tipsEligible: boolean | null; note: string }
export interface ClassificationProposals { cards: CardProposal[]; bank: BankProposal[] }

/** Structured output still needs ID, completeness and workflow-state checks. */
export function validateClassifications(value: unknown, cardIds: string[], bankIds: string[]): ClassificationProposals {
  const result = value as ClassificationProposals;
  if (!result || !Array.isArray(result.cards) || !Array.isArray(result.bank)) throw new Error("Invalid classification proposals");
  const checkIds = (rows: { id: string }[], ids: string[]) => {
    const received = new Set(rows.map((r) => r?.id));
    if (rows.length !== ids.length || received.size !== rows.length || ids.some((id) => !received.has(id))) {
      throw new Error("Classification IDs do not match the request");
    }
  };
  checkIds(result.cards, cardIds);
  checkIds(result.bank, bankIds);
  for (const c of result.cards) {
    if (!(PROPOSAL_STATUSES as readonly string[]).includes(c.status) || typeof c.classification !== "string" || typeof c.note !== "string") {
      throw new Error("Invalid card proposal state");
    }
  }
  for (const b of result.bank) {
    if (typeof b.category !== "string" || typeof b.note !== "string" || (b.tipsEligible !== null && typeof b.tipsEligible !== "boolean")) {
      throw new Error("Invalid bank proposal");
    }
  }
  return result;
}
