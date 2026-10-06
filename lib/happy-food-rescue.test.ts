import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  HAPPY_FOOD_RESCUE_EVENT,
  buildDonationOutcomeAttestation,
  buildDonationReservationRelease,
  buildDonationReservationUpsert,
  createHappyFoodRescueClient,
  happyFoodRescueConfig,
  type HappyFoodRescueEnvelope,
} from "./happy-food-rescue";

const TOKEN =
  "mercy-happy-token-abcdefghijklmnopqrstuvwxyz";

describe("Happy Food Rescue adapter", () => {
  it("is disabled by default", () => {
    expect(happyFoodRescueConfig({})).toEqual({
      enabled: false,
      baseUrl: null,
      token: null,
    });
  });

  it("requires HTTPS and a strong token when enabled", () => {
    expect(() =>
      happyFoodRescueConfig({
        HAPPY_FOOD_RESCUE_ENABLED: "true",
        HAPPY_FOOD_RESCUE_URL:
          "http://happy.example.invalid",
        HAPPY_FOOD_RESCUE_TOKEN: TOKEN,
      }),
    ).toThrow(/must use https/);

    expect(() =>
      happyFoodRescueConfig({
        HAPPY_FOOD_RESCUE_ENABLED: "true",
        HAPPY_FOOD_RESCUE_URL:
          "https://happy.example.invalid",
        HAPPY_FOOD_RESCUE_TOKEN: "short",
      }),
    ).toThrow(/bounded non-empty string/);

    const config = happyFoodRescueConfig({
      HAPPY_FOOD_RESCUE_ENABLED: "true",
      HAPPY_FOOD_RESCUE_URL:
        "https://happy.example.invalid",
      HAPPY_FOOD_RESCUE_TOKEN: TOKEN,
    });
    expect(config.enabled).toBe(true);
  });

  it("builds a privacy-safe donation reservation envelope", () => {
    const event = buildDonationReservationUpsert({
      eventId: "event_mercy_food_001",
      occurredAt:
        "2026-10-06T10:00:00.000Z",
      region: "GE-AJ",
      correlationId: "corr_mercy_food_001",
      idempotencyKey:
        "idem_mercy_food_001",
      reservationRevision: 1,
      reservationId:
        "reservation_mercy_food_001",
      offerId: "offer_lot_mercy_food_001",
      quantity: 3,
      unit: "meal",
      expiresAt:
        "2026-10-06T10:30:00.000Z",
      mercyMissionRef:
        "mission_mercy_food_001",
    });

    expect(event).toMatchObject({
      eventType:
        HAPPY_FOOD_RESCUE_EVENT.RESERVATION_UPSERTED,
      contractVersion: "1.0.0",
      sourceSystem: "MERCY",
      region: "GE-AJ",
      revision: 1,
      payload: {
        quantity: 3,
        reservationRevision: 1,
      },
    });
    expect(
      JSON.stringify(event),
    ).not.toMatch(
      /beneficiary|caseId|homeAddress|email|phone/i,
    );
  });

  it("builds release and outcome events with explicit revisions", () => {
    const release =
      buildDonationReservationRelease({
        eventId:
          "event_mercy_release_001",
        occurredAt:
          "2026-10-06T10:10:00.000Z",
        region: "GE-AJ",
        correlationId:
          "corr_mercy_release_001",
        idempotencyKey:
          "idem_mercy_release_001",
        reservationRevision: 2,
        reservationId:
          "reservation_mercy_food_001",
        offerId:
          "offer_lot_mercy_food_001",
        releasedQuantity: 3,
        unit: "meal",
        reasonCode: "MISSION_CANCELLED",
      });
    expect(release.revision).toBe(2);

    const outcome =
      buildDonationOutcomeAttestation({
        eventId:
          "event_mercy_outcome_001",
        occurredAt:
          "2026-10-06T10:20:00.000Z",
        region: "GE-AJ",
        correlationId:
          "corr_mercy_outcome_001",
        idempotencyKey:
          "idem_mercy_outcome_001",
        revision: 1,
        attestationId:
          "attestation_mercy_food_001",
        offerId:
          "offer_lot_mercy_food_001",
        reservationId:
          "reservation_mercy_food_001",
        quantityPickedUp: 3,
        quantityDelivered: 2,
        unit: "meal",
        outcome: "PARTIALLY_DELIVERED",
        evidenceRef:
          "evidence_fulfillment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        attestedAt:
          "2026-10-06T10:20:00.000Z",
      });
    expect(outcome.payload).toMatchObject({
      quantityPickedUp: 3,
      quantityDelivered: 2,
      outcome: "PARTIALLY_DELIVERED",
    });
  });

  it("sends only to the fixed Happy integration endpoint with its own bearer token", async () => {
    let captured:
      | {
          input: RequestInfo | URL;
          init?: RequestInit;
        }
      | undefined;
    const fetchImpl: typeof fetch = vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        captured = { input, init };
        return new Response(
          JSON.stringify({
            accepted: true,
            eventId: "event_mercy_food_001",
          }),
          {
            status: 200,
            headers: {
              "content-type":
                "application/json",
            },
          },
        );
      },
    );

    const config = happyFoodRescueConfig({
      HAPPY_FOOD_RESCUE_ENABLED: "true",
      HAPPY_FOOD_RESCUE_URL:
        "https://happy.example.invalid",
      HAPPY_FOOD_RESCUE_TOKEN: TOKEN,
    });
    const client = createHappyFoodRescueClient({
      config,
      fetchImpl:
        fetchImpl as unknown as typeof fetch,
    });

    const event = buildDonationReservationUpsert({
      eventId: "event_mercy_food_001",
      occurredAt:
        "2026-10-06T10:00:00.000Z",
      region: "GE-AJ",
      correlationId: "corr_mercy_food_001",
      idempotencyKey:
        "idem_mercy_food_001",
      reservationRevision: 1,
      reservationId:
        "reservation_mercy_food_001",
      offerId: "offer_lot_mercy_food_001",
      quantity: 3,
      unit: "meal",
      expiresAt:
        "2026-10-06T10:30:00.000Z",
      mercyMissionRef:
        "mission_mercy_food_001",
    });

    await client.send(event);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(captured).toBeDefined();
    expect(String(captured!.input)).toBe(
      "https://happy.example.invalid/v1/integrations/mercy/food-rescue/events",
    );
    expect(captured!.init?.headers).toMatchObject({
      authorization: "Bearer " + TOKEN,
      "content-type": "application/json",
    });
    expect(captured!.init?.cache).toBe("no-store");
  });

  it("rejects PII-shaped payloads before network I/O", async () => {
    const fetchImpl = vi.fn();
    const config = happyFoodRescueConfig({
      HAPPY_FOOD_RESCUE_ENABLED: "true",
      HAPPY_FOOD_RESCUE_URL:
        "https://happy.example.invalid",
      HAPPY_FOOD_RESCUE_TOKEN: TOKEN,
    });
    const client = createHappyFoodRescueClient({
      config,
      fetchImpl:
        fetchImpl as unknown as typeof fetch,
    });

    const unsafe = {
      eventId: "event_mercy_private_001",
      eventType:
        HAPPY_FOOD_RESCUE_EVENT.DEMAND_SIGNAL,
      contractVersion: "1.0.0",
      occurredAt:
        "2026-10-06T10:00:00.000Z",
      sourceSystem: "MERCY",
      region: "GE-AJ",
      correlationId:
        "corr_mercy_private_001",
      idempotencyKey:
        "idem_mercy_private_001",
      revision: 1,
      payload: {
        signalId: "signal_mercy_001",
        caseId:
          "case_private_never_export",
      },
    } as HappyFoodRescueEnvelope;

    await expect(
      client.send(unsafe),
    ).rejects.toThrow(
      /forbidden privacy field: caseId/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when disabled", async () => {
    const client = createHappyFoodRescueClient({
      config: happyFoodRescueConfig({}),
    });
    const event = buildDonationReservationUpsert({
      eventId: "event_mercy_disabled_001",
      occurredAt:
        "2026-10-06T10:00:00.000Z",
      region: "GE-AJ",
      correlationId:
        "corr_mercy_disabled_001",
      idempotencyKey:
        "idem_mercy_disabled_001",
      reservationRevision: 1,
      reservationId:
        "reservation_mercy_disabled_001",
      offerId:
        "offer_lot_mercy_disabled_001",
      quantity: 1,
      unit: "meal",
      expiresAt:
        "2026-10-06T10:30:00.000Z",
      mercyMissionRef:
        "mission_mercy_disabled_001",
    });
    await expect(
      client.send(event),
    ).rejects.toThrow(/integration is disabled/);
  });
});
