"use client";

import { useActionState, useEffect, useRef } from "react";

import { sendMessage, type SendMessageState } from "../actions";

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const initialState: SendMessageState = { message: null, error: false };
  const [state, action, pending] = useActionState(sendMessage, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.message && !state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="border-t border-[#e1e2ea] p-4">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex items-end gap-2">
        <label htmlFor="message-body" className="sr-only">Message</label>
        <textarea
          id="message-body"
          name="body"
          required
          maxLength={2000}
          rows={2}
          disabled={pending}
          placeholder="Write a message…"
          className="min-h-12 flex-1 resize-none rounded-lg border border-[#c4c5d5] bg-white px-4 py-3 outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
        />
        <button type="submit" disabled={pending} className="min-h-12 rounded-lg bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] disabled:cursor-wait disabled:opacity-60">
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {state.message && (
        <p role={state.error ? "alert" : "status"} className={`mt-2 text-sm ${state.error ? "text-red-700" : "text-emerald-700"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
