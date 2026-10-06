export type AssistantStatus =
  "ready" | "unconfigured" | "allowance-exhausted" | "disabled" | (string & {});

export type AssistantAllowance = {
  remaining: number;
  limit: number;
  resetsAt?: string;
};

export type AssistantCitation = {
  id: string;
  label: string;
  titleId?: string;
  url?: string;
  excerpt?: string;
};

export type AssistantAction = {
  id: string;
  label: string;
  summary: string;
  status: "pending" | "confirmed" | "rejected" | (string & {});
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  citations?: AssistantCitation[];
  actions?: AssistantAction[];
  fallback?: boolean;
};

export type AssistantState = {
  status: AssistantStatus;
  cloudConsent?: boolean;
  allowance?: AssistantAllowance | null;
  messages: AssistantMessage[];
};

export type AssistantRequest = {
  request(path: string, body?: unknown, method?: string): Promise<unknown>;
};

export function createAssistantClient(requester: AssistantRequest) {
  return {
    readState(): Promise<AssistantState> {
      return requester
        .request("/assistant/state")
        .then((state) => state as AssistantState);
    },
    async sendMessage(text: string, requestId: string): Promise<unknown> {
      if (!text.trim()) throw new Error("An assistant message is required.");
      if (!requestId.trim())
        throw new Error("An assistant request ID is required.");
      return await requester.request("/assistant/messages", {
        text,
        requestId,
      });
    },
    confirmAction(actionId: string): Promise<unknown> {
      return requester.request(
        `/assistant/actions/${encodeURIComponent(actionId)}/confirm`,
        undefined,
        "POST",
      );
    },
    rejectAction(actionId: string): Promise<unknown> {
      return requester.request(
        `/assistant/actions/${encodeURIComponent(actionId)}/reject`,
        undefined,
        "POST",
      );
    },
    resetConversation(): Promise<unknown> {
      return requester.request("/assistant/reset", {}, "POST");
    },
  };
}
