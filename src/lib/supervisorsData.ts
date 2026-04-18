import { AGENTS } from "./mockData";

export interface Supervisor {
  id: string;
  name: string;
  email: string;
  ext: string;
  role: "مشرف" | "مشرف أول" | "مدير قسم";
  agentIds: string[];
}

export const SUP_KEY = "callcenter:supervisors";

const SEED: Supervisor[] = [
  {
    id: "S-001",
    name: "أ. سلمان العامر",
    email: "salman@bayan.sa",
    ext: "1001",
    role: "مدير قسم",
    agentIds: AGENTS.slice(0, 4).map((a) => a.id),
  },
  {
    id: "S-002",
    name: "أ. منى الشمري",
    email: "mona@bayan.sa",
    ext: "1002",
    role: "مشرف أول",
    agentIds: AGENTS.slice(4, 8).map((a) => a.id),
  },
  {
    id: "S-003",
    name: "أ. بدر الزهراني",
    email: "badr@bayan.sa",
    ext: "1003",
    role: "مشرف",
    agentIds: AGENTS.slice(8, 12).map((a) => a.id),
  },
];

export function loadSupervisors(): Supervisor[] {
  try {
    const raw = localStorage.getItem(SUP_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Seed and persist so detail page can find them
  try {
    localStorage.setItem(SUP_KEY, JSON.stringify(SEED));
  } catch {}
  return SEED;
}

export function saveSupervisors(list: Supervisor[]) {
  localStorage.setItem(SUP_KEY, JSON.stringify(list));
}
