import type { LumosRequest, LumosDocument } from "../lumos/types";

export type RcmsJobStatus = "queued" | "running" | "submitting" | "needs_login" | "needs_review" | "registered" | "duplicate" | "uncertain" | "failed";
export type RcmsAmounts = { supplyAmount: number; vatAmount: number; totalAmount: number };
export type RcmsRegistrationResult = {
  reference: string;
  verification: string;
  url: string;
  amounts?: RcmsAmounts;
};
export type RcmsJob = {
  id: string;
  requestId: string;
  status: RcmsJobStatus;
  verificationOnly: boolean;
  message: string;
  result: RcmsRegistrationResult | null;
  createdAt: string;
  updatedAt: string;
};
export type RcmsRegistrationState = {
  review: { approved: boolean; reason?: string; reviewedAt?: string };
  job: RcmsJob | null;
};
export type RcmsLaunch = { jobId: string; token: string };
export type RcmsAgentPacket = {
  version: 1;
  jobId: string;
  request: LumosRequest;
  documents: (LumosDocument & { downloadUrl?: string })[];
  policy: { vat: "included_then_restored"; registrationOnly: true; postPurchasePhotos: true };
  verificationOnly: boolean;
  dashboardUrl: string;
};
