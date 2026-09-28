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

type CaseAccess = "OWNER" | "CURATOR" | "VOLUNTEER";

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

  const { data: publicRows, error } = await s.rpc("get_public_help_request", {
    case_id: id,
  });

  const r = publicRows?.[0];

  if (error || !r) {
    notFound();
  }

  let accessRole: CaseAccess | null = null;
  let messages: ChatMessage[] = [];
  let steps: SupportStep[] = [];
  let responses: HelpResponse[] = [];
  let ownResponse: OwnResponse | null = null;

  if (user) {
    const [privateAccessResult, ownResponseResult, caseAccessResult] = await Promise.all([
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
      s.rpc("current_case_access", { case_id: id }),
    ]);

    const privateRequest =
      privateAccessResult.data && !privateAccessResult.error
        ? (privateAccessResult.data as PrivateRequestAccess)
        : null;

    if (!caseAccessResult.error && caseAccessResult.data) {
      accessRole = caseAccessResult.data as CaseAccess;
    } else if (privateRequest?.owner_id === user.id) {
      // Compatibility while a preview is evaluated before the new migration is
      // applied to production.
      accessRole = "OWNER";
    } else if (privateRequest) {
      accessRole = "CURATOR";
    }

    ownResponse =
      ownResponseResult.data && !ownResponseResult.error
        ? (ownResponseResult.data as OwnResponse)
        : null;

    if (accessRole) {
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
        accessRole === "OWNER" || accessRole === "CURATOR"
          ? s
              .from("help_request_responses")
              .select("id,message,contact_method,status,created_at")
              .eq("help_request_id", id)
              .eq("status", "PENDING")
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

      messages = (messagesResult.data ?? []) as ChatMessage[];
      steps = (stepsResult.data ?? []) as SupportStep[];
      responses = (responsesResult.data ?? []) as HelpResponse[];
    }
  }

  const isOwner = accessRole === "OWNER";
  const isCurator = accessRole === "CURATOR";
  const isVolunteer = accessRole === "VOLUNTEER";
  const publicStatus = getPublicRequestStatus(r.status);
  const completed = r.status === "RESOLVED" || r.status === "CLOSED";

  return (
    <section className="container section">
      <div className="nav">
        <h1>Просьба № {r.case_number}</h1>
        {isCurator && <a href="/staff/cases">К назначенным обращениям</a>}
        {accessRole && <QuickExit />}
      </div>

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

        <ShareRequest caseNumber={r.case_number} />
        <ReportRequest caseId={id} />

        {isOwner && r.status !== "CLOSED" && (
          <OwnerRequestActions caseId={id} />
        )}

        {isCurator && <StatusForm caseId={id} status={r.status} />}

        {isVolunteer && (
          <p className="muted">
            Вы открыли просьбу как назначенный волонтёр. Статус обращения и
            чужие отклики доступны только автору и куратору.
          </p>
        )}
      </div>

      {!completed && !accessRole && (
        <RequestResponse
          caseId={id}
          signedIn={Boolean(user)}
          existing={ownResponse}
        />
      )}

      {accessRole && user ? (
        <>
          {(isOwner || isCurator) && (
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
                    <p>Когда кто-то предложит помощь, отклик появится здесь.</p>
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
              <div className="card">Куратор пока не добавил шаги.</div>
            )}
          </div>

          <Chat requestId={id} initial={messages} userId={user.id} />
        </>
      ) : (
        <p>
          Внутренний план и приватный чат доступны автору обращения, назначенному
          куратору и назначенному активному волонтёру.
        </p>
      )}
    </section>
  );
}
