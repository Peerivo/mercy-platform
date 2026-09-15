import {z} from "zod";
export const requestSchema=z.object({category:z.enum(["PREGNANCY","FAMILY","HOUSING","FOOD_GOODS","LEGAL_DOCUMENTS","WORK_EDUCATION","OTHER"]),country:z.string().trim().min(2).max(80),city:z.string().trim().min(2).max(120),description:z.string().trim().min(20).max(5000),urgency:z.enum(["NORMAL","SOON","URGENT"]),can_message:z.boolean(),can_call:z.boolean(),contact_window:z.string().max(120),external_contact:z.string().max(200),consent:z.literal(true)});
export const offerSchema=z.object({category:z.enum(["THINGS","TRANSPORT","FOOD","CHILDCARE","EDUCATION_WORK","OTHER"]),country:z.string().trim().min(2).max(80),city:z.string().trim().max(120),online:z.boolean(),description:z.string().trim().min(20).max(3000),contact_method:z.string().trim().min(2).max(200),consent:z.literal(true)}).refine(x=>x.online||x.city.length>=2,{path:["city"],message:"city required for offline help"});
export const volunteerReviewSchema=z.object({id:z.string().uuid(),status:z.enum(["VERIFIED","REJECTED"]),reason:z.string().trim().min(3).max(500)});
const list=(max:number,itemMax:number)=>z.string().max(max*(itemMax+1)).transform(v=>v.split(",").map(x=>x.trim()).filter(Boolean)).pipe(z.array(z.string().min(1).max(itemMax)).max(max));
export const specialistProfileSchema=z.object({display_name:z.string().trim().min(2).max(120),description:z.string().trim().max(3000),country:z.string().trim().min(2).max(80),city:z.string().trim().min(2).max(120),travel_area:z.string().trim().max(300),specializations:list(20,120),services:list(30,120),languages:list(20,80),work_formats:list(10,80),contact_details:z.string().trim().max(500),show_contacts:z.boolean()});
export const specialistSearchSchema=z.object({q:z.string().trim().max(100).default(""),country:z.string().trim().max(80).default(""),city:z.string().trim().max(120).default(""),language:z.string().trim().max(80).default(""),verified:z.enum(["on",""]).default(""),page:z.coerce.number().int().min(1).max(1000).default(1)});
export const specialistReviewSchema=z.object({id:z.string().uuid(),publication:z.enum(["PENDING","PUBLISHED","REJECTED","BLOCKED"]),qualification:z.enum(["UNVERIFIED","PENDING","VERIFIED","REJECTED"]),reason:z.string().trim().min(3).max(500)});
export const staffPageSchema=z.coerce.number().int().min(1).max(1000).default(1);
export const assignmentSchema=z.object({caseId:z.string().uuid(),coordinatorId:z.string().uuid(),currentCoordinatorId:z.union([z.string().uuid(),z.literal("")]),reason:z.string().trim().min(3).max(500)}).superRefine((value,ctx)=>{if(value.currentCoordinatorId&&value.currentCoordinatorId===value.coordinatorId)ctx.addIssue({code:"custom",path:["coordinatorId"],message:"already assigned"})});
export const caseStatusSchema=z.object({caseId:z.string().uuid(),status:z.enum(["ASSIGNED","IN_PROGRESS","WAITING","RESOLVED","CLOSED"])});
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
    if (
      value.reason === "OTHER" &&
      value.details.length < 3
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["details"],
        message: "details required",
      });
    }
  });

export const helpRequestReportReviewSchema = z.object({
  id: z.string().uuid(),

  status: z.enum([
    "RESOLVED",
    "DISMISSED",
  ]),

  note: z
    .string()
    .trim()
    .min(3)
    .max(500),
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

  city: z
    .string()
    .trim()
    .max(120)
    .default(""),

  urgency: z
    .enum([
      "",
      "NORMAL",
      "SOON",
      "URGENT",
    ])
    .default(""),

  state: z
    .enum([
      "ACTIVE",
      "COMPLETED",
      "ALL",
    ])
    .default("ACTIVE"),

  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(1),
});