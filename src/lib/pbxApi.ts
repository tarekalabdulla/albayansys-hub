// PBX live monitoring + CDR API
import { api } from "./api";

export interface LiveCall {
  id: number;
  callKey: string;
  ext: string | null;
  agentName: string | null;
  remote: string | null;
  direction: "incoming" | "outgoing" | "internal" | "transferred" | "forwarded" | "unknown";
  status: "ringing" | "answered" | "busy" | "no_answer" | "failed" | "cancelled" | "completed";
  answered: boolean;
  startedAt: string;
  answeredAt: string | null;
  lastSeenAt: string;
  elapsedSec: number;
  transferTo: string | null;
  forwardedTo: string | null;
  customerId: string | null;
  customerName: string | null;
  claimNumber: string | null;
  trunk: string | null;
  queue: string | null;
}

export interface CallLog extends Omit<LiveCall, "elapsedSec" | "lastSeenAt"> {
  endedAt: string | null;
  duration: number;
  talkSeconds: number;
  failureReason: string | null;
  transferFrom: string | null;
  recordingUrl: string | null;
  claimId: string | null;
}

export interface PbxStatus {
  yeastarApi: { configured: boolean; hasToken: boolean; expiresInSec: number };
  yeastarOpenApiWs: { configured: boolean; authMode: string; hasToken: boolean; wsState: number; topics: number[] };
  ami: { configured: boolean; connected: boolean; loggedIn: boolean; host: string | null; port: number };
  time: string;
}

export const pbxApi = {
  live: async (): Promise<LiveCall[]> => {
    const { data } = await api.get("/pbx/live");
    return data.live || [];
  },
  calls: async (params: { limit?: number; direction?: string; ext?: string } = {}): Promise<CallLog[]> => {
    const { data } = await api.get("/pbx/calls", { params });
    return data.calls || [];
  },
  status: async (): Promise<PbxStatus> => {
    const { data } = await api.get("/pbx/status");
    return data;
  },
};
