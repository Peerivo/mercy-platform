import type { Metadata } from "next";
import { adminSupabase } from "@/lib/supabase/admin";
import { hashRequestModerationToken } from "@/lib/request-moderation";
import { moderateRequest } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  referrer: "no-referrer",
};

type ModerationRow = {
  id: string;
  case_number: number;
  category: string;
  country: string;
  city: string;
  description: string;
  urgency: string;
  request_status: string;
  review_status: string;
  created_at: string;
  expires_at: string;
};

function queryValue(
  value: string | string[] | undefined
): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Result({ done }: { done: string }) {
  const approved = done === "approved";
  const rejected = done === "rejected";

  return (
    <section className="container section">
      <div className="card">
        <h1>
          {approved
            ? "Просьба опубликована"
            : rejected
              ? "Просьба отклонена"
              : "Ссылка недействительна"}
        </h1>
        <p className="muted">
          {approved
            ? "Решение сохранено. Просьба теперь доступна в публичном списке."
            : rejected
              ? "Решение сохранено. Просьба останется непубличной."
              : "Токен отсутствует, истёк или уже был использован."}
        </p>
      </div>
    </section>
  );
}

export default async function RequestModerationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const done = queryValue(query.done);

  if (done) {
    return <Result done={done} />;
  }

  const token = queryValue(query.token);
  const intent = queryValue(query.intent);
  const hasError = queryValue(query.error) === "decision";

  if (token.length < 32 || token.length > 256) {
    return <Result done="invalid" />;
  }

  const admin = adminSupabase();
  const { data, error } = await admin.rpc("get_help_request_for_moderation", {
    token_hash_text: hashRequestModerationToken(token),
  });

  const request = (data?.[0] ?? null) as ModerationRow | null;

  if (error || !request || request.id !== id) {
    return <Result done="invalid" />;
  }

  return (
    <section className="container section">
      <div className="page-heading">
        <div>
          <p className="request-section-kicker">Согласование просьбы</p>
          <h1>Просьба № {request.case_number}</h1>
          <p className="muted">
            Ссылка действует 48 часов и только для этой просьбы.
          </p>
        </div>
      </div>

      {hasError && (
        <p role="alert">
          Решение не удалось сохранить. Проверьте ссылку и попробуйте ещё раз.
        </p>
      )}

      <article className="card">
        <p>
          <strong>{request.category}</strong>
          {" · "}
          {request.country}
          {" · "}
          {request.city}
          {" · "}
          {request.urgency}
        </p>
        <p>{request.description}</p>
        <p className="muted">
          Создана{" "}
          {new Date(request.created_at).toLocaleString("ru-RU", {
            timeZone: "Asia/Tbilisi",
          })}
        </p>
        <p className="muted">
          Токен действителен до{" "}
          {new Date(request.expires_at).toLocaleString("ru-RU", {
            timeZone: "Asia/Tbilisi",
          })}
        </p>

        {intent === "reject" && (
          <div className="notice">
            Ссылка из письма открыта с намерением отклонить просьбу. Решение
            всё равно применяется только после нажатия кнопки ниже.
          </div>
        )}

        <form action={moderateRequest} className="form-actions">
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="token" value={token} />
          <button className="btn" name="decision" value="APPROVE">
            Утвердить и опубликовать
          </button>
          <button className="btn secondary" name="decision" value="REJECT">
            Отклонить
          </button>
        </form>
      </article>
    </section>
  );
}
