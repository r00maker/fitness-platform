/**
 * Ready-made emails and journeys, so a studio starts from something good instead of a blank page.
 * Wording is warm and plain; studios edit everything.
 */
import type { EmailDesign, JourneyDefinition } from "@studio/shared";
import { emailTheme } from "@studio/shared";

const theme = emailTheme.parse({});
const page = (app: string, path: string) => `${app.replace(/\/$/, "")}/${path}`;

export function starterEmails(appUrl: string): Record<string, { name: string; purpose: "marketing" | "service"; design: EmailDesign }> {
  return {
    welcome: {
      name: "Welcome to the studio",
      purpose: "service",
      design: {
        subject: "Welcome to {{studio_name}}, {{first_name}}",
        preheader: "Everything you need for your first class.",
        theme,
        blocks: [
          { type: "heading", text: "Welcome, {{first_name}}!", level: 1, align: "left" },
          { type: "text", text: "We're so glad you've joined {{studio_name}}. Here's how to get started:\n\n**1.** Pick a class that suits you.\n**2.** Arrive 10 minutes early for your first one.\n**3.** Bring water and grip socks.", align: "left" },
          { type: "button", label: "Book your first class", url: page(appUrl, "schedule"), align: "left", style: "filled" },
          { type: "text", text: "Questions? Just reply to this email.", align: "left" },
        ],
      },
    },
    intro_offer: {
      name: "Your intro offer is waiting",
      purpose: "marketing",
      design: {
        subject: "{{first_name}}, your intro offer is waiting",
        preheader: "The easiest way to try us out.",
        theme,
        blocks: [
          { type: "heading", text: "Try us out for less", level: 1, align: "left" },
          { type: "text", text: "Hi {{first_name}}, our intro offer is the best-value way to find the classes you love. It's only for new members, so don't miss it.", align: "left" },
          { type: "button", label: "See the intro offer", url: page(appUrl, "packages"), align: "left", style: "filled" },
        ],
      },
    },
    miss_you: {
      name: "We miss you",
      purpose: "marketing",
      design: {
        subject: "We miss you, {{first_name}}",
        preheader: "Your spot on the mat is waiting.",
        theme,
        blocks: [
          { type: "heading", text: "It's been a while!", level: 1, align: "left" },
          { type: "text", text: "Hi {{first_name}}, we haven't seen you in a little while and wanted to say hi. New classes are on the schedule every week. Come back whenever you're ready.", align: "left" },
          { type: "button", label: "See this week's classes", url: page(appUrl, "schedule"), align: "left", style: "filled" },
        ],
      },
    },
    milestone: {
      name: "Milestone: congratulations",
      purpose: "marketing",
      design: {
        subject: "{{classes_attended}} classes, {{first_name}}! 🎉",
        preheader: "That's a big milestone.",
        theme,
        blocks: [
          { type: "heading", text: "{{classes_attended}} classes. Amazing!", level: 1, align: "center" },
          { type: "text", text: "Thank you for showing up for yourself, {{first_name}}. We've added a little thank-you to your account.", align: "center" },
          { type: "button", label: "Book your next class", url: page(appUrl, "schedule"), align: "center", style: "filled" },
        ],
      },
    },
    last_class: {
      name: "Last class used",
      purpose: "service",
      design: {
        subject: "You've used your last class",
        preheader: "Top up to keep your routine going.",
        theme,
        blocks: [
          { type: "heading", text: "Time to top up", level: 1, align: "left" },
          { type: "text", text: "Hi {{first_name}}, you've just booked the last class on your package. Grab a new one so you can keep booking.", align: "left" },
          { type: "button", label: "See packages", url: page(appUrl, "packages"), align: "left", style: "filled" },
        ],
      },
    },
  };
}

/** Journeys built from the starter emails (the key names map to emails created alongside). */
export const RECIPES: Record<string, { name: string; description: string; emails: string[]; build: (emailIds: Record<string, string>) => JourneyDefinition }> = {
  intro_funnel: {
    name: "New member: intro offer follow-up",
    description: "Welcome new members, then nudge anyone who hasn't bought a package after 3 days. If they still haven't after a week, the team is asked to call them.",
    emails: ["welcome", "intro_offer"],
    build: (e) => ({
      trigger: { type: "account_created" },
      steps: [
        { id: "welcome", type: "send_email", emailId: e.welcome! },
        {
          id: "bought",
          type: "wait_for",
          event: "package_bought",
          within: { value: 3, unit: "days" },
          yes: [],
          no: [
            { id: "offer", type: "send_email", emailId: e.intro_offer! },
            { id: "bought2", type: "wait_for", event: "package_bought", within: { value: 4, unit: "days" }, yes: [], no: [{ id: "call", type: "notify_staff", message: "This new member hasn't bought a package a week after joining. A friendly call could help." }] },
          ],
        },
      ],
    }),
  },
  win_back: {
    name: "Win back lapsed clients",
    description: "When someone hasn't come for 30 days (and hasn't booked ahead), say hi. If they haven't booked a week later, send a one-time 20% discount.",
    emails: ["miss_you"],
    build: (e) => ({
      trigger: { type: "inactive", days: 30 },
      steps: [
        { id: "hello", type: "send_email", emailId: e.miss_you! },
        {
          id: "booked",
          type: "wait_for",
          event: "class_booked",
          within: { value: 7, unit: "days" },
          yes: [],
          no: [
            { id: "discount", type: "give_reward", reward: { type: "discount", percent: 20, validDays: 14 } },
            { id: "nudge", type: "send_push", title: "20% off, just for you", body: "We've added a one-time 20% discount to your account. Use it within 14 days." },
          ],
        },
      ],
    }),
  },
  milestone_50: {
    name: "50th class celebration",
    description: "Congratulate clients on their 50th class and give them a free class.",
    emails: ["milestone"],
    build: (e) => ({
      trigger: { type: "attendance_milestone", count: 50 },
      steps: [
        { id: "gift", type: "give_reward", reward: { type: "free_classes", classes: 1, validDays: 60 } },
        { id: "congrats", type: "send_email", emailId: e.milestone! },
      ],
    }),
  },
  last_class: {
    name: "Last class used",
    description: "When a client books the last class on a credit pack, remind them to top up.",
    emails: ["last_class"],
    build: (e) => ({ trigger: { type: "package_used_up" }, steps: [{ id: "topup", type: "send_email", emailId: e.last_class! }] }),
  },
};
