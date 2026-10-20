import { ownerId, apiError } from "@/lib/server/auth";
import { getRequest, projectSettings } from "@/lib/server/lumos";
import { generateLumosWorkbook } from "@/lib/lumos/forms";
import { PROJECT, getSupportedFormName } from "@/lib/lumos/catalog";
export async function GET(request: Request) { try {
    const owner = await ownerId(), query = new URL(request.url).searchParams, form = query.get("formName") || "";
    if (!getSupportedFormName(form))
        throw new Error("지원하지 않는 서식입니다.");
    const project = { ...PROJECT, ...await projectSettings(owner) };
    if (!project.id || !project.title)
        throw new Error("설정에서 과제번호와 과제명을 입력하세요.");
    const bytes = generateLumosWorkbook(await getRequest(owner, query.get("requestId") || ""), form, {}, project);
    return new Response(new Blob([new Uint8Array(bytes)]), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="request-form.xlsx"` } });
}
catch (error) {
    return apiError(error);
} }
