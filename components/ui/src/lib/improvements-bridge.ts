import type { ImprovementCaptureResponse, ImprovementCaptureJobResponse, SavedReply } from "../../../agent/improvements-types";

export type ImprovementsBridge = {
  isAvailable(): boolean;
  captureTurn(turnId: string): Promise<ImprovementCaptureResponse>;
  getCaptureJob(jobId: string): Promise<ImprovementCaptureJobResponse>;
  listSavedReplies(query?: string, offset?: number): Promise<SavedReply[]>;
  forgetSavedReply(turnId: string): Promise<{ ok: boolean }>;
};

declare global {
  interface Window { agenosImprovements?: ImprovementsBridge; }
}

