import {describe,it,expect} from "vitest";
import {
 evidenceIdentifier,evidenceQuantity,evidenceFileKind,evidenceSha256,
 foodEvidenceOutcome,newFoodEvidenceIdentifiers
} from "./food-donation-evidence";

describe("Mercy Food Rescue evidence boundary",()=>{
 it("accepts only opaque Food offer and reservation references",()=>{
  expect(evidenceIdentifier("offer_lot_safe_abc","offer")).toBe("offer_lot_safe_abc");
  expect(evidenceIdentifier("reservation_safe_123","reservation")).toBe("reservation_safe_123");
  expect(()=>evidenceIdentifier("https://example.org/private","offer")).toThrow();
  expect(()=>evidenceIdentifier("reservation_/../../secrets","reservation")).toThrow();
 });
 it("validates whole nonnegative quantities",()=>{
  expect(evidenceQuantity("0")).toBe(0);
  expect(evidenceQuantity("200")).toBe(200);
  for(const x of ["-1","201","1.3","1e2","1;DROP TABLE",""]) {
   expect(()=>evidenceQuantity(x)).toThrow();
  }
 });
 it("checks file signatures, not only supplied MIME",()=>{
  expect(evidenceFileKind(new Uint8Array([37,80,68,70,45,48]),"application/pdf").ext).toBe("pdf");
  expect(evidenceFileKind(new Uint8Array([255,216,255,224]),"image/jpeg").ext).toBe("jpg");
  expect(evidenceFileKind(new Uint8Array([137,80,78,71,13,10,26,10]),"image/png").ext).toBe("png");
  expect(()=>evidenceFileKind(new Uint8Array([37,80,68,70,45]),"image/png")).toThrow();
  expect(()=>evidenceFileKind(new Uint8Array([60,104,116,109,108]),"application/pdf")).toThrow();
 });
 it("generates private object and attestation ids in strict format",()=>{
  const r=newFoodEvidenceIdentifiers("pdf");
  expect(r.document_path).toMatch(/^evidence\/[0-9a-f-]{36}\.pdf$/);
  expect(r.evidence_ref).toMatch(/^evidence_fulfillment_[0-9a-f]{32}$/);
  expect(r.event_id).toMatch(/^event_mercy_evidence_[0-9a-f]{32}$/);
  expect(newFoodEvidenceIdentifiers("png").document_path).not.toBe(r.document_path);
 });
 it("generates stable SHA256 integrity proof and distinct outcome types",()=>{
  expect(evidenceSha256(new Uint8Array([97,98,99]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(foodEvidenceOutcome({quantity_picked_up:0,quantity_delivered:0})).toBe("FAILED");
  expect(foodEvidenceOutcome({quantity_picked_up:3,quantity_delivered:0})).toBe("PICKED_UP_NOT_DELIVERED");
  expect(foodEvidenceOutcome({quantity_picked_up:3,quantity_delivered:2})).toBe("PARTIALLY_DELIVERED");
  expect(foodEvidenceOutcome({quantity_picked_up:3,quantity_delivered:3})).toBe("DELIVERED");
  expect(()=>foodEvidenceOutcome({quantity_picked_up:1,quantity_delivered:2})).toThrow();
 });
});
