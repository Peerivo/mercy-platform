import { notFound } from "next/navigation";
import { z } from "zod";
import { serverSupabase } from "@/lib/supabase/server";

type PublishedSpecialist = {
  display_name: string;
  description: string;
  country: string;
  city: string;
  travel_area: string;
  specializations: string[];
  services: string[];
  languages: string[];
  work_formats: string[];
  qualification_status: string;
  contact_details: string | null;
};

export default async function Specialist({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await serverSupabase();
  const response = await supabase.rpc("get_published_specialist", { specialist_id: id }).maybeSingle();
  const specialist = response.data as PublishedSpecialist | null;
  if (response.error || !specialist) notFound();

  return <article className="container section card">
    <h1>{specialist.display_name}</h1>
    <p>{specialist.country}, {specialist.city}. {specialist.travel_area}</p>
    <p>{specialist.description}</p>
    <h2>Специализации</h2>
    <p>{specialist.specializations.join(", ") || "Не указаны"}</p>
    <h2>Услуги</h2>
    <p>{specialist.services.join(", ") || "Не указаны"}</p>
    <p>Языки: {specialist.languages.join(", ") || "не указаны"}. Формат: {specialist.work_formats.join(", ") || "не указан"}.</p>
    <p>{specialist.qualification_status === "VERIFIED" ? "Квалификация подтверждена" : "Квалификация не подтверждена"}</p>
    {specialist.contact_details && <p>Контакты: {specialist.contact_details}</p>}
  </article>;
}
