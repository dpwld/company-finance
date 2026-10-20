import { env } from "cloudflare:workers";
import { z } from "zod";
import { ownerId, sameOrigin, apiError } from "@/lib/server/auth";
import { applyUserRules } from "@/lib/server/rules";
export async function POST(request: Request) {
 try {
  const owner = await ownerId(); sameOrigin(request);
  const { apply } = z.object({ apply: z.boolean() }).strict().parse(await request.json());
  return Response.json(await applyUserRules(env.DB!, owner, apply));
 } catch(error) { return apiError(error); }
}
