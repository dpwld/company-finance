import { getChatGPTUser } from "@/app/chatgpt-auth";
export async function ownerId(): Promise<string> { const user = await getChatGPTUser(); if (!user)
    throw new Error("unauthorized"); return user.userId; }
export function apiError(error: unknown) { const message = error instanceof Error ? error.message : "Could not process the request"; return Response.json({ error: { message } }, { status: message === "unauthorized" ? 401 : 400 }); }
export function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (origin && new URL(request.url).origin !== origin)
    throw new Error("The request origin is not allowed."); }
