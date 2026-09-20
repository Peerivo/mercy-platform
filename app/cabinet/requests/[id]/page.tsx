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

type RequestView = {
  id: string;
  case_number: number;
  category: string;
  country: string;
  city: string;
  description: string;
  urgency: string;
  status: string;
  created_at: string;
  review_status?: string;
};

type PrivateRequestAccess = RequestView & {
  owner_id: string;
  review_status: string;
};

export default async function Case({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const s = await serverSupabase();

  const {
    data: { user },
  } = await s.auth.getUser();

  const publicResult = await s.rpc("get_public_help_request", {
    case_id: id,
  });

  let r = (publicResult.data?.[0] ?? null) as RequestView | null;
  const published = Boolean(r);

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
        .select(
          "id,owner_id,case_number,category,country,city,description,urgency,status,review_status,created_at"
        )
        .eq("id", id)
        .maybeSingle(),
      published
        ? s
            .from("help_request_responses")
            .select("message,contact_method")
            .eq("help_request_id", id)
            .eq("responder_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const privateRequest =
      privateAccessResult.data && !privateAccessResult.error
        ? (privateAccessResult.data as PrivateRequestAccess)
        : null;

    // The help_requests SELECT policy remains the private authorization source:
    // only the owner or the active coordinator can read the base row.
    canAccessPrivate = privateRequest !== null;
    isOwner = privateRequest?.owner_id === user.id;
    isCoordinator = canAccessPrivate && !isOwner;

    if (!r && privateRequest) {
      r = privateRequest;
    }

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

  if (!r) {
    notFound();
  }

  const publicStatus = getPublicRequestStatus(r.status);
  const completed = r.status === "RESOLVED" || r.status === "CLOSED";
  const reviewStatus = r.review_status ?? (published ? "VERIFIED" : "PENDING");

  return (
    <section className="container section">
      <div className="nav">
        <h1>Просьба № {r.case_number}</h1>
        {isCoordinator && <a href="/staff/cases">К назначенным обращениям</a>}
      </div>

      {isOwner && reviewStatus === "PENDING" && (
        <div className="notice">
          Просьба отправлена на проверку и пока не видна в публичном списке.
          После одобрения она будет опубликована автоматически.
        </div>
      )}

      {isOwner && reviewStatus === "REJECTED" && (
        <p role="alert">
          Просьба отклонена при проверке и не опубликована.
        </p>
      )}

      <div className="card">
        <p>
          <strong>{r.category}</strong>
          {" · "}
          {r.country}
          {" · "}
          {r.city}
          {" · "}
          {r.urgency}
        </p>

        <p>
          <strong>Статус:</strong> {publicStatus}
        </p>

        <p>{r.description}</p>

        {published && <ShareRequest caseNumber={r.case_number} />}
        {published && <ReportRequest caseId={id} />}

        {isOwner && r.status !== "CLOSED" && (
          <OwnerRequestActions caseId={id} />
        )}

        {isCoordinator && <StatusForm caseId={id} status={r.status} />}
      </div>

      {published && !completed && !isOwner && !isCoordinator && (
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
              <h2>Отклики на просьбу</h2>
              <div className="grid">
                {responses.length ? (
                  responses.map((response) => (
                    <article className="card" key={response.id}>
                      <p>{response.message}</p>
                      <p>
                        <strong>Связаться:</strong> {response.contact_method}
                      </p>
                      <p className="muted">
                        {new Date(response.created_at).toLocaleString("ru-RU")}
                      </p>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <h3>Пока нет откликов</h3>
                    <p>
                      {published
                        ? "Когда кто-то предложит помощь, отклик появится здесь."
                        : "Отклики станут доступны после публикации просьбы."}
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          <h2>Совместный план поддержки</h2>

          <div className="grid">
            {steps.length ? (
              steps.map((x) => (
                <div className="card" key={x.id}>
                  <strong>{x.title}</strong>
                  <p>
                    {x.responsible} · {x.status}
                    {x.due_at ? ` · до ${x.due_at}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <div className="card">Координатор пока не добавил шаги.</div>
            )}
          </div>

          <Chat requestId={id} initial={messages} userId={user.id} />
        </>
      ) : (
        <p>
          Внутренний план и приватный чат доступны только автору обращения и назначенному координатору.
        </p>
      )}
    </section>
  );
}
