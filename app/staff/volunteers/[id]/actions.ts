"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import {
  volunteerAssignmentFinishSchema,
  volunteerAssignmentSchema,
  volunteerContactRevokeSchema,
  volunteerContactSchema,
  volunteerIncidentResolveSchema,
  volunteerIncidentSchema,
  volunteerProfileSchema,
} from "@/lib/validation";

function targetPath(targetUser: string, suffix: string) {
  return `/staff/volunteers/${encodeURIComponent(targetUser)}?${suffix}`;
}

export async function updateVolunteerProfile(formData: FormData) {
  const parsed = volunteerProfileSchema.safeParse({
    targetUser: formData.get("targetUser"),
    status: formData.get("status"),
    categories: formData.getAll("categories"),
    availableOnline: formData.get("availableOnline") === "on",
    reason: formData.get("reason"),
  });
  const target = String(formData.get("targetUser") ?? "");
  if (!parsed.success) redirect(targetPath(target, "error=profile"));

  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");

  const { error } = await s.rpc("update_volunteer_profile", {
    target_user: parsed.data.targetUser,
    new_status: parsed.data.status,
    categories: parsed.data.categories,
    online_available: parsed.data.availableOnline,
    reason_text: parsed.data.reason,
  });
  if (error) redirect(targetPath(parsed.data.targetUser, "error=profile-save"));
  revalidatePath(`/staff/volunteers/${parsed.data.targetUser}`);
  redirect(targetPath(parsed.data.targetUser, "saved=profile"));
}

export async function addVolunteerContact(formData: FormData) {
  const parsed = volunteerContactSchema.safeParse({
    targetUser: formData.get("targetUser"),
    name: formData.get("name"),
    relationship: formData.get("relationship"),
    contact: formData.get("contact"),
    linkedUser: formData.get("linkedUser") ?? "",
    consentConfirmed: formData.get("consentConfirmed") === "on",
  });
  const target = String(formData.get("targetUser") ?? "");
  if (!parsed.success) redirect(targetPath(target, "error=contact"));

  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");
  const { error } = await s.rpc("add_volunteer_contact_person", {
    target_user: parsed.data.targetUser,
    contact_name: parsed.data.name,
    relationship_text: parsed.data.relationship,
    contact_value: parsed.data.contact,
    linked_user: parsed.data.linkedUser || null,
    consent_confirmed: parsed.data.consentConfirmed,
  });
  if (error) redirect(targetPath(parsed.data.targetUser, "error=contact-save"));
  revalidatePath(`/staff/volunteers/${parsed.data.targetUser}`);
  redirect(targetPath(parsed.data.targetUser, "saved=contact"));
}

export async function revokeVolunteerContact(formData: FormData) {
  const parsed = volunteerContactRevokeSchema.safeParse({
    contactId: formData.get("contactId"),
    targetUser: formData.get("targetUser"),
    reason: formData.get("reason"),
  });
  const target = String(formData.get("targetUser") ?? "");
  if (!parsed.success) redirect(targetPath(target, "error=contact-revoke"));

  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");
  const { error } = await s.rpc("revoke_volunteer_contact_person", {
    contact_id: parsed.data.contactId,
    reason_text: parsed.data.reason,
  });
  if (error) redirect(targetPath(parsed.data.targetUser, "error=contact-revoke"));
  revalidatePath(`/staff/volunteers/${parsed.data.targetUser}`);
  redirect(targetPath(parsed.data.targetUser, "saved=contact-revoked"));
}

export async function assignVolunteer(formData: FormData) {
  const parsed = volunteerAssignmentSchema.safeParse({
    caseId: formData.get("caseId"),
    targetUser: formData.get("targetUser"),
    mode: formData.get("mode"),
    task: formData.get("task"),
  });
  const target = String(formData.get("targetUser") ?? "");
  if (!parsed.success) redirect(targetPath(target, "error=assignment"));

  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");
  const { error } = await s.rpc("assign_volunteer_to_case", {
    case_id: parsed.data.caseId,
    target_volunteer: parsed.data.targetUser,
    assignment_mode: parsed.data.mode,
    task_text: parsed.data.task,
  });
  if (error) redirect(targetPath(parsed.data.targetUser, "error=assignment-save"));
  revalidatePath(`/staff/volunteers/${parsed.data.targetUser}`);
  redirect(targetPath(parsed.data.targetUser, "saved=assignment"));
}

export async function finishVolunteerAssignment(formData: FormData) {
  const parsed = volunteerAssignmentFinishSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
    targetUser: formData.get("targetUser"),
    outcome: formData.get("outcome"),
    reason: formData.get("reason"),
  });
  const target = String(formData.get("targetUser") ?? "");
  if (!parsed.success) redirect(targetPath(target, "error=finish"));

  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");
  const { error } = await s.rpc("finish_volunteer_assignment", {
    assignment_id: parsed.data.assignmentId,
    outcome: parsed.data.outcome,
    reason_text: parsed.data.reason,
  });
  if (error) redirect(targetPath(parsed.data.targetUser, "error=finish-save"));
  revalidatePath(`/staff/volunteers/${parsed.data.targetUser}`);
  redirect(targetPath(parsed.data.targetUser, "saved=assignment-finished"));
}

export async function openVolunteerIncident(formData: FormData) {
  const parsed = volunteerIncidentSchema.safeParse({
    targetUser: formData.get("targetUser"),
    caseId: formData.get("caseId") ?? "",
    category: formData.get("category"),
    summary: formData.get("summary"),
  });
  const target = String(formData.get("targetUser") ?? "");
  if (!parsed.success) redirect(targetPath(target, "error=incident"));

  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");
  const { error } = await s.rpc("open_volunteer_incident", {
    target_volunteer: parsed.data.targetUser,
    case_id: parsed.data.caseId || null,
    incident_category: parsed.data.category,
    incident_summary: parsed.data.summary,
  });
  if (error) redirect(targetPath(parsed.data.targetUser, "error=incident-save"));
  revalidatePath(`/staff/volunteers/${parsed.data.targetUser}`);
  redirect(targetPath(parsed.data.targetUser, "saved=incident"));
}

export async function resolveVolunteerIncident(formData: FormData) {
  const parsed = volunteerIncidentResolveSchema.safeParse({
    incidentId: formData.get("incidentId"),
    targetUser: formData.get("targetUser"),
    resolution: formData.get("resolution"),
  });
  const target = String(formData.get("targetUser") ?? "");
  if (!parsed.success) redirect(targetPath(target, "error=incident-resolve"));

  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");
  const { error } = await s.rpc("resolve_volunteer_incident", {
    incident_id: parsed.data.incidentId,
    resolution_text: parsed.data.resolution,
  });
  if (error) redirect(targetPath(parsed.data.targetUser, "error=incident-resolve"));
  revalidatePath(`/staff/volunteers/${parsed.data.targetUser}`);
  redirect(targetPath(parsed.data.targetUser, "saved=incident-resolved"));
}
