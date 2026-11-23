// Garmin-Daten auswerten: Erholungs-Flags, Aktivitäten den Einheiten zuordnen, Importvorschläge.
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = n => String(Math.round(n * 10) / 10).replace(".", ",");

const TYPE_MAP = {
  run: ["running", "treadmill_running", "trail_running", "track_running", "virtual_run"],
  bike: ["cycling", "indoor_cycling", "road_biking", "mountain_biking", "gravel_cycling", "virtual_ride", "e_bike_fitness"],
  swim: ["lap_swimming", "open_water_swimming", "swimming"],
  strength: ["strength_training", "functional_strength_training", "hiit"],
  football: ["soccer", "football", "futsal"],
  cardio: ["elliptical", "indoor_cardio", "rowing", "indoor_rowing", "stair_climbing", "cardio", "hiit"],
  mobility: ["yoga", "pilates", "stretching", "breathwork"],
  walk: ["walking", "hiking", "casual_walking"]
};
export function sportOfActivity(type) {
  const t = String(type || "").toLowerCase();
  for (const [sport, list] of Object.entries(TYPE_MAP)) if (list.includes(t)) return sport;
  return null;
}

export function recoveryFlags(daily, date) {
  const d = (daily || []).find(x => x.date === date);
  if (!d) return {data: null, flags: []};
  const prior = daily.filter(x => x.date < date && x.restingHr != null).slice(-14).map(x => x.restingHr);
  const base = prior.length >= 5 ? median(prior) : null;
  const flags = [];
  if (d.sleepHours != null && d.sleepHours < 6) flags.push(`wenig Schlaf (${fmt(d.sleepHours)} h)`);
  if (["LOW", "UNBALANCED", "POOR"].includes(String(d.hrvStatus || "").toUpperCase())) flags.push(`HRV-Status ${String(d.hrvStatus).toUpperCase()}`);
  if (base != null && d.restingHr != null && d.restingHr >= base + 5) flags.push(`Ruhepuls erhöht (${fmt(d.restingHr)} statt ~${fmt(base)})`);
  if (d.bodyBatteryMorning != null && d.bodyBatteryMorning < 30) flags.push(`Body Battery morgens niedrig (${fmt(d.bodyBatteryMorning)})`);
  return {data: d, flags};
}
export function activityFlags(acts, allActs = []) {
  const flags = [], loads = allActs.map(a => a.trainingLoad).filter(x => x != null), base = median(loads);
  for (const a of acts) {
    if (a.aerobicTE != null && a.aerobicTE >= 4.5) flags.push(`aerober Trainingseffekt sehr hoch (${fmt(a.aerobicTE)})`);
    if (a.anaerobicTE != null && a.anaerobicTE >= 3.5) flags.push(`anaerober Trainingseffekt hoch (${fmt(a.anaerobicTE)})`);
    if (a.trainingLoad != null && base && loads.length >= 5 && a.trainingLoad >= base * 1.6) flags.push(`Trainingsload deutlich über Median (${fmt(a.trainingLoad)})`);
  }
  return flags;
}
// Aktivitäten eines Tages, die zur Sportart der Einheit passen
export function matchActivities(activities, date, sport) {
  return (activities || []).filter(a => a.date === date && (sportOfActivity(a.type) === sport || (sport === "cardio" && sportOfActivity(a.type) !== "strength")));
}
// Garmin-Aktivitäten, die noch keiner erledigten Einheit zugeordnet sind -> Vorschläge zum Übernehmen
export function importSuggestions(activities, sessions, sinceDate) {
  const used = new Set(sessions.filter(s => s.log && s.log.garminActivityId).map(s => String(s.log.garminActivityId)));
  return (activities || []).filter(a => a.date >= sinceDate && !used.has(String(a.id)) && sportOfActivity(a.type) && (a.durationMin || 0) >= 10)
    .filter(a => !sessions.some(s => s.status === "done" && s.date === a.date && s.sport === sportOfActivity(a.type) && !(s.log && s.log.garminActivityId)))
    .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
}

// Import-Datei (garmin_data.json aus tools/garmin_export.py) prüfen und normalisieren
const n = v => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : null; };
const day = s => { const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ""; };
export function normalizeExport(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Keine gültige Garmin-Exportdatei.");
  const acts = (Array.isArray(raw.activities) ? raw.activities : []).map(a => ({id: String(a.id ?? `${a.date}_${a.start}`), date: day(a.date), start: String(a.start || "").slice(0, 5),
    type: String(a.type || "").toLowerCase(), name: String(a.name || "").slice(0, 80), durationMin: n(a.durationMin), distanceKm: n(a.distanceKm), avgHr: n(a.avgHr), maxHr: n(a.maxHr),
    calories: n(a.calories), aerobicTE: n(a.aerobicTE), anaerobicTE: n(a.anaerobicTE), trainingLoad: n(a.trainingLoad)})).filter(a => a.date);
  const daily = (Array.isArray(raw.daily) ? raw.daily : []).map(d => ({date: day(d.date), restingHr: n(d.restingHr), hrvAvg: n(d.hrvAvg), hrvStatus: String(d.hrvStatus || "").toUpperCase(),
    sleepHours: n(d.sleepHours), sleepScore: n(d.sleepScore), bodyBatteryMorning: n(d.bodyBatteryMorning), stressAvg: n(d.stressAvg),
    steps: n(d.steps), vo2max: n(d.vo2max), vo2maxCycling: n(d.vo2maxCycling)})).filter(d => d.date);
  if (!acts.length && !daily.length) throw new Error("Die Datei enthält keine Aktivitäten oder Tageswerte.");
  return {activities: acts.slice(-1500), daily: daily.slice(-400)};
}
