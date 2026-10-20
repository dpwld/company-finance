import { env } from "cloudflare:workers";
import { ownerId, apiError, sameOrigin } from "@/lib/server/auth";
import { executeQuery } from "@/lib/server/records";
export async function POST(request: Request) { try {
    const owner = await ownerId();
    sameOrigin(request);
    const data = await executeQuery(env.DB!, owner, (await request.json() as any));
    return Response.json({ data });
}
catch (error) {
    return apiError(error);
} }
