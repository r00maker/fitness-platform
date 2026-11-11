/**
 * Suggests a category for a client's health note from what they type, e.g.
 * "sore left knee from running" → Injury (knee), "18 weeks pregnant" → Pregnancy.
 *
 * It's a plain keyword match that runs inside the app as the client types, so
 * their health details are never sent to an outside service to be classified.
 * The client always sees the suggestion and can pick a different category.
 */
import type { HealthCategory } from "./enums.js";

type Rule = { category: HealthCategory; pattern: RegExp };

/**
 * Checked in order; the first match wins. Life stages and surgery come first because
 * they matter most to an instructor ("pregnant with back pain" is about pregnancy),
 * then named conditions, then general injury words.
 */
const RULES: Rule[] = [
  { category: "postnatal", pattern: /\b(post[- ]?natal|post[- ]?partum|gave birth|had (a|my) baby|new (mum|mom|mother)|c[- ]?section|caesarean|cesarean|diastasis|breast ?feeding|months? post)\b/ },
  { category: "pregnancy", pattern: /\b(pregnan\w*|expecting|trimester|pre[- ]?natal|ante[- ]?natal|due (in|date)|weeks? along)\b/ },
  { category: "recent_surgery", pattern: /\b(surgery|surgical|operation|operated|post[- ]?op|keyhole|arthroscop\w*|reconstruction|replacement|stitches|recovering from an? op)\b/ },
  {
    category: "medical_condition",
    pattern:
      /\b(asthma\w*|diabet\w*|blood pressure|hypertension|heart|cardiac|epilep\w*|seizures?|arthritis|osteopor\w*|osteopen\w*|scoliosis|vertigo|dizz\w*|faint\w*|migraines?|endometriosis|pcos|hernia|hypermobil\w*|fibromyalgia|anaemi\w*|anemi\w*|thyroid|lupus|multiple sclerosis)\b/,
  },
  {
    category: "injury",
    pattern:
      /\b(injur\w*|sprain\w*|strain\w*|tear|torn|pulled|tweaked|sore\w*|pain\w*|painful|ache|aching|achy|broken|fractur\w*|dislocat\w*|tendon\w*|tendin\w*|bursitis|slipped disc|herniat\w*|bulging disc|whiplash|sciatica|plantar|rotator cuff|tennis elbow|stiff\w*|bruis\w*|niggle)\b/,
  },
];

/** Body areas, so an instructor sees "Injury · Knee" without opening the note. */
const AREAS: [string, RegExp][] = [
  ["Lower back", /\blower back\b/],
  ["Upper back", /\bupper back\b/],
  ["Neck", /\bneck\b/],
  ["Shoulder", /\bshoulders?\b|\brotator cuff\b/],
  ["Elbow", /\belbows?\b/],
  ["Wrist", /\bwrists?\b|\bcarpal tunnel\b/],
  ["Hand", /\bhands?\b|\bfingers?\b|\bthumbs?\b/],
  ["Hip", /\bhips?\b|\bpelvi\w*\b|\bglutes?\b/],
  ["Knee", /\bknees?\b|\bacl\b|\bmcl\b|\bmeniscus\b/],
  ["Hamstring", /\bhamstrings?\b/],
  ["Ankle", /\bankles?\b|\bachilles\b/],
  ["Foot", /\bfoot\b|\bfeet\b|\bplantar\b|\btoes?\b/],
  ["Back", /\bback\b|\bspine\b|\bdisc\b|\bsciatica\b/],
  ["Core", /\bcore\b|\babs\b|\babdomen\b|\bdiastasis\b/],
];

export interface HealthSuggestion {
  category: HealthCategory;
  /** e.g. "Knee", when one is mentioned. */
  area: string | null;
}

export function bodyArea(text: string): string | null {
  const t = text.toLowerCase();
  return AREAS.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** Null when nothing recognisable has been typed yet. */
export function suggestHealthCategory(text: string): HealthSuggestion | null {
  const t = text.toLowerCase();
  const area = bodyArea(t);
  const rule = RULES.find((r) => r.pattern.test(t));
  if (rule) return { category: rule.category, area };
  // Only a body part ("left knee", "lower back") – most likely an injury.
  if (area) return { category: "injury", area };
  return null;
}
