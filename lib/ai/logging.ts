import { env } from "cloudflare:workers";
import { ownerId } from "@/lib/server/auth";
import { putStatement } from "@/lib/server/records";
export async function logAiCall(_value: unknown): Promise<string> { const id = crypto.randomUUID(); await putStatement(env.DB!, await ownerId(), "ai_jobs", { id, operation: "finance-ai", status: "completed", created_at: new Date().toISOString() }).run(); return id; }
