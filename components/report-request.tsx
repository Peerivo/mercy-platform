"use client";
import { useLocale } from "@/components/locale-provider";


import {
  useActionState,
  useRef,
} from "react";

import {
  submitRequestReport,
  type ReportActionState,
} from "@/app/cabinet/requests/[id]/report-actions";

const initialState: ReportActionState = {
  ok: false,
  message: "",
};

const TOKEN_KEY = "mercy-report-token-v1";

function getReporterToken(): string {
  try {
    const saved =
      window.localStorage.getItem(TOKEN_KEY);

    if (saved) {
      return saved;
    }

    const token = crypto.randomUUID();

    window.localStorage.setItem(
      TOKEN_KEY,
      token
    );

    return token;
  } catch {
    return crypto.randomUUID();
  }
}

export function ReportRequest({
  caseId,
}: {
  caseId: string;
}) {
  const { t } = useLocale();

  const reporterTokenRef =
    useRef<HTMLInputElement>(null);

  const [state, action, pending] =
    useActionState(
      submitRequestReport,
      initialState
    );

  if (state.ok) {
    return (
      <div className="card">
        <p role="status">
          {t(state.message)}
        </p>
      </div>
    );
  }

  return (
    <details>
      <summary>{t("Пожаловаться на просьбу")}</summary>

      <form
        action={action}
        className="grid"
        onSubmit={() => {
          if (
            reporterTokenRef.current
          ) {
            reporterTokenRef.current.value =
              getReporterToken();
          }
        }}
      >
        <input
          type="hidden"
          name="caseId"
          value={caseId}
        />

        <input
          ref={reporterTokenRef}
          type="hidden"
          name="reporterToken"
          defaultValue=""
        />

        <label>{t("Причина")}<select
            name="reason"
            required
            defaultValue=""
          >
            <option
              value=""
              disabled
            >{t("Выберите причину")}</option>

            <option value="FRAUD">{t("Возможное мошенничество")}</option>

            <option value="DANGEROUS">{t("Опасный или недопустимый контент")}</option>

            <option value="PERSONAL_DATA">{t("Опубликованы персональные данные")}</option>

            <option value="OUTDATED">{t("Просьба уже неактуальна")}</option>

            <option value="OTHER">{t("Другая причина")}</option>
          </select>
        </label>

        <label>{t("Комментарий")}<textarea
            name="details"
            maxLength={1000}
            rows={3}
            placeholder={t("Необязательно, кроме варианта «Другая причина»")}
          />
        </label>

        <button
          className="btn secondary"
          type="submit"
          disabled={pending}
        >
          {pending
            ? t("Отправляем…")
            : t("Отправить жалобу")}
        </button>

        {state.message && (
          <p role="alert">
            {t(state.message)}
          </p>
        )}
      </form>
    </details>
  );
}