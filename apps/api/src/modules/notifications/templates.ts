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
  "membership.payment_failed": (d) => ({
    subject: `Payment didn't go through for ${s(d.packageName)}`,
    body: `We couldn't take ${s(d.amount)} for your ${s(d.packageName)}${d.reason ? ` (${s(d.reason)})` : ""}. Your membership is on hold, so you can't book with it for now. We'll try your card again on ${s(d.nextTry)}, or you can update your card or pay at the studio. If it isn't paid by ${s(d.holdUntil)}, the membership will end.`,
    pushTitle: "Payment didn't go through",
    pushBody: `Your ${s(d.packageName)} is on hold. Update your card by ${s(d.holdUntil)} to keep it.`,
  }),
  "membership.payment_failed_staff": (d) => ({
    subject: `Membership payment failed: ${s(d.packageName)}`,
    body: `A renewal payment of ${s(d.amount)} for ${s(d.packageName)} failed${d.reason ? ` (${s(d.reason)})` : ""}. The membership is on hold until it's paid. The card will be tried again on ${s(d.nextTry)}; if it isn't paid by ${s(d.holdUntil)}, the membership ends.`,
    pushTitle: "Membership payment failed",
    pushBody: `${s(d.packageName)}: on hold until it's paid.`,
  }),
  "membership.payment_recovered": (d) => ({
    subject: `Thanks, ${s(d.packageName)} is active again`,
    body: `Your payment went through, so your ${s(d.packageName)} is active again and you can book as normal.`,
    pushTitle: "Membership active again",
    pushBody: `Your ${s(d.packageName)} is back on. Happy booking!`,
  }),
  "membership.forfeited": (d) => ({
    subject: `Your ${s(d.packageName)} has ended`,
    body: `We tried your card three times without success, so your ${s(d.packageName)} has ended.${d.cancelledClasses ? ` ${s(d.cancelledClasses)} upcoming ${d.cancelledClasses === 1 ? "class was" : "classes were"} cancelled.` : ""}${d.fee ? ` An early termination fee of ${s(d.fee)} applies, as the membership ended before its minimum term.` : ""} To come back, you can buy a new membership any time.`,
    pushTitle: "Membership ended",
    pushBody: `Your ${s(d.packageName)} ended after the payment failed.`,
  }),
  "membership.forfeited_staff": (d) => ({
    subject: `Membership ended after failed payments: ${s(d.packageName)}`,
    body: `The card was tried three times without success, so ${s(d.packageName)} has ended.${d.cancelledClasses ? ` ${s(d.cancelledClasses)} upcoming ${d.cancelledClasses === 1 ? "booking was" : "bookings were"} cancelled.` : ""}${d.fee ? ` An early termination fee of ${s(d.fee)} has been added.` : ""}`,
    pushTitle: "Membership ended",
    pushBody: `${s(d.packageName)} ended after 3 failed payments.`,
  }),
  "sale.refunded": (d) => ({
    subject: `Refund: ${s(d.amount)}`,
    body: d.toCredit ? `We've refunded ${s(d.amount)} for ${s(d.number)} as studio credit. You'll see it at checkout next time.` : `We've refunded ${s(d.amount)} for ${s(d.number)}. Depending on your bank, it can take a few days to appear.`,
    pushTitle: "Refund on its way",
    pushBody: d.toCredit ? `${s(d.amount)} added to your studio credit.` : `${s(d.amount)} refunded for ${s(d.number)}.`,
  }),
  /** Reminder agents: push to the staff app only (the agent's name is the title). */
  "agent.message": (d) => ({
    subject: s(d.agentName),
    body: s(d.body),
    pushTitle: s(d.agentName),
    pushBody: s(d.body),
  }),
  /** The monthly AI credits (assistant and writers) are nearly used, or used up. */
  "assistant.usage": (d) => ({
    subject: d.full ? "Your AI credits for this month are used up" : `You've used ${s(d.percent)}% of this month's AI credits`,
    body: d.full
      ? `Your studio has used all ${s(d.allowance)} AI credits included this month (the assistant and the writers). They're topped up on ${s(d.resetsOn)}, or you can buy more under Agents → Usage.`
      : `Your studio has used ${s(d.used)} of the ${s(d.allowance)} AI credits included this month. If you need more before ${s(d.resetsOn)}, you can buy a top-up under Agents → Usage.`,
    pushTitle: d.full ? "AI credits used up" : "AI credits running low",
    pushBody: d.full ? `All ${s(d.allowance)} AI credits for this month are used. Top up under Agents → Usage.` : `${s(d.used)} of ${s(d.allowance)} AI credits used this month.`,
  }),
  "staff.invite": (d) => ({
    subject: `You've been added to ${s(d.studioName)}`,
    body: `Hi ${s(d.firstName)}, ${s(d.invitedBy)} has added you to ${s(d.studioName)} as ${s(d.roleLabel)}. To sign in, set your password here: ${s(d.link)} The link works for 7 days. After that, ask them to send a new one. Your sign-in email is ${s(d.email)}.`,
    pushTitle: "Welcome",
    pushBody: `You've been added to ${s(d.studioName)}.`,
  }),
  "session.auto_cancelled": (d) => ({
    subject: `Auto-cancelled: ${when(d)}`,
    body: `${when(d)} had ${d.booked} of the ${d.needed} bookings it needed at the cut-off, so it was cancelled automatically. Everyone booked has been told and given their class back.`,
    pushTitle: "Class auto-cancelled",
    pushBody: `${when(d)}: ${d.booked} of ${d.needed} booked, so it was cancelled.`,
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
  "lead.new": (d) => ({
    subject: `New lead: ${s(d.name)}`,
    body: `${s(d.name)} asked about classes through ${s(d.source)}${d.campaign ? ` (${s(d.campaign)})` : ""}. ${d.contact ? `Reach them on ${s(d.contact)}. ` : ""}They've been sent your welcome email if you've set one up. See Marketing → Ads & leads.`,
    pushTitle: "New lead",
    pushBody: `${s(d.name)} asked about classes through ${s(d.source)}.`,
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
