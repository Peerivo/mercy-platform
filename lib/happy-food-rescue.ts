const CONTRACT_VERSION = "1.0.0";
const EVENT_PATH =
  "/v1/integrations/mercy/food-rescue/events";

const FORBIDDEN_KEYS = new Set([
  "beneficiaryName",
  "beneficiaryContactDetails",
  "homeAddress",
  "sensitiveEligibilityReason",
  "caseNotes",
  "volunteerPrivateContactDetails",
  "personIdentifier",
  "personId",
  "caseIdentifier",
  "caseId",
  "email",
  "phone",
]);

export const HAPPY_FOOD_RESCUE_EVENT = {
  DEMAND_SIGNAL:
    "mercy.food.demand_signal.published",
  RESERVATION_UPSERTED:
    "mercy.food.donation_reservation.upserted",
  RESERVATION_RELEASED:
    "mercy.food.donation_reservation.released",
  MISSION_DISPOSITION:
    "mercy.food.rescue_mission.disposition",
  OUTCOME_ATTESTED:
    "mercy.food.donation_outcome.attested",
} as const;

type EventType =
  (typeof HAPPY_FOOD_RESCUE_EVENT)[keyof typeof HAPPY_FOOD_RESCUE_EVENT];

export type HappyFoodRescueEnvelope = {
  eventId: string;
  eventType: EventType;
  contractVersion: "1.0.0";
  occurredAt: string;
  sourceSystem: "MERCY";
  region: string;
  correlationId: string;
  idempotencyKey: string;
  revision: number;
  payload: Record<string, unknown>;
};

export type HappyFoodRescueConfig =
  | {
      enabled: false;
      baseUrl: null;
      token: null;
    }
  | {
      enabled: true;
      baseUrl: URL;
      token: string;
    };

function bounded(
  value: unknown,
  field: string,
  min = 1,
  max = 128,
): string {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max
  ) {
    throw new TypeError(
      `${field} must be a bounded non-empty string`,
    );
  }
  return value;
}

function opaque(value: unknown, field: string): string {
  const token = bounded(value, field, 8, 128);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(token)
  ) {
    throw new TypeError(
      `${field} must be a bounded opaque reference`,
    );
  }
  return token;
}

function positiveRevision(
  value: unknown,
  field: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1
  ) {
    throw new TypeError(
      `${field} must be a positive safe integer`,
    );
  }
  return value as number;
}

function timestamp(
  value: unknown,
  field: string,
): string {
  const text = bounded(value, field, 10, 64);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(
      `${field} must be an ISO-8601 timestamp`,
    );
  }
  return text;
}

function plainObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(
      `${field} must be a plain object`,
    );
  }
  return value as Record<string, unknown>;
}

function rejectPrivateFields(
  value: unknown,
  path = "payload",
): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      rejectPrivateFields(
        entry,
        `${path}[${index}]`,
      ),
    );
    return;
  }

  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(
        `${path} contains forbidden privacy field: ${key}`,
      );
    }
    rejectPrivateFields(child, `${path}.${key}`);
  }
}

function envelope(input: {
  eventId: string;
  eventType: EventType;
  occurredAt: string;
  region: string;
  correlationId: string;
  idempotencyKey: string;
  revision: number;
  payload: Record<string, unknown>;
}): HappyFoodRescueEnvelope {
  const payload = plainObject(
    input.payload,
    "payload",
  );
  rejectPrivateFields(payload);

  return Object.freeze({
    eventId: opaque(input.eventId, "eventId"),
    eventType: input.eventType,
    contractVersion: CONTRACT_VERSION,
    occurredAt: timestamp(
      input.occurredAt,
      "occurredAt",
    ),
    sourceSystem: "MERCY",
    region: bounded(input.region, "region", 2, 16),
    correlationId: opaque(
      input.correlationId,
      "correlationId",
    ),
    idempotencyKey: opaque(
      input.idempotencyKey,
      "idempotencyKey",
    ),
    revision: positiveRevision(
      input.revision,
      "revision",
    ),
    payload: Object.freeze({ ...payload }),
  }) as HappyFoodRescueEnvelope;
}

export function happyFoodRescueConfig(
  env: NodeJS.ProcessEnv = process.env,
): HappyFoodRescueConfig {
  const rawEnabled =
    env.HAPPY_FOOD_RESCUE_ENABLED ?? "false";
  if (
    rawEnabled !== "true" &&
    rawEnabled !== "false"
  ) {
    throw new TypeError(
      "HAPPY_FOOD_RESCUE_ENABLED must be true or false",
    );
  }

  if (rawEnabled === "false") {
    return Object.freeze({
      enabled: false,
      baseUrl: null,
      token: null,
    });
  }

  const rawUrl = bounded(
    env.HAPPY_FOOD_RESCUE_URL,
    "HAPPY_FOOD_RESCUE_URL",
  );
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new TypeError(
      "HAPPY_FOOD_RESCUE_URL must use https",
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(
      "HAPPY_FOOD_RESCUE_URL must not contain credentials, query or fragment",
    );
  }

  const token = bounded(
    env.HAPPY_FOOD_RESCUE_TOKEN,
    "HAPPY_FOOD_RESCUE_TOKEN",
    32,
    512,
  );

  return Object.freeze({
    enabled: true,
    baseUrl: url,
    token,
  });
}

type FetchLike = typeof fetch;

export function createHappyFoodRescueClient({
  config,
  fetchImpl = fetch,
}: {
  config: HappyFoodRescueConfig;
  fetchImpl?: FetchLike;
}) {
  if (!config.enabled) {
    return Object.freeze({
      enabled: false as const,
      async send(): Promise<never> {
        throw new Error(
          "Happy Food Rescue integration is disabled",
        );
      },
      buildReservationUpsert:
        buildDonationReservationUpsert,
      buildReservationRelease:
        buildDonationReservationRelease,
      buildOutcomeAttestation:
        buildDonationOutcomeAttestation,
      buildDemandSignal,
      buildMissionDisposition,
    });
  }

  const endpoint = new URL(
    EVENT_PATH,
    config.baseUrl,
  );

  return Object.freeze({
    enabled: true as const,
    buildReservationUpsert:
      buildDonationReservationUpsert,
    buildReservationRelease:
      buildDonationReservationRelease,
    buildOutcomeAttestation:
      buildDonationOutcomeAttestation,
    buildDemandSignal,
    buildMissionDisposition,

    async send(
      event: HappyFoodRescueEnvelope,
    ): Promise<Record<string, unknown>> {
      rejectPrivateFields(event.payload);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization:
            "Bearer " + config.token,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(event),
        cache: "no-store",
      });

      const body = await response
        .json()
        .catch(() => null);

      if (!response.ok) {
        const safeCode =
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "upstream_rejected";
        throw new Error(
          `Happy Food Rescue rejected Mercy event: ${safeCode} (${response.status})`,
        );
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        throw new Error(
          "Happy Food Rescue returned an invalid response",
        );
      }
      return body as Record<string, unknown>;
    },
  });
}

export function buildDonationReservationUpsert(input: {
  eventId: string;
  occurredAt: string;
  region: string;
  correlationId: string;
  idempotencyKey: string;
  reservationRevision: number;
  reservationId: string;
  offerId: string;
  quantity: number;
  unit: string;
  expiresAt: string;
  mercyMissionRef: string;
}): HappyFoodRescueEnvelope {
  if (
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0
  ) {
    throw new TypeError(
      "quantity must be positive and finite",
    );
  }

  return envelope({
    eventId: input.eventId,
    eventType:
      HAPPY_FOOD_RESCUE_EVENT.RESERVATION_UPSERTED,
    occurredAt: input.occurredAt,
    region: input.region,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    revision: input.reservationRevision,
    payload: {
      reservationId: opaque(
        input.reservationId,
        "reservationId",
      ),
      offerId: opaque(input.offerId, "offerId"),
      quantity: input.quantity,
      unit: bounded(input.unit, "unit", 1, 32),
      expiresAt: timestamp(
        input.expiresAt,
        "expiresAt",
      ),
      mercyMissionRef: opaque(
        input.mercyMissionRef,
        "mercyMissionRef",
      ),
      reservationRevision: positiveRevision(
        input.reservationRevision,
        "reservationRevision",
      ),
    },
  });
}

export function buildDonationReservationRelease(input: {
  eventId: string;
  occurredAt: string;
  region: string;
  correlationId: string;
  idempotencyKey: string;
  reservationRevision: number;
  reservationId: string;
  offerId: string;
  releasedQuantity: number;
  unit: string;
  reasonCode: string;
}): HappyFoodRescueEnvelope {
  if (
    !Number.isFinite(input.releasedQuantity) ||
    input.releasedQuantity <= 0
  ) {
    throw new TypeError(
      "releasedQuantity must be positive and finite",
    );
  }

  return envelope({
    eventId: input.eventId,
    eventType:
      HAPPY_FOOD_RESCUE_EVENT.RESERVATION_RELEASED,
    occurredAt: input.occurredAt,
    region: input.region,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    revision: input.reservationRevision,
    payload: {
      reservationId: opaque(
        input.reservationId,
        "reservationId",
      ),
      offerId: opaque(input.offerId, "offerId"),
      releasedQuantity: input.releasedQuantity,
      unit: bounded(input.unit, "unit", 1, 32),
      reasonCode: bounded(
        input.reasonCode,
        "reasonCode",
        1,
        64,
      ),
      reservationRevision: positiveRevision(
        input.reservationRevision,
        "reservationRevision",
      ),
    },
  });
}

export function buildDonationOutcomeAttestation(input: {
  eventId: string;
  occurredAt: string;
  region: string;
  correlationId: string;
  idempotencyKey: string;
  revision: number;
  attestationId: string;
  offerId: string;
  reservationId: string;
  quantityPickedUp: number;
  quantityDelivered: number;
  unit: string;
  outcome:
    | "DELIVERED"
    | "PARTIALLY_DELIVERED"
    | "PICKED_UP_NOT_DELIVERED"
    | "FAILED";
  evidenceRef: string;
  attestedAt: string;
}): HappyFoodRescueEnvelope {
  if (
    !Number.isFinite(input.quantityPickedUp) ||
    input.quantityPickedUp < 0 ||
    !Number.isFinite(input.quantityDelivered) ||
    input.quantityDelivered < 0 ||
    input.quantityDelivered >
      input.quantityPickedUp
  ) {
    throw new TypeError(
      "donation outcome quantities are invalid",
    );
  }

  return envelope({
    eventId: input.eventId,
    eventType:
      HAPPY_FOOD_RESCUE_EVENT.OUTCOME_ATTESTED,
    occurredAt: input.occurredAt,
    region: input.region,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    revision: input.revision,
    payload: {
      attestationId: opaque(
        input.attestationId,
        "attestationId",
      ),
      offerId: opaque(input.offerId, "offerId"),
      reservationId: opaque(
        input.reservationId,
        "reservationId",
      ),
      quantityPickedUp: input.quantityPickedUp,
      quantityDelivered: input.quantityDelivered,
      unit: bounded(input.unit, "unit", 1, 32),
      outcome: input.outcome,
      evidenceRef: opaque(
        input.evidenceRef,
        "evidenceRef",
      ),
      attestedAt: timestamp(
        input.attestedAt,
        "attestedAt",
      ),
    },
  });
}

export function buildDemandSignal(input: {
  eventId: string;
  occurredAt: string;
  region: string;
  correlationId: string;
  idempotencyKey: string;
  signalRevision: number;
  signalId: string;
  timeWindow: {
    startsAt: string;
    endsAt: string;
  };
  foodCategories: string[];
  demandBand: string;
}): HappyFoodRescueEnvelope {
  timestamp(
    input.timeWindow.startsAt,
    "timeWindow.startsAt",
  );
  timestamp(
    input.timeWindow.endsAt,
    "timeWindow.endsAt",
  );
  if (
    !Array.isArray(input.foodCategories) ||
    input.foodCategories.length === 0
  ) {
    throw new TypeError(
      "foodCategories must be a non-empty array",
    );
  }

  return envelope({
    eventId: input.eventId,
    eventType:
      HAPPY_FOOD_RESCUE_EVENT.DEMAND_SIGNAL,
    occurredAt: input.occurredAt,
    region: input.region,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    revision: input.signalRevision,
    payload: {
      signalId: opaque(
        input.signalId,
        "signalId",
      ),
      region: input.region,
      timeWindow: {
        startsAt: input.timeWindow.startsAt,
        endsAt: input.timeWindow.endsAt,
      },
      foodCategories:
        input.foodCategories.map((category) =>
          bounded(
            category,
            "foodCategory",
            1,
            64,
          ),
        ),
      demandBand: bounded(
        input.demandBand,
        "demandBand",
        1,
        64,
      ),
      signalRevision: positiveRevision(
        input.signalRevision,
        "signalRevision",
      ),
    },
  });
}

export function buildMissionDisposition(input: {
  eventId: string;
  occurredAt: string;
  region: string;
  correlationId: string;
  idempotencyKey: string;
  missionRevision: number;
  missionRequestId: string;
  offerId: string;
  status: "ACCEPTED" | "DECLINED" | "EXHAUSTED";
  reasonCode: string;
}): HappyFoodRescueEnvelope {
  return envelope({
    eventId: input.eventId,
    eventType:
      HAPPY_FOOD_RESCUE_EVENT.MISSION_DISPOSITION,
    occurredAt: input.occurredAt,
    region: input.region,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    revision: input.missionRevision,
    payload: {
      missionRequestId: opaque(
        input.missionRequestId,
        "missionRequestId",
      ),
      offerId: opaque(input.offerId, "offerId"),
      status: input.status,
      reasonCode: bounded(
        input.reasonCode,
        "reasonCode",
        1,
        64,
      ),
      missionRevision: positiveRevision(
        input.missionRevision,
        "missionRevision",
      ),
    },
  });
}
