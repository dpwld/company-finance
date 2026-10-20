import * as XLSX from "xlsx";
import { PROJECT, getSupportedFormName, SUPPORTED_FORM_NAMES } from "./catalog";
import type { LumosRequest } from "./types";

export { SUPPORTED_FORM_NAMES };

// Sanitized observed cell labels and merges only; original workbook values are never read at runtime.
const TEMPLATES = {
  "구매의뢰서": {
    "range": "A1:Z31",
    "merges": [
      "C25:H25",
      "J24:L24",
      "R21:Y22",
      "B17:G17",
      "O26:Q26",
      "J27:L27",
      "O22:Q22",
      "L6:O6",
      "H17:M17",
      "N17:S17",
      "J26:L26",
      "Q2:Q4",
      "O25:Q25",
      "B8:Y8",
      "B27:I27",
      "R2:U2",
      "H16:M16",
      "J25:L25",
      "L11:R11",
      "D6:H6",
      "O27:Q27",
      "R25:Y25",
      "J6:K6",
      "J22:L22",
      "B2:O2",
      "B10:Y10",
      "R24:Y24",
      "T17:Y17",
      "I21:I22",
      "V2:Y2",
      "C23:H23",
      "S12:Y12",
      "T16:Y16",
      "R27:Y27",
      "M22:N22",
      "R26:Y26",
      "M25:N25",
      "B15:Y15",
      "O23:Q23",
      "B20:Y20",
      "Q6:R6",
      "J23:L23",
      "B12:K12",
      "L12:R12",
      "M27:N27",
      "R3:U4",
      "S11:Y11",
      "B11:K11",
      "M26:N26",
      "C21:H22",
      "B16:G16",
      "M24:N24",
      "N16:S16",
      "C24:H24",
      "B6:C6",
      "B3:O4",
      "O24:Q24",
      "J21:Q21",
      "V3:Y4",
      "M23:N23",
      "C26:H26",
      "B21:B22",
      "R23:Y23",
      "S6:Y6"
    ],
    "labels": {
      "Q2": "결 재",
      "R2": "기안",
      "V2": "승인",
      "B3": "구매의뢰서",
      "B6": "문서 분류",
      "D6": "구매의뢰서",
      "J6": "작성자",
      "Q6": "작성 일자",
      "B8": "연구과제 목표 달성을 위해 아래 품목을 구입하고자 합니다.",
      "B10": "1. 연구과제",
      "B11": "연구과제명",
      "L11": "항목명",
      "S11": "세부항목명",
      "B15": "2. 구입품목",
      "B16": "업체명",
      "H16": "품목명",
      "N16": "신청금액 (VAT 제외)",
      "T16": "희망납기일",
      "B20": "3. 세부사항",
      "B21": "연번",
      "C21": "제품명",
      "I21": "수량",
      "J21": "금액",
      "R21": "구매 사유",
      "J22": "공급가액",
      "M22": "부가세",
      "O22": "공급대가",
      "B27": "합계"
    },
    "sourceSha256": "c6d26e9646f12d4aa26560ff18b716ba0f157dec6341efe2b4192ad5f08926d1"
  },
  "검수확인서": {
    "range": "A1:Z74",
    "merges": [
      "W20:Y20",
      "Q14:S14",
      "J6:L6",
      "F13:I13",
      "O7:Y7",
      "B12:Y12",
      "B41:M47",
      "N41:Y47",
      "B8:D8",
      "N14:P14",
      "C22:E22",
      "C39:X39",
      "W22:Y22",
      "B62:M68",
      "B23:Y23",
      "Q2:Q4",
      "C21:E21",
      "M6:O6",
      "F19:V19",
      "R2:U2",
      "E7:K7",
      "B17:Y17",
      "N62:Y68",
      "F14:I14",
      "D6:H6",
      "B73:Y73",
      "W21:Y21",
      "K14:M14",
      "B2:O2",
      "N13:P13",
      "F21:V21",
      "V2:Y2",
      "B9:D9",
      "W18:Y18",
      "F20:V20",
      "T13:V13",
      "B48:M54",
      "F18:V18",
      "N48:Y54",
      "C19:E19",
      "C13:E13",
      "W14:Y14",
      "K13:M13",
      "H9:N9",
      "W19:Y19",
      "Q6:R6",
      "P9:V9",
      "C18:E18",
      "Q13:S13",
      "W13:Y13",
      "R3:U4",
      "B7:D7",
      "F22:V22",
      "B26:Y26",
      "L7:N7",
      "B55:M61",
      "B6:C6",
      "T14:V14",
      "C14:E14",
      "B3:O4",
      "N55:Y61",
      "V3:Y4",
      "B72:Y72",
      "C40:X40",
      "E8:Y8",
      "C20:E20",
      "S6:Y6"
    ],
    "labels": {
      "Q2": "결 재",
      "R2": "검사자",
      "V2": "검수자",
      "B3": "검수확인서",
      "B6": "문서 분류",
      "D6": "검수확인서",
      "J6": "검사자/검수자",
      "Q6": "검수 일자",
      "B7": "과제번호",
      "L7": "과제명",
      "B8": "항목명",
      "B9": "총연구기간",
      "O9": "~",
      "B12": "1. 서비스 및 제품 내용",
      "B13": "연번",
      "C13": "업체명",
      "F13": "품명",
      "J13": "수량",
      "K13": "단가",
      "N13": "공급가액",
      "Q13": "부가세액",
      "T13": "총구입액",
      "W13": "검수일자",
      "B17": "2. 검수 내용",
      "B18": "연번",
      "C18": "항목",
      "F18": "검수 확인 사항",
      "W18": "검수 결과",
      "C19": "기한",
      "F19": "계약기간 내에 과업을 완료하였는가?",
      "C20": "내용",
      "F20": "과업에 명시된 내용에 맞게 운영되었는가?",
      "C21": "품질",
      "F21": "최종 산출물의 품질에 이상이 없는가?",
      "C22": "수량",
      "F22": "발주한 수량을 정확히 납품하였는가?",
      "B26": "3. 검수 사진",
      "B39": "연번",
      "C39": "품명",
      "Y39": "수량"
    },
    "sourceSha256": "38dbe8a1c8a793140f51d0445baf0c0cdbd47b65c9b634d07f0c0ed983545693"
  },
  "내부결재문서": {
    "range": "A1:Z32",
    "merges": [
      "R30:T30",
      "N28:Q28",
      "G28:I28",
      "R27:T27",
      "L6:O6",
      "R26:T26",
      "B23:Y23",
      "Q2:Q4",
      "B30:Q30",
      "B8:Y8",
      "U30:V30",
      "R2:U2",
      "U27:V27",
      "C28:F28",
      "B17:Y17",
      "L11:R11",
      "N27:Q27",
      "D6:H6",
      "J6:K6",
      "N26:Q26",
      "W27:Y27",
      "B2:O2",
      "B10:Y10",
      "U25:V25",
      "J24:M25",
      "V2:Y2",
      "B19:Y19",
      "R24:Y24",
      "G26:I26",
      "S12:Y12",
      "J29:M29",
      "G29:I29",
      "B24:B25",
      "J28:M28",
      "B15:Y15",
      "W29:Y29",
      "C26:F26",
      "Q6:R6",
      "B20:Y20",
      "U26:V26",
      "C29:F29",
      "W28:Y28",
      "B12:K12",
      "U28:V28",
      "R3:U4",
      "L12:R12",
      "S11:Y11",
      "N24:Q25",
      "B11:K11",
      "R25:T25",
      "W25:Y25",
      "J27:M27",
      "B6:C6",
      "R29:T29",
      "G24:I25",
      "B3:O4",
      "G27:I27",
      "J26:M26",
      "V3:Y4",
      "R28:T28",
      "U29:V29",
      "B16:Y16",
      "S6:Y6",
      "W30:Y30",
      "C27:F27",
      "W26:Y26",
      "N29:Q29",
      "C24:F25",
      "B18:Y18"
    ],
    "labels": {
      "Q2": "결 재",
      "R2": "기안",
      "V2": "승인",
      "B3": "내부 결재 문서",
      "B6": "문서 분류",
      "D6": "내부품의서",
      "J6": "작성자",
      "Q6": "작성 일자",
      "B8": "아래와 같이 결재 상신합니다.",
      "B10": "1. 연구과제",
      "B11": "연구과제명",
      "L11": "항목명",
      "S11": "세부항목명",
      "B15": "2. 품의내용",
      "B16": "품의 사유 및 상세 내역",
      "B23": "3. 품의물품",
      "B24": "연번",
      "C24": "구분",
      "G24": "사용일자",
      "J24": "거래처명",
      "N24": "구입품목",
      "R24": "금액",
      "R25": "공급가액",
      "U25": "부가세",
      "W25": "공급대가",
      "B30": "총 금액 합계"
    },
    "sourceSha256": "9f597ab466a8d818a0d02beb576a039891df426d0d35b04695e3ce7ed063ee28"
  },
  "회의록": {
    "range": "A1:Z36",
    "merges": [
      "B11:D11",
      "N33:P33",
      "E10:M10",
      "Q26:Y26",
      "N17:P17",
      "Q35:Y35",
      "E34:M34",
      "B8:Y8",
      "B34:D34",
      "B28:D28",
      "Q34:Y34",
      "E27:M27",
      "N28:P28",
      "B2:O2",
      "Q9:Y9",
      "Q27:Y27",
      "N9:P9",
      "B30:D30",
      "S21:V21",
      "Q30:Y30",
      "N30:P30",
      "B20:D20",
      "Q17:Y17",
      "E18:Y18",
      "N32:P32",
      "Q29:Y29",
      "B17:D17",
      "Q31:Y31",
      "B10:D10",
      "B19:D19",
      "N10:P10",
      "B9:D9",
      "E26:M26",
      "N34:P34",
      "E16:M16",
      "N20:P20",
      "Q12:V12",
      "B6:C6",
      "B3:O4",
      "B31:D31",
      "Q28:Y28",
      "B21:D21",
      "N12:P12",
      "N21:P21",
      "S6:Y6",
      "E29:M29",
      "E19:Y19",
      "L6:O6",
      "E31:M31",
      "H21:I21",
      "E11:Y11",
      "H12:M12",
      "E32:M32",
      "B15:Y15",
      "B24:Y24",
      "Q32:Y32",
      "Q6:R6",
      "B35:D35",
      "N27:P27",
      "N35:P35",
      "Q16:Y16",
      "E33:M33",
      "N25:Y25",
      "Q33:Y33",
      "E17:M17",
      "B12:D12",
      "E35:M35",
      "H20:I20",
      "E28:M28",
      "Q10:Y10",
      "T20:U20",
      "E9:M9",
      "B29:D29",
      "E30:M30",
      "N29:P29",
      "D6:H6",
      "J6:K6",
      "N31:P31",
      "B33:D33",
      "B32:D32",
      "B26:D26",
      "N26:P26",
      "B16:D16",
      "B25:M25",
      "N16:P16",
      "B27:D27",
      "B18:D18"
    ],
    "labels": {
      "B3": "회의록",
      "B6": "문서 분류",
      "D6": "회의록",
      "J6": "작성자",
      "Q6": "작성 일자",
      "B8": "1. 과제정보",
      "B9": "과제번호",
      "N9": "사업명",
      "B10": "수행기관",
      "N10": "연구책임자",
      "B11": "과제명",
      "B12": "과제기간",
      "N12": "~",
      "B15": "2. 회의내용",
      "B16": "회의일자",
      "N16": "회의시간",
      "B17": "회의장소",
      "N17": "타지역사유",
      "B18": "회의 목적",
      "B19": "회의 내용",
      "B20": "내부 참석자 수",
      "J20": "명",
      "N20": "외부 참석자 수",
      "V20": "명",
      "B21": "총 참석자 수",
      "J21": "명",
      "N21": "신청금액 (부가세제외)",
      "W21": "원",
      "B24": "3. 회의 참석자 명단",
      "B25": "내부 참석자",
      "N25": "외부 참석자",
      "B26": "연번",
      "E26": "성명(소속)",
      "N26": "연번",
      "Q26": "성명(소속)"
    },
    "sourceSha256": "781f8c091ca2e099385bbd7753b157b7151b6f639e3d0734b07eb3e5eaf72341"
  },
  "내부결재_회의사전신청서": {
    "range": "A1:Z36",
    "merges": [
      "B14:D14",
      "B7:C7",
      "M26:P26",
      "B23:D23",
      "E19:M19",
      "N7:O7",
      "Q20:Y20",
      "E13:M13",
      "B11:Y11",
      "Q19:Y19",
      "N25:O25",
      "B13:D13",
      "Q2:Q4",
      "E14:Y14",
      "R2:U2",
      "B19:D19",
      "N19:P19",
      "Q15:V15",
      "B34:Y34",
      "N13:P13",
      "B2:O2",
      "V2:Y2",
      "B15:D15",
      "N23:O23",
      "B24:D24",
      "B20:D20",
      "B9:Y9",
      "B3:P4",
      "N15:P15",
      "H15:M15",
      "B26:D26",
      "R3:U4",
      "D6:M6",
      "P6:Y6",
      "E22:Y22",
      "N20:P20",
      "B25:D25",
      "Q13:Y13",
      "E12:M12",
      "E21:Y21",
      "B35:Y35",
      "B6:C6",
      "Q12:Y12",
      "V3:Y4",
      "N24:O24",
      "N6:O6",
      "B22:D22",
      "D7:M7",
      "B21:D21",
      "B12:D12",
      "N12:P12",
      "P7:Y7",
      "E20:M20",
      "B18:Y18"
    ],
    "labels": {
      "Q2": "결 재",
      "R2": "기안",
      "V2": "승인",
      "B3": "내부 결재 문서(사전 신청서)",
      "B6": "문서 분류",
      "D6": "사전 신청서",
      "N6": "작성자",
      "B7": "작성 일자",
      "N7": "결재 일자",
      "B11": "1. 과제정보",
      "B12": "과제번호",
      "N12": "사업명",
      "B13": "수행기관",
      "N13": "연구책임자",
      "B14": "과제명",
      "B15": "과제기간",
      "N15": "~",
      "B18": "2. 내용",
      "B19": "일자",
      "N19": "시간",
      "B20": "장소",
      "N20": "타지역사유",
      "B21": "목적",
      "B22": "내용",
      "B23": "내부 참석자 수",
      "P23": "명",
      "B24": "외부 참석자 수",
      "P24": "명",
      "B25": "총 참석자 수",
      "P25": "명",
      "B26": "신청금액 (부가세제외)",
      "Q26": "원"
    },
    "sourceSha256": "6eb6dee8f1fb491c55b1564421594ede2ed53d2d9c39fb4373eaba291dee7fe7"
  }
} as const;

export interface LumosFormItem {
  name: string;
  vendor?: string;
  quantity?: number;
  unitPrice?: number;
  supplyAmount?: number;
  vatAmount?: number;
  totalAmount?: number;
  date?: string;
  purpose?: string;
}

export interface LumosFormInputs {
  purpose?: string;
  content?: string;
  date?: string;
  time?: string;
  location?: string;
  otherLocationReason?: string;
  desiredDate?: string;
  supplyAmount?: number;
  participants?: { name: string; affiliation?: string; external?: boolean }[];
  items?: LumosFormItem[];
}

function put(sheet: XLSX.WorkSheet, cell: string, value: string | number | undefined) {
  if (value === undefined || value === "") return;
  sheet[cell] = typeof value === "number" ? { t: "n", v: value, z: "#,##0.##" } : { t: "s", v: value };
}

export function parseLumosFormInputs(value: unknown): LumosFormInputs {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("양식 입력값을 확인해 주세요.");
  const raw = value as Record<string, unknown>;
  const out: LumosFormInputs = {};
  const textKeys = ["purpose", "content", "date", "time", "location", "otherLocationReason", "desiredDate"] as const;
  for (const key of textKeys) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string" || raw[key].length > 10000) throw new Error("양식 텍스트 입력값을 확인해 주세요.");
      out[key] = raw[key];
    }
  }
  if (raw.supplyAmount !== undefined) {
    if (typeof raw.supplyAmount !== "number" || !Number.isFinite(raw.supplyAmount) || raw.supplyAmount < 0) throw new Error("공급가액을 확인해 주세요.");
    out.supplyAmount = raw.supplyAmount;
  }
  if (raw.participants !== undefined) {
    if (!Array.isArray(raw.participants) || raw.participants.length > 18) throw new Error("참석자 입력 범위를 확인해 주세요.");
    out.participants = raw.participants.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") throw new Error("참석자 입력값을 확인해 주세요.");
      const p = entry as Record<string, unknown>;
      if (typeof p.name !== "string" || p.name.length > 300 || (p.affiliation !== undefined && (typeof p.affiliation !== "string" || p.affiliation.length > 300)) || (p.external !== undefined && typeof p.external !== "boolean")) throw new Error("참석자 입력값을 확인해 주세요.");
      return { name: p.name, affiliation: p.affiliation as string | undefined, external: p.external as boolean | undefined };
    });
    if (out.participants.filter(p => p.external).length > 9 || out.participants.filter(p => !p.external).length > 9) throw new Error("확인된 양식은 내부·외부 참석자 각각 9명까지 입력할 수 있습니다.");
  }
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items) || raw.items.length > 4) throw new Error("확인된 양식은 품목 4개까지 입력할 수 있습니다.");
    out.items = raw.items.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") throw new Error("품목 입력값을 확인해 주세요.");
      const item = entry as Record<string, unknown>;
      if (typeof item.name !== "string" || item.name.length > 300) throw new Error("품목명을 확인해 주세요.");
      const parsed: LumosFormItem = { name: item.name };
      for (const key of ["vendor", "date", "purpose"] as const) {
        if (item[key] !== undefined) {
          if (typeof item[key] !== "string" || item[key].length > 10000) throw new Error("품목 입력값을 확인해 주세요.");
          parsed[key] = item[key];
        }
      }
      for (const key of ["quantity", "unitPrice", "supplyAmount", "vatAmount", "totalAmount"] as const) {
        if (item[key] !== undefined) {
          if (typeof item[key] !== "number" || !Number.isFinite(item[key]) || item[key] < 0) throw new Error("품목 수량·금액을 확인해 주세요.");
          parsed[key] = item[key];
        }
      }
      return parsed;
    });
  }
  return out;
}

export function generateLumosWorkbook(request: LumosRequest, formName: string, supplied: LumosFormInputs = {}, project = PROJECT): Uint8Array {
  const canonical = getSupportedFormName(formName);
  if (!canonical) throw new Error("원본 서식이 확보되지 않아 이 양식은 생성할 수 없습니다.");
  const inputs = parseLumosFormInputs(supplied);
  if (canonical === "검수확인서" && (inputs.items?.length ?? 0) > 1) throw new Error("확인된 검수 양식은 품목 1개용입니다. 품목별로 작성해 주세요.");
  const sheetName = canonical === "회의 사전 신청서" ? "내부결재_회의사전신청서" : canonical;
  const template = TEMPLATES[sheetName];
  const sheet: XLSX.WorkSheet = {
    "!ref": template.range,
    "!merges": template.merges.map(range => XLSX.utils.decode_range(range)),
    "!cols": Array.from({ length: 26 }, () => ({ wch: 4 })),
    "!rows": Array.from({ length: XLSX.utils.decode_range(template.range).e.r + 1 }, () => ({ hpt: 23 })),
  };
  for (const [cell, label] of Object.entries(template.labels)) put(sheet, cell, label);
  const requestedDate = request.requestedAt.slice(0, 10);
  if (canonical === "구매의뢰서" || canonical === "내부결재문서") {
    put(sheet, "L6", request.author);
    put(sheet, "S6", requestedDate);
    put(sheet, "B12", project.title);
    put(sheet, "L12", request.category);
    put(sheet, "S12", request.item === "-" ? request.group : request.item);
  }
  if (canonical === "구매의뢰서") {
    put(sheet, "B17", inputs.items?.[0]?.vendor);
    put(sheet, "H17", inputs.items?.[0]?.name ?? request.title);
    put(sheet, "N17", inputs.supplyAmount);
    put(sheet, "T17", inputs.desiredDate);
    inputs.items?.forEach((item, i) => {
      const row = 23 + i;
      for (const [column, value] of Object.entries({ B: i + 1, C: item.name, I: item.quantity, J: item.supplyAmount, M: item.vatAmount, O: item.totalAmount, R: item.purpose ?? inputs.purpose })) put(sheet, `${column}${row}`, value);
    });
  }
  if (canonical === "내부결재문서") {
    put(sheet, "B18", inputs.purpose ?? request.notes);
    inputs.items?.forEach((item, i) => {
      const row = 26 + i;
      for (const [column, value] of Object.entries({ B: i + 1, C: request.category, G: item.date, J: item.vendor, N: item.name, R: item.supplyAmount, U: item.vatAmount, W: item.totalAmount })) put(sheet, `${column}${row}`, value);
    });
  }
  if (canonical === "검수확인서") {
    put(sheet, "E7", request.projectId);
    put(sheet, "O7", project.title);
    put(sheet, "E8", request.category);
    put(sheet, "H9", project.startDate);
    put(sheet, "P9", project.endDate);
    put(sheet, "S6", inputs.date);
    const item = inputs.items?.[0];
    if (item) {
      for (const [cell, value] of Object.entries({ B14: 1, C14: item.vendor, F14: item.name, J14: item.quantity, K14: item.unitPrice, N14: item.supplyAmount, Q14: item.vatAmount, T14: item.totalAmount, W14: inputs.date })) put(sheet, cell, value);
    }
  }
  if (canonical === "회의록" || canonical === "회의 사전 신청서") {
    const prior = canonical === "회의 사전 신청서";
    const offset = prior ? 3 : 0;
    put(sheet, prior ? "P6" : "L6", request.author);
    put(sheet, prior ? "D7" : "S6", requestedDate);
    for (const [column, row, value] of [["E", 9, request.projectId], ["Q", 9, project.name], ["E", 10, project.company], ["Q", 10, project.principal], ["E", 11, project.title], ["H", 12, project.startDate], ["Q", 12, project.endDate], ["E", 16, inputs.date], ["Q", 16, inputs.time], ["E", 17, inputs.location], ["Q", 17, inputs.otherLocationReason], ["E", 18, inputs.purpose], ["E", 19, inputs.content]] as const) put(sheet, `${column}${row + offset}`, value);
    put(sheet, prior ? "M26" : "S21", inputs.supplyAmount);
    if (inputs.participants) {
      const internal = inputs.participants.filter(p => !p.external);
      const external = inputs.participants.filter(p => p.external);
      put(sheet, prior ? "N23" : "H20", internal.length);
      put(sheet, prior ? "N24" : "T20", external.length);
      put(sheet, prior ? "N25" : "H21", inputs.participants.length);
      if (!prior) for (const [column, list] of [["E", internal], ["Q", external]] as const) {
        list.forEach((person, i) => put(sheet, `${column}${27 + i}`, person.name + (person.affiliation ? ` (${person.affiliation})` : "")));
      }
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const notes = XLSX.utils.aoa_to_sheet([
    ["서식 안내", "관찰된 원본 셀 제목과 병합 구성을 바탕으로 재구성한 편집용 초안입니다. 원본의 시각적 스타일·이미지·서명은 포함하지 않습니다."],
    ["원본 근거 SHA-256", template.sourceSha256],
    ["확인 필요", "결재·서명·검수 결과·완료 확인은 자동 입력하지 않습니다. 행사 일시·참석자·공급가액은 직접 확인하여 작성해 주세요."],
    ["검수 양식", "검수(설치) 완료 확인서와 유사 명칭인 검수확인서 원본을 참고했습니다. 설치 완료 사실은 별도 확인이 필요합니다."],
    ["요청 ID", request.id], ["요청명", request.title], ["작성자", request.author],
    ["과제번호", request.projectId], ["현금 요청액 (원)", request.cashAmount], ["현물 요청액 (원)", request.inKindAmount],
    ["금액 입력 기준", "요청액의 부가세 포함 여부를 추정하지 않았습니다. 공급가액·부가세·공급대가는 확인된 입력값만 기재합니다."],
  ]);
  notes["!cols"] = [{ wch: 25 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, notes, "작성 안내");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}
