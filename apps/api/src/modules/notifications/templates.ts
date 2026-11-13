/**
 * Wording for every email and push message, in plain English.
 * Kept in one place so the studio's tone is consistent and easy to edit.
 */
export interface Rendered {
  subject: string;
  body: string;
  pushTitle: string;
  pushBody: string;
}

type D = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const when = (d: D) => `${s(d.className)} on ${s(d.displayDate ?? d.localDate)} at ${s(d.localTime)}`;

export const TEMPLATES: Record<string, (d: D) => Rendered> = {
  "session.cancelled": (d) => ({
    subject: `Cancelled: ${when(d)}`,
    body: `${when(d)} at ${s(d.locationName)} has been cancelled.${d.reason ? ` Reason: ${s(d.reason)}.` : ""}${d.refundNote ? ` ${s(d.refundNote)}` : ""}`,
    pushTitle: "Class cancelled",
    pushBody: `${when(d)} has been cancelled.`,
  }),
  "session.rescheduled": (d) => ({
    subject: `Time change: ${s(d.className)}`,
    body: `${s(d.className)} has moved from ${s(d.oldLocalDate)} ${s(d.oldLocalTime)} to ${s(d.localDate)} ${s(d.localTime)}. Your booking has been kept. If the new time doesn't work, you can cancel without a fee.`,
    pushTitle: "Class time changed",
    pushBody: `${s(d.className)} now starts ${s(d.displayDate ?? d.localDate)} at ${s(d.localTime)}.`,
  }),
  "instructor.assigned": (d) => ({
    subject: `You're teaching ${when(d)}`,
    body: `You've been added as the instructor for ${when(d)} at ${s(d.locationName)}.`,
    pushTitle: "New class assigned",
    pushBody: `You're teaching ${when(d)}.`,
  }),
  "instructor.removed": (d) => ({
    subject: `You're no longer teaching ${when(d)}`,
    body: `You've been taken off ${when(d)} at ${s(d.locationName)}. No action is needed.`,
    pushTitle: "Class removed from your schedule",
    pushBody: `You're no longer teaching ${when(d)}.`,
  }),
  "instructor.changed_for_client": (d) => ({
    subject: `New instructor for ${s(d.className)}`,
    body: `${when(d)} will now be taught by ${s(d.instructorName)}. Your booking is unchanged.`,
    pushTitle: "Instructor change",
    pushBody: `${s(d.instructorName)} is now teaching ${when(d)}.`,
  }),
  "booking.cancelled": (d) => ({
    subject: `Booking cancelled: ${when(d)}`,
    body: `Your booking for ${when(d)} has been cancelled.${d.refundNote ? ` ${s(d.refundNote)}` : ""}`,
    pushTitle: "Booking cancelled",
    pushBody: `Your booking for ${when(d)} was cancelled.`,
  }),
  "booking.moved": (d) => ({
    subject: `Booking moved to ${when(d)}`,
    body: `Your booking has been moved from ${s(d.oldClassName)} on ${s(d.oldLocalDate)} at ${s(d.oldLocalTime)} to ${when(d)}.`,
    pushTitle: "Booking moved",
    pushBody: `You're now booked into ${when(d)}.`,
  }),
  "booking.refunded": (d) => ({
    subject: `Refund for ${s(d.className)}`,
    body: `${s(d.refundNote)} Reason: ${s(d.reason)}.`,
    pushTitle: "Refund issued",
    pushBody: s(d.refundNote),
  }),
  "waitlist.enrolled": (d) => ({
    subject: `You're in! ${when(d)}`,
    body: `A spot opened up and you've been booked into ${when(d)} from the waitlist. Can't make it? Cancel in the app to free the spot.`,
    pushTitle: "You're off the waitlist 🎉",
    pushBody: `You're booked into ${when(d)}.`,
  }),
  "waitlist.offered": (d) => ({
    subject: `A spot is held for you: ${when(d)}`,
    body: `A spot opened up in ${when(d)}. We're holding it for you until ${s(d.holdUntilLocal)}. Open the app to confirm, or it will go to the next person.`,
    pushTitle: "Spot available – confirm now",
    pushBody: `${when(d)}: confirm by ${s(d.holdUntilLocal)}.`,
  }),
  "waitlist.offer_lapsed": (d) => ({
    subject: `Held spot released: ${s(d.className)}`,
    body: `We held a spot in ${when(d)} but it wasn't confirmed in time, so it went to the next person.`,
    pushTitle: "Held spot released",
    pushBody: `The spot in ${when(d)} has gone to the next person.`,
  }),
  "waitlist.expired": (d) => ({
    subject: `Waitlist ended: ${s(d.className)}`,
    body: `A spot didn't open up in ${when(d)} before your cut-off, so you've been taken off the waitlist. You won't be charged.`,
    pushTitle: "Waitlist ended",
    pushBody: `No spot opened in ${when(d)}.`,
  }),
  "waitlist.closed": (d) => ({
    subject: `Waitlist closed: ${s(d.className)}`,
    body: `The studio has closed the waitlist for ${when(d)}, so you're no longer waiting for a spot. You won't be charged.`,
    pushTitle: "Waitlist closed",
    pushBody: `The waitlist for ${when(d)} has closed.`,
  }),
  "booking.confirmed": (d) => ({
    subject: `You're booked: ${when(d)}`,
    body: `The studio has booked you into ${when(d)} at ${s(d.locationName)}.${d.paymentNote ? ` ${s(d.paymentNote)}` : ""} See you there!`,
    pushTitle: "You're booked in",
    pushBody: `${when(d)}.`,
  }),
  "package.added": (d) => ({
    subject: `Your ${s(d.packageName)} is ready`,
    body: `${s(d.packageName)} has been added to your account. ${s(d.terms)}. You'll find it under My packages.`,
    pushTitle: "Package added",
    pushBody: `${s(d.packageName)} is ready to use.`,
  }),
  "package.shared": (d) => ({
    subject: `${s(d.ownerName)} shared a package with you`,
    body: `${s(d.ownerName)} has shared ${s(d.packageName)} with you, so you can book classes with it.${d.allocated ? " They'll choose how many of the classes are yours." : ""} You'll find it under My packages.`,
    pushTitle: "Package shared with you",
    pushBody: `${s(d.ownerName)} shared ${s(d.packageName)} with you.`,
  }),
  "extension.requested": (d) => ({
    subject: `Extension request: ${s(d.clientName)}`,
    body: `${s(d.clientName)} has asked for ${s(d.days)} more days on their ${s(d.packageName)}. Reason: ${s(d.reason)}. Open the app to approve or decline.`,
    pushTitle: "Extension request",
    pushBody: `${s(d.clientName)} asked for ${s(d.days)} more days.`,
  }),
  "extension.approved": (d) => ({
    subject: `Your ${s(d.packageName)} has been extended`,
    body: `Good news: your ${s(d.packageName)} now lasts until ${s(d.validUntil)}.${d.fee ? ` An extension fee of ${s(d.fee)} has been added to your account.` : ""}${d.note ? ` Note from the studio: ${s(d.note)}` : ""}`,
    pushTitle: "Extension approved",
    pushBody: `Your ${s(d.packageName)} now lasts until ${s(d.validUntil)}.`,
  }),
  "extension.declined": (d) => ({
    subject: `About your extension request`,
    body: `The studio wasn't able to extend your ${s(d.packageName)} this time. ${s(d.note)}`,
    pushTitle: "Extension request",
    pushBody: `The studio replied about your ${s(d.packageName)}.`,
  }),
  "package.renewed": (d) => ({
    subject: `Your ${s(d.packageName)} has renewed`,
    body: `Your ${s(d.packageName)} has renewed and runs until ${s(d.validUntil)}.${d.classes != null ? ` You have ${s(d.classes)} classes${d.carried ? ` (including ${s(d.carried)} carried over)` : ""}.` : ""}`,
    pushTitle: "Membership renewed",
    pushBody: `${s(d.packageName)} runs until ${s(d.validUntil)}.`,
  }),
  "package.updated": (d) => ({
    subject: `Changes to your ${s(d.packageName)}`,
    body: `The studio has updated your ${s(d.packageName)}: ${s(d.changes)}. See My packages for the details.`,
    pushTitle: "Package updated",
    pushBody: `Your ${s(d.packageName)} has changed. Tap to see what's new.`,
  }),
  "referral.welcome": (d) => ({
    subject: `A welcome gift from ${s(d.referrerName)}'s referral`,
    body: `Thanks for joining with ${s(d.referrerName)}'s referral code. You've got ${s(d.reward)}. Enjoy your first classes!`,
    pushTitle: "Welcome gift added",
    pushBody: `You've got ${s(d.reward)}.`,
  }),
  "referral.rewarded": (d) => ({
    subject: "You've earned a referral reward",
    body: `${s(d.friendName)} qualified, so you've got ${s(d.reward)}. Thanks for spreading the word!`,
    pushTitle: "Referral reward earned",
    pushBody: `${s(d.friendName)} qualified: you've got ${s(d.reward)}.`,
  }),
  "reward.given": (d) => ({
    subject: "A little something from us",
    body: `You've got ${s(d.reward)}.`,
    pushTitle: "Reward added",
    pushBody: `You've got ${s(d.reward)}.`,
  }),
  "journey.staff": (d) => ({
    subject: `Follow up: ${s(d.clientName)}`,
    body: `${s(d.message)}\n\nClient: ${s(d.clientName)}\nFrom the journey “${s(d.journeyName)}”.`,
    pushTitle: `Follow up: ${s(d.clientName)}`,
    pushBody: s(d.message).slice(0, 120),
  }),
  "gift_card.received": (d) => ({
    subject: `${s(d.fromName)} sent you a ${s(d.amount)} gift card`,
    body: `${s(d.fromName)} sent you a ${s(d.amount)} gift card for ${s(d.studioName)}.${d.message ? `\n\n“${s(d.message)}”\n\n` : " "}It's been added to your studio credit and can be used until ${s(d.validUntil)}.`,
    pushTitle: "You've received a gift card",
    pushBody: `${s(d.fromName)} sent you ${s(d.amount)} to spend at ${s(d.studioName)}.`,
  }),
  "gift_card.ready": (d) => ({
    subject: `Your ${s(d.amount)} gift card is ready to give`,
    body: `Your gift card is in the Gift cards tab. Give it to someone by ${s(d.giveBy)}; after that it's added to your own studio credit.`,
    pushTitle: "Gift card ready to give",
    pushBody: `Give it by ${s(d.giveBy)}.`,
  }),
  "gift_card.delivered": (d) => ({
    subject: `Your gift card was sent to ${s(d.recipientName)}`,
    body: `${s(d.recipientName)} has your ${s(d.amount)} gift card. It's valid until ${s(d.validUntil)}.`,
    pushTitle: "Gift card sent",
    pushBody: `${s(d.recipientName)} has your ${s(d.amount)} gift card.`,
  }),
  "gift_card.kept": (d) => ({
    subject: `Your ${s(d.amount)} gift card is now your studio credit`,
    body: `${d.auto ? `Your gift card wasn't given by ${s(d.giveBy)}, so` : "As you asked,"} it's been added to your own studio credit. Use it by ${s(d.validUntil)}.`,
    pushTitle: "Gift card added to your credit",
    pushBody: `${s(d.amount)} added. Use it by ${s(d.validUntil)}.`,
  }),
  "loyalty.redeemed": (d) => ({
    subject: `Reward redeemed: ${s(d.rewardName)}`,
    body: `You used ${s(d.points)} for ${s(d.rewardName)}. ${s(d.message)}`,
    pushTitle: "Reward redeemed",
    pushBody: s(d.message).slice(0, 140),
  }),
  "loyalty.to_hand_over": (d) => ({
    subject: `Reward to hand over: ${s(d.rewardName)}`,
    body: `A client redeemed ${s(d.rewardName)}. They'll show code ${s(d.code)} at the desk. Mark it given under Marketing → Loyalty once they have it.`,
    pushTitle: "Reward to hand over",
    pushBody: `${s(d.rewardName)} · code ${s(d.code)}`,
  }),
  "loyalty.cancelled": (d) => ({
    subject: `${s(d.rewardName)} was cancelled`,
    body: `The studio cancelled your ${s(d.rewardName)} reward, and your ${s(d.points)} have been returned.`,
    pushTitle: "Reward cancelled",
    pushBody: `${s(d.points)} returned to you.`,
  }),
  "loyalty.expiring": (d) => ({
    subject: `Your ${s(d.plural)} expire on ${s(d.date)}`,
    body: `${s(d.points)} will expire on ${s(d.date)}.${d.inactivity ? " Come to a class before then and they'll stay." : " Use them for a reward before then."}`,
    pushTitle: `${s(d.plural)} expiring soon`,
    pushBody: `${s(d.points)} expire on ${s(d.date)}.`,
  }),
  "package.stopped": (d) => ({
    subject: `Membership stopped: ${s(d.clientName)}`,
    body: `${s(d.clientName)} has stopped their ${s(d.packageName)}. It ends on ${s(d.endsOn)}.${d.fee ? ` An early cancellation fee of ${s(d.fee)} has been added.` : ""}${d.reason ? ` Reason: ${s(d.reason)}` : ""}`,
    pushTitle: "Membership stopped",
    pushBody: `${s(d.clientName)} stopped ${s(d.packageName)}.`,
  }),
  "fee.applied": (d) => ({
    subject: `${d.feeType === "no_show" ? "No-show" : "Late-cancellation"} fee: ${s(d.className)}`,
    body: `A ${d.feeType === "no_show" ? "no-show" : "late-cancellation"} fee of ${s(d.feeText)} has been added to your account for ${when(d)}, in line with the studio's policy. If you think this is a mistake, please contact the studio.`,
    pushTitle: d.feeType === "no_show" ? "No-show fee added" : "Late-cancellation fee added",
    pushBody: `${s(d.feeText)} for ${when(d)}.`,
  }),
  "sub.requested": (d) => ({
    subject: `Cover needed: ${when(d)}`,
    body: `${s(d.requesterName)} is looking for someone to cover ${when(d)} at ${s(d.locationName)}.${d.reason ? ` Note: ${s(d.reason)}.` : ""} Open the app to accept.`,
    pushTitle: "Can you cover a class?",
    pushBody: `${when(d)} needs an instructor.`,
  }),
  "sub.request_made": (d) => ({
    subject: `Cover requested: ${when(d)}`,
    body: `${s(d.requesterName)} has asked for ${when(d)} at ${s(d.locationName)} to be covered.${d.reason ? ` Note: ${s(d.reason)}.` : ""} It's gone to the class's teaching list. Open the app to choose who covers or assign someone directly.`,
    pushTitle: "Cover requested",
    pushBody: `${s(d.requesterName)} needs cover for ${when(d)}.`,
  }),
  "sub.awaiting_approval": (d) => ({
    subject: `Cover offered: ${when(d)}`,
    body: `${s(d.instructorName)} has offered to cover ${when(d)}. Open the app to approve.`,
    pushTitle: "Approve a cover",
    pushBody: `${s(d.instructorName)} can cover ${when(d)}.`,
  }),
  "sub.filled": (d) => ({
    subject: `Cover confirmed: ${when(d)}`,
    body: `${s(d.instructorName)} is now covering ${when(d)}.`,
    pushTitle: "Cover confirmed",
    pushBody: `${s(d.instructorName)} is covering ${when(d)}.`,
  }),
  "sub.no_longer_needed": (d) => ({
    subject: `Cover no longer needed: ${s(d.className)}`,
    body: `Thanks for checking – ${when(d)} no longer needs cover.`,
    pushTitle: "Cover no longer needed",
    pushBody: `${when(d)} is sorted. Thanks!`,
  }),
};

export function render(template: string, data: D): Rendered {
  const fn = TEMPLATES[template];
  if (!fn) throw new Error(`Unknown notification template: ${template}`);
  return fn(data);
}
