import type { LumosRequirement } from "./catalog";

/* Finance에 올린 증빙을 업무요청의 "필요 서류" 칸에 배정한다.

   Finance 증빙은 요청서를 읽을 때 자동으로 첨부되지만 requirementKey가 없어서
   어느 칸도 채우지 못했다 — getMissingEvidence는 requirementKey로만 판단한다.
   파일명이 사내 규칙(`MMDD거래처(품목)_서류종류`)을 따르므로 이름만으로 충분히
   갈라진다. AI 대신 사전으로 푸는 이유는 오배정이 검수를 잘못 통과시키기 때문 —
   확신이 없으면 배정하지 않고 비워 둔다. */

/** 서류 이름 → 파일명에 나타나는 표현들. 앞쪽 항목이 더 구체적이어야 한다. */
const SYNONYMS: [RegExp, RegExp][] = [
  [/집행영수증/, /영수증|매출전표|카드전표|세금계산서|결제내역|결제확인|납부확인|수납/],
  [/거래명세서|거래명세표/, /거래명세서|거래명세표/],
  [/사업자\s*등록증/, /사업자등록증/],
  [/통장\s*사본/, /통장사본/],
  [/계좌이체증명/, /이체확인증|이체증|계좌이체|자동이체확인/],
  [/견적서/, /견적서/],
  [/구매의뢰서/, /구매의뢰서/],
  [/검수.*확인서/, /검수확인서|검수완료|검수/],
  [/내부결재문서/, /내부결재|품의/],
  [/지출결의서/, /지출결의/],
  [/계약서/, /계약서/],
  [/교육수료증/, /수료증/],
  [/교육비\s*수납\s*영수증/, /교육비|수납영수증/],
  [/학회등록비\s*영수증/, /등록비/],
  [/학회.*참가확인서/, /참가확인/],
  [/출장신청서/, /출장신청/],
  [/출장결과보고서/, /출장결과|출장보고/],
  [/출입국\s*사실\s*증명서/, /출입국/],
  [/여비규정/, /여비규정/],
  [/자체\s*규정/, /자체규정/],
  [/회의록/, /회의록/],
  [/회의\s*사전\s*신청서/, /회의사전|사전신청/],
  [/급여대장/, /급여대장/],
  [/참여연구원\s*현황표/, /참여연구원/],
  [/초과근무내역/, /초과근무/],
  [/수입신고/, /수입신고/],
  [/배달증명/, /배달증명/],
  [/논문초록/, /초록/],
  [/발표자료/, /발표자료/],
  [/사진/, /사진|사용화면|활용화면/],
];

const normalize = (s: string) =>
  s.normalize("NFC").toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[\s()（）,*'"._-]+/g, "");

/**
 * 파일 하나를 필요 서류 항목에 배정한다. 맞는 게 없으면 null.
 * "기타"는 아무 파일이나 삼켜버리므로 후보에서 뺀다.
 */
export function assignRequirement(fileName: string, requirements: LumosRequirement[]): string | null {
  const name = normalize(fileName);
  if (!name) return null;
  const candidates = requirements.filter((r) => r.name !== "기타");

  // ① 서류 이름이 파일명에 그대로 들어 있으면 그걸로 — 가장 확실하다.
  for (const requirement of candidates) {
    if (name.includes(normalize(requirement.name))) return requirement.key;
  }
  // ② 사전에 등록된 표현으로 찾는다.
  for (const [target, pattern] of SYNONYMS) {
    if (!pattern.test(name)) continue;
    const hit = candidates.find((r) => target.test(r.name));
    if (hit) return hit.key;
  }
  return null;
}

export interface AssignedEvidence {
  evidenceId: string;
  fileName: string;
  /** 배정된 필요 서류의 key. 판단이 안 서면 null — 빈 칸으로 둔다. */
  requirementKey: string | null;
  requirementName: string | null;
}

/** 여러 파일을 배정한다. 한 칸에 여러 파일이 걸리면 모두 그 칸으로 보낸다. */
export function assignEvidence(
  files: { id: string; fileName: string }[],
  requirements: LumosRequirement[],
): AssignedEvidence[] {
  return files.map((file) => {
    const key = assignRequirement(file.fileName, requirements);
    return {
      evidenceId: file.id,
      fileName: file.fileName,
      requirementKey: key,
      requirementName: key ? requirements.find((r) => r.key === key)?.name ?? null : null,
    };
  });
}
