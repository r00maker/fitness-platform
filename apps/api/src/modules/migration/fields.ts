/**
 * What we look for in files from old systems, and how we recognise it.
 *
 * Every system names columns differently ("Client ID", "Member ID", "Barcode"), so each of our
 * fields has a list of names it's known by. Headers are compared after lower-casing and removing
 * spaces and punctuation, so "E-mail Address" and "email_address" match. Our staff can change any
 * mapping before checking; the check never guesses silently (unmapped columns are listed).
 *
 * File kinds:
 *  - clients: one row per client (contact details, notes, opt-in, credit, visit totals)
 *  - packages: class packs with classes left (one row per pack)
 *  - memberships: recurring memberships (price, how often, next billing date)
 *  - bookings: upcoming bookings (class, date and time)
 *  - visits: past attendance (summarised per client: how many, first and last)
 */
export const KINDS = ["clients", "packages", "memberships", "bookings", "visits", "ignore"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<Kind, string> = {
  clients: "Clients",
  packages: "Class packs (classes left)",
  memberships: "Memberships (recurring)",
  bookings: "Upcoming bookings",
  visits: "Visit history",
  ignore: "Not needed",
};

/** Columns that point at a client from another file. */
const CLIENT_REF = {
  externalId: ["clientid", "memberid", "customerid", "userid", "id", "barcode", "clientbarcode", "uniqueid", "clientnumber", "membernumber", "accountid"],
  email: ["email", "emailaddress", "clientemail", "customeremail", "memberemail", "e-mail"],
  phone: ["phone", "mobile", "mobilephone", "mobilenumber", "cell", "cellphone", "phonenumber", "contactnumber", "handphone", "hp", "homephone", "telephone", "tel", "whatsapp"],
  fullName: ["name", "fullname", "clientname", "customername", "membername", "client", "customer", "member", "student", "attendee"],
  firstName: ["firstname", "givenname", "first", "forename"],
  lastName: ["lastname", "surname", "familyname", "last"],
};

export const FIELDS: Record<Exclude<Kind, "ignore">, Record<string, string[]>> = {
  clients: {
    ...CLIENT_REF,
    dateOfBirth: ["birthday", "birthdate", "dateofbirth", "dob"],
    emergencyName: ["emergencycontact", "emergencycontactname", "emergencyname"],
    emergencyPhone: ["emergencyphone", "emergencycontactphone", "emergencycontactnumber", "emergencynumber"],
    notes: ["notes", "note", "clientnotes", "comments", "comment", "alerts", "medicalnotes"],
    tags: ["tags", "tag", "labels", "groups", "clienttype", "membertype", "type"],
    marketingEmail: ["emailoptin", "optin", "marketingoptin", "subscribed", "newsletter", "acceptsmarketing", "marketingemails", "emailmarketing", "mailinglist", "sendemails", "emailsubscriber"],
    memberSince: ["firstvisit", "membersince", "clientsince", "customersince", "studentsince", "created", "createdat", "createddate", "signupdate", "joindate", "joined", "dateadded", "creationdate", "datecreated", "registrationdate"],
    waiverSignedAt: ["waiversigned", "waiverdate", "liabilitywaiver", "waiver", "waiversigneddate", "liabilityrelease"],
    creditBalance: ["accountbalance", "creditbalance", "storecredit", "credit", "balance", "walletbalance", "giftcardbalance"],
    visits: ["totalvisits", "visits", "classesattended", "attendancecount", "totalclasses", "visitcount", "checkins", "totalcheckins"],
    lastVisit: ["lastvisit", "lastvisitdate", "lastattended", "lastclass", "lastcheckin", "lastbooking"],
    status: ["status", "clientstatus", "memberstatus", "active", "accountstatus"],
  },
  packages: {
    ...CLIENT_REF,
    name: ["package", "packagename", "pass", "passname", "pack", "packname", "series", "seriesname", "pricingoption", "product", "item", "service", "credits name", "classpack"],
    remaining: ["remaining", "classesremaining", "creditsremaining", "creditsleft", "classesleft", "sessionsremaining", "visitsremaining", "remainingvisits", "remainingcredits", "remainingclasses", "remainingsessions", "balance", "left"],
    total: ["totalclasses", "credits", "sessions", "totalcredits", "totalsessions", "count", "numberofclasses", "visits", "totalvisits", "quantity"],
    purchasedAt: ["purchasedate", "purchased", "saledate", "datepurchased", "bought", "purchasedon", "orderdate", "solddate"],
    startsAt: ["activationdate", "startdate", "activedate", "activated", "start", "validfrom"],
    expiresAt: ["expiry", "expirydate", "expiration", "expirationdate", "expires", "enddate", "validuntil", "validto", "expireson"],
    pricePaid: ["price", "amount", "pricepaid", "amountpaid", "paid", "total", "saleprice", "cost"],
  },
  memberships: {
    ...CLIENT_REF,
    name: ["membership", "membershipname", "plan", "planname", "contract", "contractname", "autopay", "subscription", "subscriptionname", "pricingoption", "product"],
    price: ["price", "amount", "monthlyprice", "recurringamount", "autopayamount", "rate", "fee", "billingamount"],
    interval: ["frequency", "billingfrequency", "billingcycle", "interval", "period", "billingperiod", "renews", "paymentfrequency"],
    status: ["status", "membershipstatus", "contractstatus", "state"],
    startDate: ["startdate", "start", "activationdate", "membersince", "datestarted", "contractstart"],
    nextBillingDate: ["nextbillingdate", "nextpayment", "nextpaymentdate", "nextcharge", "nextchargedate", "renewaldate", "nextautopay", "nextbilldate", "nextrenewal", "nextinvoice"],
    endDate: ["enddate", "contractend", "commitmentend", "terminates", "terminationdate", "expirydate", "expires"],
    classesPerWeek: ["classesperweek", "weeklylimit", "visitsperweek", "sessionsperweek"],
  },
  bookings: {
    ...CLIENT_REF,
    className: ["class", "classname", "service", "session", "event", "classtype", "description", "visittype"],
    date: ["date", "classdate", "visitdate", "sessiondate", "eventdate", "day"],
    time: ["time", "starttime", "classtime", "start"],
    startsAt: ["datetime", "startdatetime", "classdatetime", "starts", "startsat", "sessionstart"],
    location: ["location", "studio", "site", "branch", "room"],
    instructor: ["instructor", "teacher", "staff", "trainer", "coach"],
  },
  visits: {
    ...CLIENT_REF,
    className: ["class", "classname", "service", "session", "event", "classtype", "description", "visittype"],
    date: ["date", "classdate", "visitdate", "sessiondate", "eventdate", "checkindate", "day"],
    startsAt: ["datetime", "startdatetime", "classdatetime", "starts", "startsat", "checkin", "checkintime"],
    status: ["status", "attendance", "visitstatus", "checkedin", "signedin"],
  },
};

/** Plain-English names for our fields, for the mapping screen and messages. */
export const FIELD_LABELS: Record<string, string> = {
  externalId: "Client ID in the old system", email: "Email", phone: "Phone", fullName: "Full name", firstName: "First name", lastName: "Last name",
  dateOfBirth: "Date of birth", emergencyName: "Emergency contact", emergencyPhone: "Emergency contact phone", notes: "Notes", tags: "Tags",
  marketingEmail: "Agreed to marketing emails", memberSince: "Client since", waiverSignedAt: "Waiver signed", creditBalance: "Credit balance",
  visits: "Total visits", lastVisit: "Last visit", status: "Status", name: "Name", remaining: "Classes left", total: "Total classes",
  purchasedAt: "Bought on", startsAt: "Starts", expiresAt: "Expires", pricePaid: "Price paid", price: "Price", interval: "How often it renews",
  startDate: "Start date", nextBillingDate: "Next billing date", endDate: "End date", classesPerWeek: "Classes a week", className: "Class",
  date: "Date", time: "Time", location: "Location", instructor: "Instructor",
};

export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which of our fields each header matches (exact name first, then the first field it starts with). */
export function mapHeaders(kind: Exclude<Kind, "ignore">, headers: string[]): Record<string, number> {
  const fields = FIELDS[kind];
  const mapping: Record<string, number> = {};
  const used = new Set<number>();
  const norm = headers.map(normHeader);
  // 1) exact matches, in each field's order of preference
  for (const [field, names] of Object.entries(fields)) {
    for (const name of names) {
      const i = norm.findIndex((h, k) => h === normHeader(name) && !used.has(k));
      if (i >= 0) { mapping[field] = i; used.add(i); break; }
    }
  }
  // 2) close matches ("Email Address (primary)", "Phone - Mobile")
  for (const [field, names] of Object.entries(fields)) {
    if (field in mapping) continue;
    const i = norm.findIndex((h, k) => !used.has(k) && h.length > 2 && names.some((n) => normHeader(n).length > 3 && (h.startsWith(normHeader(n)) || h.endsWith(normHeader(n)))));
    if (i >= 0) { mapping[field] = i; used.add(i); }
  }
  return mapping;
}

/** The header row: the first row (in the first 15) with at least 3 filled cells, most of which we recognise. */
export function findHeaderRow(rows: string[][]): number {
  let best = 0, bestScore = -1;
  const known = new Set(Object.values(FIELDS).flatMap((f) => Object.values(f).flat().map(normHeader)));
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i]!.filter((c) => c.trim());
    if (cells.length < 2) continue;
    const hits = cells.filter((c) => known.has(normHeader(c))).length;
    const score = hits * 10 + cells.length;
    if (hits >= 1 && score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

/** What kind of file it is, from its headers (and its name as a tie-breaker). */
export function detectKind(headers: string[], filename = ""): Exclude<Kind, "ignore"> {
  const h = new Set(headers.map(normHeader));
  const has = (...names: string[]) => names.some((n) => h.has(normHeader(n)) || [...h].some((x) => x.includes(normHeader(n))));
  const name = filename.toLowerCase();
  if (has("nextbillingdate", "nextpayment", "billingfrequency", "autopay", "frequency", "nextcharge", "renewaldate", "recurringamount")) return "memberships";
  if (has("remaining", "creditsleft", "classesleft", "creditsremaining", "visitsremaining")) return "packages";
  if ((has("class", "classname", "session") && has("date", "datetime", "classdate", "visitdate")) || /booking|visit|attendance|check.?in/.test(name)) {
    return /visit|attendance|history|check.?in/.test(name) || has("checkedin", "attendance", "signedin") ? "visits" : "bookings";
  }
  if (/membership|contract|autopay|subscription/.test(name)) return "memberships";
  if (/package|pass|pack|series|credit/.test(name)) return "packages";
  return "clients";
}

/** Old systems we know how studios export from (shown on the form, used for tips). */
export const SOURCE_PLATFORMS = ["Mindbody", "Momence", "Glofox", "PunchPass", "TeamUp", "Arketa", "Vibefam", "Rezerv", "Walla", "Mariana Tek", "bsport", "Spreadsheet", "Other"] as const;

/** How to get the files out of each system: the reports we ask for (shown to our staff and the studio). */
export const EXPORT_TIPS: Record<string, string[]> = {
  Mindbody: ["Reports → Mailing Lists: All clients, opt-in status All → Generate → export (client list with contact details)", "Reports → Clients → Membership → Detail view (memberships)", "Client series/packages with remaining visits (Reports → Sales, or ask Mindbody support for a full export; it may cost extra)"],
  Momence: ["Customers list → Export (contact details, memberships and credits left)", "Packages/Subscriptions → export active ones if they're separate"],
  Glofox: ["Reports → Memberships → Members → Download (needs the Admin role)", "Client list export (Clients Export permission)"],
  PunchPass: ["Customers → export customer list", "Passes report with visits remaining"],
  TeamUp: ["Customers → Customer List → Export filtered list → CSV/Excel", "Memberships report for remaining classes"],
  Other: ["Client list with emails and phone numbers", "Active class packs with classes left and expiry dates", "Active memberships with price, how often they renew and the next billing date", "Upcoming bookings (class, date and time)", "Visit history, if you want totals carried over"],
};
