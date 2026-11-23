// Umwandlung der Antworten der Garmin Connect Personal API in das App-Format (engine/garmin.js).
// WICHTIG: Pfade stammen aus der Swagger-Übersicht; Query-Parameter und Feldnamen sind aus dem bekannten Garmin-Connect-Datenmodell
// abgeleitet und noch NICHT gegen einen echten Account bestätigt. Der Mapper liest deshalb tolerant (mehrere mögliche Feldnamen)
// und die Diagnose-Aktion zeigt die echte Struktur, damit Abweichungen schnell korrigiert werden können.

const num = v => { const x = typeof v === "string" ? parseFloat(v.replace(",", ".")) : v; return Number.isFinite(x) ? x : null; };
const first = (o, ...paths) => { for (const p of paths) { let v = o; for (const k of p.split(".")) v = v == null ? undefined : v[k]; if (v !== undefined && v !== null && v !== "") return v; } return null; };
const day = s => { const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ""; };
const round = (v, n = 1) => v == null ? null : Math.round(v * 10 ** n) / 10 ** n;
export const asList = res => Array.isArray(res) ? res : res && typeof res === "object" ? (Object.values(res).find(Array.isArray) || []) : [];

export function mapActivity(a) {
  const startLocal = String(first(a, "startTimeLocal", "startTimeGMT", "startTime") || "");
  const type = first(a, "activityType.typeKey", "activityTypeDTO.typeKey", "activityType", "typeKey");
  const id = first(a, "activityId", "summaryId", "id"), date = day(startLocal);
  if (id == null || !date) return null;
  const durS = num(first(a, "duration", "durationInSeconds", "elapsedDuration")), distM = num(first(a, "distance", "distanceInMeters"));
  return {id: String(id), date, start: startLocal.slice(11, 16), type: String(typeof type === "object" ? "" : type || "").toLowerCase(), name: String(first(a, "activityName", "name") || "").slice(0, 80),
    durationMin: round(durS != null ? durS / 60 : null), distanceKm: round(distM != null ? distM / 1000 : null, 2), avgHr: round(num(first(a, "averageHR", "averageHeartRate", "avgHr")), 0),
    maxHr: round(num(first(a, "maxHR", "maxHeartRate")), 0), calories: round(num(first(a, "calories")), 0), aerobicTE: round(num(first(a, "aerobicTrainingEffect", "aerobicTE"))),
    anaerobicTE: round(num(first(a, "anaerobicTrainingEffect", "anaerobicTE"))), trainingLoad: round(num(first(a, "activityTrainingLoad", "trainingLoad")), 0)};
}
export function mapSleep(res, date) {
  const o = first(res || {}, "dailySleepDTO") || res || {}, secs = num(first(o, "sleepTimeSeconds", "totalSleepSeconds", "sleepTime"));
  if (secs == null && first(o, "sleepScores.overall.value", "sleepScore") == null) return null;
  return {date: day(first(o, "calendarDate")) || date, sleepHours: secs != null ? round(secs / 3600, 2) : null, sleepScore: num(first(o, "sleepScores.overall.value", "sleepScore", "overallScore"))};
}
export function mapHrv(item) {
  const o = first(item || {}, "hrvSummary") || item || {}, date = day(first(o, "calendarDate") || first(item || {}, "calendarDate"));
  if (!date) return null;
  const avg = num(first(o, "lastNightAvg", "lastNight", "avgOvernightHrv")), status = first(o, "status", "hrvStatus");
  if (avg == null && !status) return null;
  return {date, hrvAvg: avg, hrvStatus: status ? String(status).toUpperCase() : null};
}
export function mapRestingHr(res, date) {
  const v = num(first(res || {}, "restingHeartRate", "restingHr", "allMetrics.metricsMap.WELLNESS_RESTING_HEART_RATE.0.value"));
  return v == null ? null : {date: day(first(res, "calendarDate")) || date, restingHr: v};
}
export function mapBodyBattery(item) {
  const date = day(first(item || {}, "date", "calendarDate"));
  const arr = first(item || {}, "bodyBatteryValuesArray", "bodyBatteryValues") || [];
  const vals = arr.map(x => Array.isArray(x) ? num(x[1]) : num(x && x.value)).filter(v => v != null);
  if (!date || !vals.length) return null;
  return {date, bodyBatteryMorning: Math.max(...vals.slice(0, Math.max(1, Math.ceil(vals.length / 3))))};
}

// Form einer Antwort ohne Werte (nur Feldnamen/Typen), für die Diagnose
export function shapeOf(v, depth = 3) {
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth - 1)] : [];
  if (v && typeof v === "object") return depth <= 0 ? "{…}" : Object.fromEntries(Object.keys(v).slice(0, 40).map(k => [k, shapeOf(v[k], depth - 1)]));
  return v === null ? "null" : typeof v;
}

export function mergeDaily(parts) { // Teilergebnisse (Schlaf, HRV, Puls, Body Battery) je Datum zusammenführen
  const by = new Map();
  for (const p of parts.flat().filter(Boolean)) by.set(p.date, {...(by.get(p.date) || {date: p.date}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null))});
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}
