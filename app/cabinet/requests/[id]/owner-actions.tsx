"use client";

import { useActionState } from "react";
import {
  closeOwnRequest,
  type OwnerRequestActionState,
} from "./actions";

const initialState: OwnerRequestActionState = {
  ok: false,
  message: "",
};

export function OwnerRequestActions({
  caseId,
}: {
  caseId: string;
}) {
  const [state, action, pending] = useActionState(
    closeOwnRequest,
    initialState
  );

  return (
    <form action={action}>
      <input type="hidden" name="caseId" value={caseId} />

      <button className="btn" type="submit" disabled={pending}>
        {pending
          ? "Завершаем…"
          : "Помощь получена — завершить просьбу"}
      </button>

      {state.message && (
        <p role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
    </form>
  );
}