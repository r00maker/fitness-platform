import type { Config } from "../../config.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Emails made in the builder. */
  html?: string;
  /** Marketing emails: the one-click unsubscribe address (List-Unsubscribe), and sent on the bulk stream. */
  unsubscribeUrl?: string;
}
export interface PushMessage { tokens: string[]; title: string; body: string; data?: Record<string, unknown> }
export interface EmailProvider { send(msg: EmailMessage): Promise<void> }
export interface PushProvider { send(msg: PushMessage): Promise<void> }

/** Development: print instead of sending. */
export const consoleEmail: EmailProvider = { async send(m) { console.log(`[email] to=${m.to} subject="${m.subject}"`); } };
export const consolePush: PushProvider = { async send(m) { console.log(`[push] tokens=${m.tokens.length} title="${m.title}"`); } };

export function postmarkEmail(token: string, from: string): EmailProvider {
  return {
    async send(m) {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": token },
        body: JSON.stringify({
          From: from,
          To: m.to,
          Subject: m.subject,
          TextBody: m.text,
          ...(m.html ? { HtmlBody: m.html } : {}),
          // Marketing goes on Postmark's broadcast stream so it can't affect booking emails' delivery.
          MessageStream: m.unsubscribeUrl ? "broadcast" : "outbound",
          ...(m.unsubscribeUrl ? { Headers: [{ Name: "List-Unsubscribe", Value: `<${m.unsubscribeUrl}>` }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }] } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Postmark responded ${res.status}`);
    },
  };
}

/** Expo's push service fans out to Apple (APNs) and Google (FCM) for the React Native app. */
export const expoPush: PushProvider = {
  async send(m) {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(m.tokens.map((to) => ({ to, title: m.title, body: m.body, data: m.data, sound: "default" }))),
    });
    if (!res.ok) throw new Error(`Expo push responded ${res.status}`);
  },
};

export function providersFromConfig(config: Config): { email: EmailProvider; push: PushProvider } {
  const email =
    config.EMAIL_PROVIDER === "postmark"
      ? postmarkEmail(config.POSTMARK_TOKEN ?? (() => { throw new Error("POSTMARK_TOKEN missing"); })(), config.EMAIL_FROM)
      : consoleEmail;
  return { email, push: config.PUSH_PROVIDER === "expo" ? expoPush : consolePush };
}
