import {
  describe,
  expect,
  it,
} from "vitest";
import { z } from "zod";

import {
  buildDonationOutcomeAttestation,
  buildDonationReservationUpsert,
  createHappyFoodRescueClient,
  happyFoodRescueConfig,
} from "../lib/happy-food-rescue";

const live =
  process.env.HAPPY_FOOD_RESCUE_STAGING_E2E ===
  "true";

const baseUrl =
  process.env.HAPPY_FOOD_RESCUE_URL ?? "";
const merchantToken =
  process.env.HAPPY_FOOD_RESCUE_API_TOKEN ?? "";
const integrationToken =
  process.env.HAPPY_FOOD_RESCUE_TOKEN ?? "";
const declaredStagingRevision =
  process.env.HAPPY_FOOD_RESCUE_STAGING_REVISION ??
  "";

const STAGING_ORIGIN =
  "https://happy-food-staging-staging.up.railway.app";
const STAGING_REVISION =
  "0917bb8f7b43805f02242db8b70d1733da6c25f5";
const MERCHANT_PATH = "/v1/food-rescue";
const INTEGRATION_PATH =
  "/v1/integrations/mercy/food-rescue/events";
const REQUEST_TIMEOUT_MS = 10_000;

const errorResponseSchema = z
  .object({
    error: z
      .string()
      .regex(/^[a-z0-9_:-]{1,64}$/),
  })
  .passthrough();

const reservationSchema = z
  .object({
    reservationId: z.string(),
    status: z.string(),
    quantity: z.number(),
  })
  .passthrough();

const merchantResponseSchema = z
  .object({
    requestId: z.string(),
    operation: z.string(),
    data: z
      .object({
        lotId: z.string(),
        version: z.number().int(),
        lot: z
          .object({
            available: z.record(
              z.string(),
              z.number(),
            ),
            reservations: z.array(
              reservationSchema,
            ),
            accounting: z
              .object({
                donated: z.number(),
                donationInCustody:
                  z.number(),
              })
              .passthrough(),
          })
          .passthrough(),
        quantity: z
          .object({
            total: z.number(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const integrationResponseSchema = z
  .object({
    accepted: z.literal(true),
    eventId: z.string(),
    eventType: z.string(),
    effect: z.string(),
    lotId: z.string().nullable().optional(),
    lotVersion: z
      .number()
      .int()
      .nullable()
      .optional(),
    replayed: z.boolean().optional(),
  })
  .passthrough();

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function idSuffix() {
  return Date.now().toString(36);
}

function requireHarnessConfiguration() {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(
      "HAPPY_FOOD_RESCUE_URL must be the pinned staging origin",
    );
  }

  if (
    parsed.origin !== STAGING_ORIGIN ||
    parsed.pathname !== "/" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "HAPPY_FOOD_RESCUE_URL is not the pinned Happy staging origin",
    );
  }

  if (
    declaredStagingRevision !==
    STAGING_REVISION
  ) {
    throw new Error(
      "HAPPY_FOOD_RESCUE_STAGING_REVISION does not match the pinned Happy staging deployment",
    );
  }

  if (merchantToken.length < 32) {
    throw new Error(
      "HAPPY_FOOD_RESCUE_API_TOKEN must contain the staging merchant/pilot credential",
    );
  }
  if (integrationToken.length < 32) {
    throw new Error(
      "HAPPY_FOOD_RESCUE_TOKEN must contain the staging Mercy integration credential",
    );
  }
  if (merchantToken === integrationToken) {
    throw new Error(
      "Happy merchant and Mercy integration credentials must be distinct",
    );
  }
}

type JsonResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

async function postJson(
  path: string,
  token: string,
  body: unknown,
  actorRef?: string,
): Promise<JsonResponse> {
  const headers: Record<string, string> = {
    authorization: "Bearer " + token,
    "content-type": "application/json",
    accept: "application/json",
  };
  if (actorRef) {
    headers["x-peerivo-actor-ref"] = actorRef;
  }

  const response = await fetch(
    new URL(path, STAGING_ORIGIN),
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(
        REQUEST_TIMEOUT_MS,
      ),
    },
  );

  const bodyJson: unknown = await response
    .json()
    .catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    body: bodyJson,
  };
}

function safeErrorCode(body: unknown) {
  const parsed =
    errorResponseSchema.safeParse(body);
  return parsed.success
    ? parsed.data.error
    : "invalid_error_response";
}

function parseMerchantResponse(body: unknown) {
  const parsed =
    merchantResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      "Happy merchant API returned an invalid response shape",
    );
  }
  return parsed.data;
}

function parseIntegrationResponse(
  body: unknown,
) {
  const parsed =
    integrationResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      "Happy Mercy integration returned an invalid response shape",
    );
  }
  return parsed.data;
}

async function happyApi(
  operation: string,
  payload: Record<string, unknown>,
  actorRef?: string,
) {
  const response = await postJson(
    MERCHANT_PATH,
    merchantToken,
    {
      requestId:
        "request_e2e_" +
        operation.toLowerCase() +
        "_" +
        idSuffix(),
      operation,
      payload,
    },
    actorRef,
  );

  if (!response.ok) {
    throw new Error(
      "Happy API " +
        operation +
        " failed: " +
        response.status +
        " " +
        safeErrorCode(response.body),
    );
  }

  return parseMerchantResponse(response.body);
}

async function proveCredentialSeparation() {
  const integrationOnMerchant =
    await postJson(
      MERCHANT_PATH,
      integrationToken,
      {
        requestId:
          "request_e2e_cross_merchant_" +
          idSuffix(),
        operation: "GET_CAPABILITIES",
        payload: {},
      },
    );

  expect(integrationOnMerchant.status).toBe(
    401,
  );
  expect(
    safeErrorCode(
      integrationOnMerchant.body,
    ),
  ).toBe("unauthorized");

  const merchantOnIntegration =
    await postJson(
      INTEGRATION_PATH,
      merchantToken,
      {},
    );

  expect(merchantOnIntegration.status).toBe(
    401,
  );
  expect(
    safeErrorCode(
      merchantOnIntegration.body,
    ),
  ).toBe("unauthorized");
}

describe.skipIf(!live)(
  "Happy Food Rescue staging E2E through Mercy adapter",
  () => {
    it(
      "proves credential separation, reservation replay and partial outcome accounting",
      async () => {
        requireHarnessConfiguration();

        const mercyConfig =
          happyFoodRescueConfig(
            process.env,
          );
        expect(mercyConfig.enabled).toBe(
          true,
        );

        await proveCredentialSeparation();

        const client =
          createHappyFoodRescueClient({
            config: mercyConfig,
          });

        const suffix = idSuffix();
        const lotId =
          "lot_e2e_mercy_" + suffix;
        const merchantRef =
          "merchant_" +
          "a".repeat(24) +
          suffix
            .replace(/[^a-f0-9]/g, "b")
            .padEnd(8, "b")
            .slice(0, 8);
        const pickupRef =
          "pickup_" +
          "b".repeat(24) +
          suffix
            .replace(/[^a-f0-9]/g, "c")
            .padEnd(8, "c")
            .slice(0, 8);
        const reservationId =
          "reservation_e2e_" + suffix;
        const offerId = "offer_" + lotId;
        const missionRef =
          "mission_e2e_" + suffix;

        const now = Date.now();
        const channelOpenAt = iso(
          now - 10 * 60_000,
        );
        const reservationCutoff = iso(
          now + 35 * 60_000,
        );
        const handoffWindowEnd = iso(
          now + 50 * 60_000,
        );
        const safetyCutoff = iso(
          now + 65 * 60_000,
        );

        await happyApi(
          "MERCHANT_CREATE_LOT",
          {
            actorRef: merchantRef,
            payload: {
              policyRef:
                "policy_ge_aj_staging_v1",
              lotId,
              merchantRef,
              pickupPointRef: pickupRef,
              initialQuantity: 8,
              safetyCutoff,
              schedules: {
                DONATION: {
                  channelOpenAt,
                  reservationCutoff,
                  handoffWindowEnd,
                },
              },
              initialChannel: "DONATION",
            },
          },
          merchantRef,
        );

        const before = await happyApi(
          "MERCHANT_GET_LOT",
          {
            actorRef: merchantRef,
            lotId,
          },
          merchantRef,
        );
        expect(
          before.data.lot.available.DONATION,
        ).toBe(8);
        expect(before.data.version).toBe(1);

        const reserveEvent =
          buildDonationReservationUpsert({
            eventId:
              "event_e2e_reserve_" + suffix,
            occurredAt: iso(now),
            region: "GE-AJ",
            correlationId:
              "corr_e2e_" + suffix,
            idempotencyKey:
              "idem_e2e_reserve_" + suffix,
            reservationRevision: 1,
            reservationId,
            offerId,
            quantity: 4,
            unit: "meal",
            expiresAt: iso(
              now + 25 * 60_000,
            ),
            mercyMissionRef: missionRef,
          });

        const reserved =
          parseIntegrationResponse(
            await client.send(reserveEvent),
          );
        expect(reserved).toMatchObject({
          accepted: true,
          effect: "DONATION_RESERVED",
        });

        const replay =
          parseIntegrationResponse(
            await client.send(reserveEvent),
          );
        expect(replay).toMatchObject({
          accepted: true,
          replayed: true,
        });

        const afterReserve = await happyApi(
          "MERCHANT_GET_LOT",
          {
            actorRef: merchantRef,
            lotId,
          },
          merchantRef,
        );
        expect(
          afterReserve.data.lot.available
            .DONATION,
        ).toBe(4);
        expect(
          afterReserve.data.version,
        ).toBe(2);
        expect(
          afterReserve.data.lot.reservations.find(
            (reservation) =>
              reservation.reservationId ===
              reservationId,
          ),
        ).toMatchObject({
          status: "ACTIVE",
          quantity: 4,
        });

        const attestedAt =
          new Date().toISOString();
        const outcome =
          buildDonationOutcomeAttestation({
            eventId:
              "event_e2e_outcome_" + suffix,
            occurredAt: attestedAt,
            region: "GE-AJ",
            correlationId:
              "corr_e2e_" + suffix,
            idempotencyKey:
              "idem_e2e_outcome_" + suffix,
            revision: 1,
            attestationId:
              "attestation_e2e_" + suffix,
            offerId,
            reservationId,
            quantityPickedUp: 3,
            quantityDelivered: 2,
            unit: "meal",
            outcome: "PARTIALLY_DELIVERED",
            evidenceRef:
              "evidence_fulfillment_" +
              "d".repeat(32),
            attestedAt,
          });

        const attested =
          parseIntegrationResponse(
            await client.send(outcome),
          );
        expect(attested).toMatchObject({
          accepted: true,
          effect:
            "DONATION_OUTCOME_ATTESTED",
        });

        const final = await happyApi(
          "MERCHANT_GET_LOT",
          {
            actorRef: merchantRef,
            lotId,
          },
          merchantRef,
        );

        expect(final.data.version).toBe(3);
        expect(
          final.data.lot.available.DONATION,
        ).toBe(5);
        expect(
          final.data.lot.accounting.donated,
        ).toBe(2);
        expect(
          final.data.lot.accounting
            .donationInCustody,
        ).toBe(1);
        expect(final.data.quantity.total).toBe(
          8,
        );
        expect(
          final.data.lot.reservations.find(
            (reservation) =>
              reservation.reservationId ===
              reservationId,
          )?.status,
        ).toBe("COMPLETED");
      },
      60_000,
    );
  },
);
