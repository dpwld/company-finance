import type { BudgetSnapshot } from "./catalog";

export interface LumosDocument {
  id: string;
  name: string;
  requirementKey?: string;
  url?: string;
  storagePath?: string;
  mimeType?: string;
  size?: number;
  origin: "upload" | "auto" | "legacy";
}

export interface LumosMessage {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  kind: "message" | "status";
  attachments?: { name: string; url: string; storagePath?: string }[];
}

export interface LumosRequest {
  id: string;
  source: "pulse" | "lumos" | "finance";
  sourceId: string | null;
  type: "fund-request" | "agreement-change" | "general";
  title: string;
  projectId: string;
  status: string;
  category: string;
  item: string;
  group: string;
  receiptType: string;
  cashAmount: number;
  inKindAmount: number;
  requestedAt: string;
  updatedAt: string;
  assignee: string;
  author: string;
  createdBy: string | null;
  year: number;
  notes: string;
  documents: LumosDocument[];
  messages: LumosMessage[];
  sourceUrl?: string;
  originalStatus?: string;
  superseded?: boolean;
  details?: {
    financeParent?: { kind: "card" | "bank"; id: string };
    payroll?: { kind: string; cashAmount: number; inKindAmount: number }[];
    detailCaptured?: boolean;
    sourceFields?: { id: string; text: string; value: string }[];
    sourceListCells?: string[];
    extraInputs?: { context: string; value: string }[];
  };
}

export interface LumosResponse {
  requests: LumosRequest[];
  budgetSnapshots: BudgetSnapshot[];
  warnings: string[];
  storageUnavailable?: boolean;
  financeUnavailable?: boolean;
}

export interface LumosUploadPlan {
  documentId: string;
  path: string;
  token: string;
}
