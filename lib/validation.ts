import { z } from "zod";

export const requestSchema = z.object({
  category: z.enum([
    "PREGNANCY",
    "FAMILY",
    "HOUSING",
    "FOOD_GOODS",
    "LEGAL_DOCUMENTS",
    "WORK_EDUCATION",
    "OTHER",
  ]),
  country: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(120),
  description: z.string().trim().min(20).max(5000),
  urgency: z.enum(["NORMAL", "SOON", "URGENT"]),
  can_message: z.boolean(),
  can_call: z.boolean(),
  contact_window: z.string().max(120),
  external_contact: z.string().max(200),
  consent: z.literal(true),
});

export const offerSchema = z
  .object({
    category: z.enum([
      "THINGS",
      "TRANSPORT",
      "FOOD",
      "CHILDCARE",
      "EDUCATION_WORK",
      "OTHER",
    ]),
    country: z.string().trim().min(2).max(80),
    city: z.string().trim().max(120),
    online: z.boolean(),
    description: z.string().trim().min(20).max(3000),
    contact_method: z.string().trim().min(2).max(200),
    consent: z.literal(true),
  })
  .refine((x) => x.online || x.city.length >= 2, {
    path: ["city"],
    message: "city required for offline help",
  });

export const requestResponseSchema = z.object({
  caseId: z.string().uuid(),
  message: z.string().trim().min(10).max(1500),
  contactMethod: z.string().trim().min(2).max(200),
  consent: z.literal(true),
});

export const feedbackSchema = z.object({
  message: z.string().trim().min(3).max(3000),
  replyEmail: z.union([z.literal(""), z.email().max(320)]),
  pagePath: z.string().trim().max(500),
});

export const volunteerReviewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["VERIFIED", "REJECTED"]),
  reason: z.string().trim().min(3).max(500),
});

export const staffPageSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(1);

export const assignmentSchema = z
  .object({
    caseId: z.string().uuid(),
    coordinatorId: z.string().uuid(),
    currentCoordinatorId: z.union([z.string().uuid(), z.literal("")]),
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine((value, ctx) => {
    if (
      value.currentCoordinatorId &&
      value.currentCoordinatorId === value.coordinatorId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["coordinatorId"],
        message: "already assigned",
      });
    }
  });

export const caseStatusSchema = z.object({
  caseId: z.string().uuid(),
  status: z.enum([
    "ASSIGNED",
    "IN_PROGRESS",
    "WAITING",
    "RESOLVED",
    "CLOSED",
  ]),
});

export const helpRequestReportSchema = z
  .object({
    caseId: z.string().uuid(),
    reason: z.enum([
      "FRAUD",
      "DANGEROUS",
      "PERSONAL_DATA",
      "OUTDATED",
      "OTHER",
    ]),
    details: z.string().trim().max(1000),
    reporterToken: z.string().uuid(),
  })
  .superRefine((value, ctx) => {
    if (value.reason === "OTHER" && value.details.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["details"],
        message: "details required",
      });
    }
  });

export const helpRequestReportReviewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["RESOLVED", "DISMISSED"]),
  note: z.string().trim().min(3).max(500),
});

export const publicRequestSearchSchema = z.object({
  category: z
    .enum([
      "",
      "PREGNANCY",
      "FAMILY",
      "HOUSING",
      "FOOD_GOODS",
      "LEGAL_DOCUMENTS",
      "WORK_EDUCATION",
      "OTHER",
    ])
    .default(""),
  city: z.string().trim().max(120).default(""),
  urgency: z.enum(["", "NORMAL", "SOON", "URGENT"]).default(""),
  state: z.enum(["ACTIVE", "COMPLETED", "ALL"]).default("ACTIVE"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const roleDirectorySearchSchema = z.object({
  email: z.union([z.literal(""), z.email().max(320)]).default(""),
});

export const mercyRoleChangeSchema = z.object({
  targetUser: z.string().uuid(),
  role: z.enum(["VOLUNTEER", "CURATOR", "PATRON", "ADMIN"]),
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(500),
  patronKind: z
    .enum(["", "PERSON", "SOLE_PROPRIETOR", "LEGAL_ENTITY", "GOVERNMENT"])
    .default(""),
});

export const volunteerDirectorySearchSchema = z.object({
  city: z.string().trim().max(120).default(""),
  status: z
    .enum(["", "ONBOARDING", "ACTIVE", "PAUSED", "SUSPENDED"])
    .default(""),
  category: z
    .enum(["", "THINGS", "TRANSPORT", "FOOD", "CHILDCARE", "EDUCATION_WORK", "OTHER"])
    .default(""),
  home: z.enum(["", "NOT_CLEARED", "CLEARED", "SUSPENDED"]).default(""),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const volunteerProfileSchema = z.object({
  targetUser: z.string().uuid(),
  status: z.enum(["ONBOARDING", "ACTIVE", "PAUSED", "SUSPENDED"]),
  categories: z
    .array(z.enum(["THINGS", "TRANSPORT", "FOOD", "CHILDCARE", "EDUCATION_WORK", "OTHER"]))
    .max(12),
  availableOnline: z.boolean(),
  homeClearance: z.enum(["NOT_CLEARED", "CLEARED", "SUSPENDED"]),
  supervisionRequired: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

export const volunteerContactSchema = z.object({
  targetUser: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  relationship: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(2).max(240),
  linkedUser: z.union([z.literal(""), z.string().uuid()]).default(""),
  consentConfirmed: z.literal(true),
});

export const volunteerContactRevokeSchema = z.object({
  contactId: z.string().uuid(),
  targetUser: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const requestSafetySchema = z.object({
  caseId: z.string().uuid(),
  targetUser: z.string().uuid(),
  requesterIsBeneficiary: z.boolean(),
  consentStatus: z.enum(["NOT_REQUIRED", "PENDING", "CONFIRMED", "DECLINED"]),
  allowHomeVisit: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

export const volunteerAssignmentSchema = z.object({
  caseId: z.string().uuid(),
  targetUser: z.string().uuid(),
  mode: z.enum(["REMOTE", "PUBLIC_PLACE", "HOME_PAIRED"]),
  task: z.string().trim().min(3).max(500),
  companionUser: z.union([z.literal(""), z.string().uuid()]).default(""),
});

export const volunteerAssignmentFinishSchema = z.object({
  assignmentId: z.string().uuid(),
  targetUser: z.string().uuid(),
  outcome: z.enum(["COMPLETED", "REVOKED"]),
  reason: z.string().trim().min(3).max(500),
});

export const volunteerIncidentSchema = z.object({
  targetUser: z.string().uuid(),
  caseId: z.union([z.literal(""), z.string().uuid()]).default(""),
  category: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(10).max(1000),
});

export const volunteerIncidentResolveSchema = z.object({
  incidentId: z.string().uuid(),
  targetUser: z.string().uuid(),
  resolution: z.string().trim().min(3).max(1000),
});

