export const HEADERS = [
  "АДРЕС",
  "ИМЯ",
  "ТЕЛЕФОН",
  "СИТУАЦИЯ",
  "О ЧЕМ ДОГОВОРИЛИСЬ",
  "СТОИМОСТЬ",
  "ДАТА КОНТАКТА",
  "СТАТУС",
  "СЛЕДУЮЩИЙ КОНТАКТ",
  "ПРИОРИТЕТ",
  "ССЫЛКА НА ОБЪЕКТ",
  "ИСТОРИЯ",
  "ID",
  "LAT",
  "LNG"
];

const normalize = value => String(value ?? "")
  .trim()
  .toUpperCase()
  .replace(/Ё/g, "Е")
  .replace(/\s+/g, " ");

export function validateHeaders(values) {
  if (!values?.length) return { ok: false, missing: [...HEADERS], orderMismatch: false };
  const actual = values[0].map(normalize);
  const expected = HEADERS.map(normalize);
  const missing = HEADERS.filter(header => !actual.includes(normalize(header)));
  const orderMismatch = expected.some((header, index) => actual[index] !== header);
  return { ok: missing.length === 0 && !orderMismatch, missing, orderMismatch };
}

function indexMap(headers) {
  const normalized = headers.map(normalize);
  return Object.fromEntries(HEADERS.map(header => [header, normalized.indexOf(normalize(header))]));
}

function get(row, indexes, name) {
  const idx = indexes[name];
  if (idx == null || idx < 0) return "";
  return row[idx] ?? "";
}

function parseMoney(value) {
  const cleaned = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseCoordinate(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateToInput(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function dateToSheet(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth() + 1).padStart(2,"0")}.${d.getFullYear()}`;
}

export function dateHuman(date) {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function moneyHuman(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value);
}

export function parseSheet(values) {
  if (!values?.length) return [];
  const indexes = indexMap(values[0]);
  return values.slice(1).map((row, idx) => ({
    rowNumber: idx + 2,
    address: String(get(row,indexes,"АДРЕС") || "").trim(),
    name: String(get(row,indexes,"ИМЯ") || "").trim(),
    phone: String(get(row,indexes,"ТЕЛЕФОН") || "").trim(),
    situation: String(get(row,indexes,"СИТУАЦИЯ") || "").trim(),
    agreement: String(get(row,indexes,"О ЧЕМ ДОГОВОРИЛИСЬ") || "").trim(),
    price: parseMoney(get(row,indexes,"СТОИМОСТЬ")),
    lastContact: parseDate(get(row,indexes,"ДАТА КОНТАКТА")),
    status: normalize(get(row,indexes,"СТАТУС")),
    nextContact: parseDate(get(row,indexes,"СЛЕДУЮЩИЙ КОНТАКТ")),
    priority: normalize(get(row,indexes,"ПРИОРИТЕТ")),
    url: String(get(row,indexes,"ССЫЛКА НА ОБЪЕКТ") || "").trim(),
    history: String(get(row,indexes,"ИСТОРИЯ") || "").trim(),
    id: String(get(row,indexes,"ID") || "").trim(),
    lat: parseCoordinate(get(row,indexes,"LAT")),
    lng: parseCoordinate(get(row,indexes,"LNG"))
  })).filter(item => item.address || item.name || item.phone);
}

export function toRowValues(object) {
  return [
    object.address || "",
    object.name || "",
    object.phone || "",
    object.situation || "",
    object.agreement || "",
    Number.isFinite(object.price) ? object.price : "",
    dateToSheet(object.lastContact),
    object.status || "НОВЫЙ",
    dateToSheet(object.nextContact),
    object.priority || "ОБЫЧНЫЙ",
    object.url || "",
    object.history || "",
    object.id || "",
    Number.isFinite(object.lat) ? object.lat : "",
    Number.isFinite(object.lng) ? object.lng : ""
  ];
}

export function normalizeSearch(value) {
  return String(value ?? "").toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ").trim();
}

export function matchesSearch(item, query) {
  const q = normalizeSearch(query);
  if (!q) return true;
  const haystack = normalizeSearch([item.address,item.name,item.phone,item.situation,item.agreement,item.status,item.priority].join(" "));
  if (haystack.includes(q)) return true;
  const digits = q.replace(/\D/g,"");
  return digits.length >= 4 && String(item.phone || "").replace(/\D/g,"").includes(digits);
}

export function makeHistoryEntry({ note, previousStatus, nextStatus, nextContact }) {
  const lines = [];
  const stamp = new Intl.DateTimeFormat("ru-RU", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" }).format(new Date());
  lines.push(stamp);
  if (note) lines.push(note.trim());
  if (previousStatus && nextStatus && previousStatus !== nextStatus) lines.push(`Статус: ${previousStatus} → ${nextStatus}`);
  if (nextContact) lines.push(`Следующий контакт: ${dateToSheet(nextContact)}`);
  return lines.join("\n");
}

export function appendHistory(existing, entry) {
  const old = String(existing || "").trim();
  return old ? `${entry}\n────────────\n${old}` : entry;
}
