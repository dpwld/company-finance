"use client";
import { configureMerchantAliases } from "@/lib/finance/evidenceMatch";
import { useEffect, useState } from "react";
import { fetchAppSetting, fetchAppSettingJson, saveAppSetting, saveAppSettingJson } from "@/lib/data/settings";
import { PROJECT, configureProject } from "@/lib/lumos/catalog";
export function FinanceSettings() {
    const [project, setProject] = useState({ ...PROJECT }), [guide, setGuide] = useState(""), [aliases, setAliases] = useState(""), [companion, setCompanion] = useState(""), [status, setStatus] = useState(""), [jobs, setJobs] = useState<{
        id: string;
        operation: string;
        status: string;
        created_at: string;
    }[]>([]);
    useEffect(() => { fetch("/api/jobs").then(async (response) => response.ok ? await response.json() as {
        jobs: typeof jobs;
    } : { jobs: [] }).then(value => setJobs(value.jobs)).catch(() => { }); }, []);
    useEffect(() => { Promise.all([fetchAppSettingJson<typeof PROJECT>("project"), fetchAppSetting("tips_guide"), fetchAppSetting("rcms_companion_url"), fetchAppSettingJson<[
            string,
            string
        ][]>("merchant_aliases")]).then(([p, g, c, a]) => { if (p)
        setProject({ ...PROJECT, ...p }); setGuide(g); setCompanion(c); setAliases((a || []).map(pair => pair.join("=")).join("\n")); }).catch(error => setStatus(error.message)); }, []);
    async function save(event: React.FormEvent) { event.preventDefault(); setStatus("저장 중…"); try {
        const pairs = aliases.split("\n").filter(line => line.trim()).map(line => { const parts = line.split("=").map(item => item.trim()); if (parts.length !== 2 || !parts[0] || !parts[1])
            throw new Error("가맹점 별칭은 표기=대표이름 형식으로 입력하세요."); return parts as [
            string,
            string
        ]; });
        await saveAppSettingJson("merchant_aliases", pairs);
        configureMerchantAliases(pairs);
        await saveAppSettingJson("project", project);
        await saveAppSetting("tips_guide", guide);
        await saveAppSetting("rcms_companion_url", companion);
        configureProject(project);
        setStatus("저장했습니다.");
    }
    catch (error) {
        setStatus((error as Error).message);
    } }
    return <form onSubmit={save} className="finance-settings"><h2>워크스페이스 설정</h2><p>실제 과제 정보와 적용할 연구비 가이드를 입력하세요.</p>{([['id', '과제번호'], ['name', '사업명'], ['title', '과제명'], ['company', '기관명'], ['businessNo', '사업자등록번호'], ['principal', '연구책임자'], ['startDate', '시작일'], ['endDate', '종료일']] as const).map(([key, label]) => <label key={key}>{label}<input type={key.endsWith("Date") ? "date" : "text"} value={project[key]} onChange={event => setProject({ ...project, [key]: event.target.value })}/></label>)}<label>과제 연차 수<input type="number" min="1" max="20" value={project.years} onChange={event => setProject({ ...project, years: Number(event.target.value) })}/></label><label>TIPS 판정 가이드<textarea rows={9} value={guide} onChange={event => setGuide(event.target.value)} placeholder="본인 과제에 적용되는 규정과 확인된 판정 기준"/></label><label>가맹점 별칭 (한 줄에 표기=대표이름)<textarea rows={5} value={aliases} onChange={event => setAliases(event.target.value)}/></label><label>RCMS 로컬 실행기 주소<input type="url" value={companion} onChange={event => setCompanion(event.target.value)} placeholder="사용자 실행기의 URL"/></label><p>계좌 구분은 업로드 파일명의 “일반”, “TIPS” 또는 “팁스” 표기를 사용합니다.</p><p>AI: 서버에 OPENAI_API_KEY · OPENAI_MODEL 설정 필요. RCMS: RCMS_ADAPTER_URL · RCMS_ADAPTER_TOKEN 및 본인 실행기 필요.</p><button type="submit">설정 저장</button><p role="status">{status}</p><h3>최근 AI 작업</h3>{jobs.length === 0 ? <p>실행 내역이 없습니다.</p> : <ul>{jobs.map(job => <li key={job.id}>{job.operation} · {job.status} · {job.created_at}</li>)}</ul>}</form>;
}
