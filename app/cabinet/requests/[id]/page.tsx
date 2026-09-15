import { notFound } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { Chat } from "@/components/chat";
import { StatusForm } from "@/app/staff/cases/action-forms";
import { OwnerRequestActions } from "./owner-actions";
import { getPublicRequestStatus } from "@/lib/request-status";
import type { ChatMessage } from "@/lib/chat-history";
import { ShareRequest } from "@/components/share-request";
import { ReportRequest } from "@/components/report-request";

type SupportStep = {
  id: string;
  title: string;
  responsible: string;
  due_at: string | null;
  status: string;
  organization_id: string | null;
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

  // Публичные безопасные данные просьбы.
  const { data: publicRows, error } = await s.rpc(
    "get_public_help_request",
    {
      case_id: id,
    }
  );

  const r = publicRows?.[0];

  if (error || !r) {
    notFound();
  }

  let canAccessPrivate = false;
  let isCoordinator = false;
  let isOwner = false;

  let messages: ChatMessage[] = [];
  let steps: SupportStep[] = [];

  if (user) {
    const { data: allowed } = await s.rpc("can_access_case", {
      case_id: id,
      uid: user.id,
    });

    canAccessPrivate = allowed === true;

    if (canAccessPrivate) {
      const [
        messagesResult,
        stepsResult,
        coordinatorResult,
        ownershipResult,
      ] = await Promise.all([
        s
          .from("messages")
          .select(
            "id,body,created_at,author_id,client_nonce"
          )
          .eq("help_request_id", id)
          .order("created_at")
          .order("id")
          .limit(100),

        s
          .from("support_steps")
          .select(
            "id,title,responsible,due_at,status,organization_id"
          )
          .eq("help_request_id", id)
          .order("created_at"),

        s.rpc("is_active_coordinator", {
          case_id: id,
          uid: user.id,
        }),

        // Важно: отдельно определяем владельца.
        // can_access_case=true может быть и у координатора.
        s
          .from("help_requests")
          .select("id")
          .eq("id", id)
          .eq("owner_id", user.id)
          .maybeSingle(),
      ]);

      messages =
        (messagesResult.data ?? []) as ChatMessage[];

      steps =
        (stepsResult.data ?? []) as SupportStep[];

      isCoordinator =
        coordinatorResult.data === true;

      isOwner =
        ownershipResult.data !== null &&
        ownershipResult.error === null;
    }
  }

  const publicStatus = getPublicRequestStatus(
    r.status
  );

  return (
    <section className="container section">
      <div className="nav">
        <h1>Просьба № {r.case_number}</h1>

        {isCoordinator && (
          <a href="/staff/cases">
            К назначенным обращениям
          </a>
        )}
      </div>

      {/* ПУБЛИЧНАЯ ЧАСТЬ */}
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
          <strong>Статус:</strong>{" "}
          {publicStatus}
        </p>

        <p>{r.description}</p>
        
        <ShareRequest caseNumber={r.case_number} />

        <ReportRequest caseId={id} />

        {isOwner && r.status !== "CLOSED" && (
          <OwnerRequestActions caseId={id} />
        )}

        {isCoordinator && (
          <StatusForm
            caseId={id}
            status={r.status}
          />
        )}
      </div>

      {/* ПРИВАТНАЯ ЧАСТЬ */}
      {canAccessPrivate && user ? (
        <>
          <h2>Совместный план поддержки</h2>

          <div className="grid">
            {steps.length ? (
              steps.map((x) => (
                <div
                  className="card"
                  key={x.id}
                >
                  <strong>{x.title}</strong>

                  <p>
                    {x.responsible} ·{" "}
                    {x.status}
                    {x.due_at
                      ? ` · до ${x.due_at}`
                      : ""}
                  </p>
                </div>
              ))
            ) : (
              <div className="card">
                Координатор пока не добавил
                шаги.
              </div>
            )}
          </div>

          <Chat
            requestId={id}
            initial={messages}
            userId={user.id}
          />
        </>
      ) : (
        <p>
          Внутренний план и приватный чат
          доступны только автору обращения и
          назначенному координатору.
        </p>
      )}
    </section>
  );
}