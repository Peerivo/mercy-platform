import { enumLabel, dateLocale } from "@/lib/i18n";

import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { Chat } from "@/components/chat";
import { StatusForm } from "@/app/staff/cases/action-forms";
import { OwnerRequestActions } from "./owner-actions";
import { getPublicRequestStatus } from "@/lib/request-status";
import type { ChatMessage } from "@/lib/chat-history";
import { ShareRequest } from "@/components/share-request";
import { ReportRequest } from "@/components/report-request";
import { RequestResponse } from "@/components/request-response";
import { QuickExit } from "@/components/quick-exit";

type SupportStep = {
  id: string;
  title: string;
  responsible: string;
  due_at: string | null;
  status: string;
  organization_id: string | null;
};

type HelpResponse = {
  id: string;
  message: string;
  contact_method: string;
  status: string;
  created_at: string;
};

type OwnResponse = {
  message: string;
  contact_method: string;
};

type PrivateRequestAccess = {
  id: string;
  owner_id: string;
};

export default async function Case({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, locale } = await getTranslations();

  const { id } = await params;
  const s = await serverSupabase();

  const {
    data: { user },
  } = await s.auth.getUser();

  const { data: publicRows, error } = await s.rpc("get_public_help_request", {
    case_id: id,
  });

  const r = publicRows?.[0];

  if (error || !r) {
    notFound();
  }

  let canAccessPrivate = false;
  let isCoordinator = false;
  let isOwner = false;
  let messages: ChatMessage[] = [];
  let steps: SupportStep[] = [];
  let responses: HelpResponse[] = [];
  let ownResponse: OwnResponse | null = null;

  if (user) {
    const [privateAccessResult, ownResponseResult] = await Promise.all([
      s
        .from("help_requests")
        .select("id,owner_id")
        .eq("id", id)
        .maybeSingle(),
      s
        .from("help_request_responses")
        .select("message,contact_method")
        .eq("help_request_id", id)
        .eq("responder_id", user.id)
        .maybeSingle(),
    ]);

    const privateRequest =
      privateAccessResult.data && !privateAccessResult.error
        ? (privateAccessResult.data as PrivateRequestAccess)
        : null;

    // The help_requests SELECT policy is the authorization source of truth:
    // only the owner or the active coordinator can see this row.
    canAccessPrivate = privateRequest !== null;
    isOwner = privateRequest?.owner_id === user.id;
    isCoordinator = canAccessPrivate && !isOwner;

    ownResponse =
      ownResponseResult.data && !ownResponseResult.error
        ? (ownResponseResult.data as OwnResponse)
        : null;

    if (canAccessPrivate) {
      const [messagesResult, stepsResult, responsesResult] = await Promise.all([
        s
          .from("messages")
          .select("id,body,created_at,author_id,client_nonce")
          .eq("help_request_id", id)
          .order("created_at")
          .order("id")
          .limit(100),
        s
          .from("support_steps")
          .select("id,title,responsible,due_at,status,organization_id")
          .eq("help_request_id", id)
          .order("created_at"),
        s
          .from("help_request_responses")
          .select("id,message,contact_method,status,created_at")
          .eq("help_request_id", id)
          .eq("status", "PENDING")
          .order("created_at", { ascending: false }),
      ]);

      messages = (messagesResult.data ?? []) as ChatMessage[];
      steps = (stepsResult.data ?? []) as SupportStep[];
      responses = (responsesResult.data ?? []) as HelpResponse[];
    }
  }

  const publicStatus = getPublicRequestStatus(r.status);
  const completed = r.status === "RESOLVED" || r.status === "CLOSED";

  return (
    <section className="container section">
      <div className="nav">
        <h1>{t("Просьба №")} {r.case_number}</h1>
        {isCoordinator && <a href="/staff/cases">{t("К назначенным обращениям")}</a>}
        {canAccessPrivate && <QuickExit />}
      </div>

      <div className="card">
        <p>
          <strong>{enumLabel(t, r.category)}</strong>
          {" · "}
          {r.country}
          {" · "}
          {r.city}
          {" · "}
          {enumLabel(t, r.urgency)}
        </p>

        <p>
          <strong>{t("Статус:")}</strong> {t(publicStatus)}
        </p>

        <p>{r.description}</p>

        <ShareRequest caseNumber={r.case_number} />
        <ReportRequest caseId={id} />

        {isOwner && r.status !== "CLOSED" && (
          <OwnerRequestActions caseId={id} />
        )}

        {isCoordinator && <StatusForm caseId={id} status={r.status} />}
      </div>

      {!completed && !isOwner && !isCoordinator && (
        <RequestResponse
          caseId={id}
          signedIn={Boolean(user)}
          existing={ownResponse}
        />
      )}

      {canAccessPrivate && user ? (
        <>
          {(isOwner || isCoordinator) && (
            <section className="response-list-section">
              <h2>{t("Отклики на просьбу")}</h2>
              <div className="grid">
                {responses.length ? (
                  responses.map((response) => (
                    <article className="card" key={response.id}>
                      <p>{response.message}</p>
                      <p>
                        <strong>{t("Связаться:")}</strong> {response.contact_method}
                      </p>
                      <p className="muted">
                        {new Date(response.created_at).toLocaleString(dateLocale(locale))}
                      </p>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <h3>{t("Пока нет откликов")}</h3>
                    <p>{t("Когда кто-то предложит помощь, отклик появится здесь.")}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          <h2>{t("Совместный план поддержки")}</h2>

          <div className="grid">
            {steps.length ? (
              steps.map((x) => (
                <div className="card" key={x.id}>
                  <strong>{x.title}</strong>
                  <p>
                    {x.responsible} · {enumLabel(t, x.status)}
                    {x.due_at ? ` · ${t("до")} ${x.due_at}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <div className="card">{t("Координатор пока не добавил шаги.")}</div>
            )}
          </div>

          <Chat requestId={id} initial={messages} userId={user.id} />
        </>
      ) : (
        <p>{t("Внутренний план и приватный чат доступны только автору обращения и назначенному координатору.")}</p>
      )}
    </section>
  );
}
