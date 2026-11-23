// Erzeugt den konkreten Inhalt (Blöcke, Übungen, Titel) einer Einheit – deterministisch, damit eine Einheit
// bei jeder Anpassung (z. B. kürzer/länger) neu und konsistent berechnet werden kann.
import {KINDS, kindInfo, SPORTS, EXERCISES, EQUIPMENT_TIERS, FOCUS_PATTERNS} from "./catalog.js";
import {FLOWS, buildFlow, pickFlow} from "./yoga.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round5 = n => Math.max(5, Math.round(n / 5) * 5);
const B = (label, text) => ({label, text});

const WALKRUN = [[1, 2], [1, 1], [2, 2], [3, 2], [4, 2], [5, 1], [8, 2], [10, 1], [15, 1]];

function pickExercises(kind, minutes, ctx) {
  const tier = EQUIPMENT_TIERS[ctx.equipment] ?? 0;
  const patterns = FOCUS_PATTERNS[kind] || FOCUS_PATTERNS.strength_full;
  const count = kind === "strength_snack" ? 4 : clamp(Math.round(minutes / 9), 3, patterns.length);
  const out = [];
  for (const p of patterns.slice(0, count)) {
    const options = EXERCISES.filter(e => e.pattern === p && e.tier <= tier).sort((a, b) => b.tier - a.tier);
    if (options.length) out.push(options[0]);
  }
  const phase = ctx.phaseKey;
  let scheme;
  if (kind === "strength_snack") scheme = {sets: 2, min: 10, max: 12};
  else if (ctx.deload || ctx.mode === "return" && /^r[12]$/.test(phase)) scheme = {sets: 2, min: 10, max: 12};
  else if (phase === "foundation" || phase === "base") scheme = {sets: 2, min: 12, max: 15};
  else if (phase === "peak" || (ctx.focusStrength && phase === "build")) scheme = {sets: 3, min: 5, max: 8};
  else scheme = {sets: 3, min: 8, max: 12};
  return out.map(e => {
    const timed = e.type === "time";
    return {name: e.name, type: e.type, cue: e.cue, sets: scheme.sets,
      repMin: timed ? 20 : scheme.min, repMax: timed ? (phase === "peak" ? 60 : 40) : scheme.max};
  });
}

function qualityScheme(minutes, hard) {
  const main = Math.max(8, minutes - 15);
  if (hard) {
    const len = main >= 30 ? 3 : 2, rec = len;
    const reps = clamp(Math.floor(main * 0.55 / len), 3, 10);
    return {reps, len, rec};
  }
  const len = clamp(Math.round(main / 4), 4, 12);
  const reps = clamp(Math.floor(main / (len + 2)), 2, 6);
  return {reps, len, rec: 2};
}

const WARM = (m, s = "locker einlaufen/einfahren, dabei Gelenke mobilisieren") => B("Warm-up", `${m} Min ${s}`);
const COOL = m => B("Cool-down", `${m} Min sehr locker ausrollen, danach kurz dehnen/atmen`);

export function buildSession(kind, minutes, ctx = {}) {
  const info = kindInfo(kind);
  const m = round5(minutes || 30);
  const level = ctx.level || "intermediate";
  const caution = ctx.mode === "return" || ctx.injury;
  const rpe = {easy: "RPE 3–4", moderate: "RPE 6–7", hard: "RPE 8"};
  const out = {kind, title: info.label, durationMin: m, blocks: [], exercises: []};

  switch (kind) {
    case "run_walkrun": {
      const idx = clamp((ctx.weekIdx || 0), 0, WALKRUN.length - 1);
      const [r, w] = WALKRUN[idx];
      const reps = Math.max(3, Math.floor((m - 10) / (r + w)));
      out.blocks = [WARM(5, "zügig gehen"), B("Haupteil", `${reps} × (${r} Min locker laufen / ${w} Min gehen) – Gesprächstempo, ${rpe.easy}`), COOL(5)];
      break;
    }
    case "run_easy": case "bike_easy": case "cardio_easy": {
      const what = kind === "run_easy" ? "locker laufen" : kind === "bike_easy" ? "locker fahren (hohe Trittfrequenz, leichter Gang)" : "auf dem Gerät deiner Wahl (Crosstrainer, Rudern, Rad …) locker belasten";
      out.blocks = [B("Haupteil", `${m} Min ${what} – Gesprächstempo, ${rpe.easy}`)];
      break;
    }
    case "run_long": case "bike_long":
      out.blocks = [B("Haupteil", `${m} Min gleichmäßig ${kind === "run_long" ? "laufen" : "fahren"}, ${rpe.easy}. Am Ende nicht schneller werden müssen – Ziel ist die Dauer.`),
        B("Tipp", "Trinken/Verpflegen ab ca. 60 Min üben, wie im Wettkampf.")];
      break;
    case "run_tempo": case "bike_tempo": {
      const q = qualityScheme(m, false), v = kind === "run_tempo" ? "laufen" : "fahren";
      out.blocks = [WARM(10), B("Haupteil", `${q.reps} × ${q.len} Min zügig ${v} (${rpe.moderate}, „angenehm hart“) / ${q.rec} Min locker`), COOL(5)];
      break;
    }
    case "run_intervals": case "bike_intervals": case "cardio_intervals": {
      const q = qualityScheme(m, true), v = kind === "run_intervals" ? "laufen" : "belasten";
      out.blocks = [WARM(10), B("Haupteil", `${q.reps} × ${q.len} Min ${v} (${rpe.hard}) / ${q.rec} Min locker`), COOL(5)];
      break;
    }
    case "swim_technique": case "swim_endurance": case "swim_intervals": {
      const mPerMin = {beginner: 25, intermediate: 35, advanced: 45}[level] || 35;
      const total = Math.round(m * mPerMin / 50) * 50;
      if (kind === "swim_technique")
        out.blocks = [B("Einschwimmen", `200 m locker, abwechselnd Kraul/Brust`), B("Technik", `${Math.round(total * 0.4 / 50) * 50} m Technikübungen (Fingerspitzen-Schleppen, Einarm-Kraul, Beinschlag mit Brett)`), B("Haupteil", `${Math.round(total * 0.3 / 50) * 50} m locker kraulen, auf lange Züge achten`), B("Ausschwimmen", "100 m sehr locker")];
      else if (kind === "swim_endurance")
        out.blocks = [B("Einschwimmen", "200 m locker"), B("Haupteil", `${Math.max(400, Math.round((total - 300) / 50) * 50)} m gleichmäßig, ${rpe.moderate}, in 2–4 Blöcken mit je 20 s Pause`), B("Ausschwimmen", "100 m locker")];
      else {
        const reps = clamp(Math.round(total * 0.5 / 100), 4, 12);
        out.blocks = [B("Einschwimmen", "300 m locker + 4 × 25 m steigernd"), B("Haupteil", `${reps} × 100 m zügig (${rpe.hard}) / 20–30 s Pause`), B("Ausschwimmen", "200 m locker")];
      }
      out.distanceHint = total;
      break;
    }
    case "strength_full": case "strength_lower": case "strength_upper": case "strength_core": case "strength_snack": {
      out.exercises = pickExercises(kind, m, ctx);
      out.blocks = [B("Warm-up", kind === "strength_snack" ? "3 Min Mobilisieren, 1 leichter Satz je Übung" : "5 Min locker bewegen, Mobilisieren, 1–2 leichte Aufwärmsätze"),
        B("Hinweis", "Wähle ein Gewicht, mit dem die letzten 1–2 Wiederholungen noch sauber gehen (RPE 7). Pausen 60–120 s.")];
      break;
    }
    case "football_skills":
      out.blocks = [WARM(10, "locker bewegen, Ballkontrolle, Passspiel"), B("Technik", `${Math.round((m - 20) * 0.5)} Min Pass- und Annahmeformen (beide Füße, kurz → lang)`), B("Koordination", `${Math.round((m - 20) * 0.5)} Min Dribbling, Ballführung, Torschuss-Technik`), COOL(10)];
      break;
    case "football_conditioning":
      out.blocks = caution
        ? [WARM(10), B("Haupteil", `${Math.max(10, m - 20)} Min Ball-/Laufformen im submaximalen Tempo (keine Sprints, keine harten Richtungswechsel)`), COOL(10)]
        : [WARM(10, "Lauf-ABC, Mobilisation"), B("Haupteil", `4 × 4 Min Intervalle mit Ball/Lauf (${rpe.hard}) / 3 Min locker; danach 6 × 20 m Beschleunigung mit Gehpause`), COOL(10)];
      break;
    case "team_match":
      out.blocks = [B("Einheit", `${m} Min Spiel / Mannschaftstraining. Vorher gut aufwärmen, nachher Belastung (RPE) und Beschwerden eintragen.`)];
      break;
    case "mobility": {
      const key = pickFlow(ctx), f = FLOWS[key];
      out.title = `Yoga: ${f.title}`; out.flowKey = key; out.flow = buildFlow(key, m);
      out.blocks = [B("Fokus", f.focus), B("Hinweis", `${out.flow.length} Positionen in ${m} Min. Ruhig atmen, nie bis zum Schmerz dehnen.`)];
      break;
    }
    case "walk":
      out.blocks = [B("Haupteil", `${m} Min zügig spazieren oder wandern – bewusst locker, Natur genießen.`)];
      break;
    case "event":
      out.title = ctx.eventName || "Wettkampf / Zielevent";
      out.blocks = [B("Plan", "Locker einlaufen, Pacing konservativ beginnen, Verpflegung wie geübt. Genieße es – die Arbeit ist getan.")];
      break;
    default:
      out.blocks = [B("Haupteil", `${m} Min nach Gefühl (${rpe.moderate})`)];
  }
  if (caution && info.intensity === "hard" && kind !== "event")
    out.blocks.push(B("Vorsicht", "Wiedereinstieg: Intensität nur steigern, wenn Folgetag beschwerdefrei ist. Keine medizinische Freigabe durch die App."));
  if (ctx.addon) out.blocks.push(B("Zusatz", `+ ${ctx.addon.minutes} Min Kraft-Snack nach der Einheit (siehe Übungen)`));
  return out;
}

export function sportBadge(kind) { const i = kindInfo(kind); return {...SPORTS[i.sport], sport: i.sport}; }
