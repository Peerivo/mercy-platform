import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicConfig } from "@/lib/config";

export const FOOD_EVIDENCE_BUCKET = "mercy-food-evidence";
export type FoodEvidenceStatus = "PENDING" | "APPROVED" | "SENDING" | "SENT" | "REJECTED";
export type FoodEvidenceRow = {
  id: string; offer_id: string; reservation_id: string;
  document_path: string; document_sha256: string; document_mime: string;
  evidence_ref: string; quantity_picked_up: number; quantity_delivered: number;
  submitted_by: string; submitted_at: string; approved_by: string | null;
  approved_at: string | null; status: FoodEvidenceStatus;
  processing_started_at: string | null; dispatched_at: string | null;
  event_id: string;
};

export function foodEvidenceService(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length < 32) throw new Error("Mercy evidence service credential is missing");
  const { url } = publicConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "mercy-food-evidence" } },
  });
}

export function evidenceIdentifier(value: unknown, kind: "offer" | "reservation"): string {
  if (typeof value !== "string") throw new TypeError("Invalid reference");
  const regex = kind === "offer" ? /^offer_lot_[a-z0-9_-]{3,80}$/ : /^reservation_[a-z0-9_-]{3,100}$/;
  if (!regex.test(value)) throw new TypeError("Invalid reference");
  return value;
}

export function evidenceQuantity(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,2})$/.test(value)) {
    throw new TypeError("Invalid evidence quantity");
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 200) throw new TypeError("Invalid evidence quantity");
  return n;
}

export function evidenceFileKind(buffer: Uint8Array, reportedMime: string): {
  ext: "pdf" | "jpg" | "png"; mime: "application/pdf" | "image/jpeg" | "image/png";
} {
  const starts = (...numbers: number[]) => numbers.every((n, i) => buffer[i] === n);
  if (reportedMime === "application/pdf" && starts(37,80,68,70,45)) return {ext:"pdf",mime:"application/pdf"};
  if (reportedMime === "image/jpeg" && starts(255,216,255)) return {ext:"jpg",mime:"image/jpeg"};
  if (reportedMime === "image/png" && starts(137,80,78,71,13,10,26,10)) return {ext:"png",mime:"image/png"};
  throw new TypeError("Evidence file type mismatch");
}

export function evidenceSha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function newFoodEvidenceIdentifiers(ext: "pdf" | "jpg" | "png") {
  const uuid = randomUUID();
  return Object.freeze({
    id: uuid,
    document_path: `evidence/${uuid}.${ext}`,
    event_id: "event_mercy_evidence_" + randomBytes(16).toString("hex"),
    evidence_ref: "evidence_fulfillment_" + randomBytes(16).toString("hex"),
  });
}

export function foodEvidenceOutcome(row: Pick<FoodEvidenceRow,"quantity_picked_up" | "quantity_delivered">) {
  const picked = row.quantity_picked_up;
  const delivered = row.quantity_delivered;
  if (delivered > picked || delivered < 0) throw new TypeError("Invalid quantities");
  return picked === 0 ? "FAILED" : delivered === 0 ? "PICKED_UP_NOT_DELIVERED" :
    delivered === picked ? "DELIVERED" : "PARTIALLY_DELIVERED";
}
