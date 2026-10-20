import { env } from "cloudflare:workers";
import { ownerId, apiError } from "@/lib/server/auth";
import { readRows } from "@/lib/server/records";
export async function GET() { try {
    const jobs = await readRows(env.DB!, await ownerId(), "ai_jobs");
    return Response.json({ jobs: jobs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30) });
}
catch (error) {
    return apiError(error);
} }
