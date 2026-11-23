// Datumshilfen: Alle Daten sind ISO-Strings "YYYY-MM-DD" (lokaler Kalendertag, ohne Zeitzonen-Fallen).
const pad = n => String(n).padStart(2, "0");
export const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const dow = s => (parse(s).getUTCDay() + 6) % 7; // Montag = 0
export const weekStart = s => addDays(s, -dow(s));
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const DAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const DAY_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const fmtShort = s => { const d = parse(s); return `${DAY_SHORT[dow(s)]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`; };
export const fmtDay = s => { const d = parse(s); return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`; };
export const uuid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });
