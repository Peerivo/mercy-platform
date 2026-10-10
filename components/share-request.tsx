"use client";
import { useLocale } from "@/components/locale-provider";


import { useState } from "react";

type ShareRequestProps = {
  caseNumber: number | string;
};

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");

  document.body.removeChild(textarea);

  return copied;
}

export function ShareRequest({
  caseNumber,
}: ShareRequestProps) {
  const { t } = useLocale();

  const [message, setMessage] = useState("");

  const getShareData = () => {
    const url = window.location.href;
    const text = `${t("Просьба о помощи №")} ${caseNumber}`;

    return {
      url,
      text,
      title: t("Язык милосердия"),
    };
  };

  const copyLink = async () => {
    const { url } = getShareData();

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else if (!fallbackCopy(url)) {
        throw new Error("copy failed");
      }

      setMessage("Ссылка скопирована.");
    } catch {
      setMessage("Не удалось скопировать ссылку.");
    }
  };

  const share = async () => {
    const data = getShareData();

    if (!navigator.share) {
      await copyLink();
      return;
    }

    try {
      await navigator.share(data);
      setMessage("");
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      setMessage("Не удалось открыть меню «Поделиться».");
    }
  };

  const shareTelegram = () => {
    const { url, text } = getShareData();

    const telegramUrl =
      "https://t.me/share/url" +
      `?url=${encodeURIComponent(url)}` +
      `&text=${encodeURIComponent(text)}`;

    window.open(
      telegramUrl,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <div className="share-request">
      <p>
        <strong>{t("Помогите распространить просьбу")}</strong>
      </p>

      <div className="nav">
        <button
          className="btn"
          type="button"
          onClick={share}
        >{t("Поделиться")}</button>

        <button
          className="btn secondary"
          type="button"
          onClick={shareTelegram}
        >
          Telegram
        </button>

        <button
          className="btn secondary"
          type="button"
          onClick={copyLink}
        >{t("Копировать ссылку")}</button>
      </div>

      {message && (
        <p role="status" aria-live="polite">
          {t(message)}
        </p>
      )}
    </div>
  );
}