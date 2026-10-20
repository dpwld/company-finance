import expenseRules from "./data/expense-rules.json";
import changeRules from "./data/change-rules.json";
import type { LumosRequest } from "./types";

export const PROJECT = { id: "", name: "TIPS 연구비", title: "", company: "", businessNo: "", principal: "", startDate: "", endDate: "", years: 1 };
export function configureProject(value: Partial<typeof PROJECT>) { Object.assign(PROJECT, value); }

export interface ExpenseBranch {
  category: string;
  item: string;
  group: string;
  auto: [string, boolean, string][];
  upload: [string, boolean, string][];
}

export interface LumosRequirement {
  key: string;
  name: string;
  requiredBadge: boolean;
  description: string;
  mode: "auto" | "upload" | "issuance";
}

export interface BudgetAmounts {
  cashAmount: number;
  inKindAmount: number | null;
  usedAmount?: number;
  remainingAmount?: number;
  agreementAmount?: number;
  continuingAmount?: number;
  usedAgreementAmount?: number;
  usedContinuingAmount?: number;
}

export interface BudgetCategory extends BudgetAmounts {
  category: string;
  children?: BudgetCategory[];
}

export interface BudgetSnapshot {
  id: string;
  label: string;
  sourceSystem: "agreement" | "iris" | "lumos";
  snapshotDate: string;
  importedAt: string;
  sourceUnit: "천원" | "원";
  unit: "원";
  sourceDocument: string;
  sourceSha256: string;
  warnings: string[];
  summary?: {
    year: number;
    daysRemaining: number;
    projectDaysRemaining: number;
    cashRemainingAmount: number;
    inKindRemainingAmount: number;
  };
  years: (BudgetAmounts & {
    year: number;
    categories: BudgetCategory[];
  })[];
}

// Keep the complete observations, including spacing variants and source notes.
export const EXPENSE_BRANCHES = expenseRules.rows as ExpenseBranch[];
export const CHANGE_BRANCHES = changeRules.rows as ExpenseBranch[];

export const SUPPORTED_FORM_NAMES = ["구매의뢰서", "검수확인서", "내부결재문서", "회의록", "회의 사전 신청서"] as const;
export type SupportedFormName = typeof SUPPORTED_FORM_NAMES[number];

export function getSupportedFormName(name: string): SupportedFormName | null {
  if (name === "검수(설치) 완료 확인서" || name === "검수(설치)완료 확인서") return "검수확인서";
  return SUPPORTED_FORM_NAMES.find(form => form === name) ?? null;
}

export function getBranches(type: LumosRequest["type"]): ExpenseBranch[] {
  return type === "fund-request" ? EXPENSE_BRANCHES : type === "agreement-change" ? CHANGE_BRANCHES : [];
}

type RequestPick = Pick<LumosRequest, "type" | "category" | "item" | "group">;

export function matchesBranch(branch: ExpenseBranch, request: RequestPick): boolean {
  const item = request.item === "" ? "-" : request.item;
  return branch.category === request.category && branch.item === item && branch.group === request.group;
}

export function getRequirements(request: RequestPick): LumosRequirement[] {
  const branch = getBranches(request.type).find(b => matchesBranch(b, request));
  if (!branch) return [];
  return (["auto", "upload"] as const).flatMap(section => branch[section].map(([name, requiredBadge, description]) => {
    const mode = section === "auto" && name === "4대보험 가입자 명부" ? "issuance" : section;
    return { key: `${mode}:${name}`, name, requiredBadge, description, mode };
  }));
}

export function isRequirementRequired(requirement: LumosRequirement, receiptType: string): boolean {
  if (isPostPurchaseRequirement(requirement)) return false;
  // A source condition takes precedence over the visual badge in either direction.
  if (requirement.description.includes("세금계산서 거래일 경우")) {
    return receiptType.includes("세금계산서") || /^tax[-_]invoice$/i.test(receiptType);
  }
  if (requirement.description === "TIPS 제출 필수") return true;
  return requirement.requiredBadge;
}

export function isPostPurchaseRequirement(requirement: LumosRequirement): boolean {
  return requirement.mode === "upload" && ["제품 사진, 활용 사진", "시설 및 장비 사진, 활용 사진", "소프트웨어 활용 관련 사진"].includes(requirement.name);
}

/** Track later evidence independently of the request's review/payment status. */
export function getPostPurchaseEvidence(request: LumosRequest) {
  if (request.type !== "fund-request" || request.superseded || request.cashAmount < 0 || ["복원완료", "진행취소", "집행불가"].includes(request.status)) return [];
  return getRequirements(request).filter(isPostPurchaseRequirement).map(requirement => {
    const files = request.documents.filter(file => file.requirementKey === requirement.key);
    const attachedCount = new Set(files.map(file => file.storagePath || (file.url && /^(https?:\/\/|\/(?!\/))/.test(file.url) ? file.url : "")).filter(Boolean)).size;
    const minimumCount = 2;
    const status: "pending" | "partial" | "attached" = attachedCount >= minimumCount ? "attached" : attachedCount ? "partial" : "pending";
    return { requirement, attachedCount, minimumCount, status };
  });
}

export function getMissingEvidence(request: RequestPick & Pick<LumosRequest, "receiptType" | "documents">): LumosRequirement[] {
  const attached = new Set(request.documents.map(document => document.requirementKey).filter(Boolean));
  return getRequirements(request).filter(requirement => isRequirementRequired(requirement, request.receiptType) && !attached.has(requirement.key));
}
