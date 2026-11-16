/**
 * Reading files from old systems into rows of text, whatever shape they arrive in:
 *
 *  - CSV and TSV, in UTF-8 (with or without a byte-order mark), UTF-16 (what Excel's "Unicode
 *    text" saves) or Windows-1252 (older Excel), with the delimiter worked out (comma, semicolon,
 *    tab or pipe).
 *  - Excel .xlsx, every sheet that has data. Dates come out as yyyy-mm-dd, numbers as written.
 *  - "XLS" downloads that are really HTML tables (several systems export reports this way).
 *  - Old binary .xls files are recognised and refused with a clear way forward (open and
 *    re-save as .xlsx or .csv), rather than guessed at.
 *
 * Nothing is dropped here: every row comes back, and the header row is found later.
 */
import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { badRequest } from "../../lib/errors.js";

export interface ParsedSheet {
  format: "csv" | "tsv" | "xlsx" | "html";
  sheet: string | null;
  rows: string[][];
}

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isOle = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

/** Text from bytes: BOMs first, then strict UTF-8, then Windows-1252 (never fails). */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** The delimiter that splits the first lines most consistently. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",", bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const mode = counts.sort((a, b) => counts.filter((c) => c === b).length - counts.filter((c) => c === a).length)[0] ?? 0;
    const score = mode > 0 ? counts.filter((c) => c === mode).length * 10 + mode : -1;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

const clean = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/ /g, " ").trim());
const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // Excel dates are stored without a zone; keep the time only when there is one.
    const t = v.getUTCHours() || v.getUTCMinutes() ? ` ${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}` : "";
    return ymd(v) + t;
  }
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text; // hyperlinks
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formulas: their value
    if ("error" in v) return "";
  }
  return clean(v);
}

function htmlRows(html: string): string[][] {
  const decode = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const rows: string[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) rows.push((tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((c) => decode(c)));
  return rows;
}

/** Every sheet in a file, as rows of text. */
export async function readFile(filename: string, buf: Buffer): Promise<ParsedSheet[]> {
  if (!buf.length) throw badRequest("empty_file", `${filename} is empty.`);
  if (isOle(buf)) throw badRequest("old_excel", `${filename} is an old Excel file (.xls). Open it in Excel, Numbers or Google Sheets and save it as .xlsx or .csv, then upload that.`);
  if (isZip(buf)) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw badRequest("bad_excel", `${filename} couldn't be opened as an Excel file. Try saving it again as .xlsx or .csv.`);
    }
    const sheets: ParsedSheet[] = [];
    wb.eachSheet((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: true }, (row) => {
        const vals = row.values as ExcelJS.CellValue[]; // 1-based
        rows.push(Array.from({ length: Math.max(0, vals.length - 1) }, (_, i) => cellText(vals[i + 1] ?? null)));
      });
      if (rows.some((r) => r.some((c) => c))) sheets.push({ format: "xlsx", sheet: ws.name, rows });
    });
    if (!sheets.length) throw badRequest("empty_file", `${filename} has no data in any sheet.`);
    return sheets;
  }
  const text = decodeText(buf);
  if (/^\s*<(!doctype html|html|table)/i.test(text) || /<table[\s>]/i.test(text.slice(0, 2000))) {
    const rows = htmlRows(text);
    if (!rows.length) throw badRequest("bad_file", `${filename} looks like a web page with no table in it.`);
    return [{ format: "html", sheet: null, rows }];
  }
  const delimiter = sniffDelimiter(text);
  let rows: string[][];
  try {
    rows = parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: false, bom: true }) as string[][];
  } catch (e) {
    throw badRequest("bad_csv", `${filename} couldn't be read as a spreadsheet file: ${(e as Error).message.split("\n")[0]}`);
  }
  return [{ format: delimiter === "\t" ? "tsv" : "csv", sheet: null, rows: rows.map((r) => r.map(clean)) }];
}
