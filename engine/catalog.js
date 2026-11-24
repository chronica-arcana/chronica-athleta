// Katalog: Sportarten, Einheitentypen ("kinds") und Kraftübungen.
// loadPerMin: grobe Belastungseinheit pro Minute (locker ≈ 1, hart ≈ 2.2) -> Wochenlast = Σ Minuten × loadPerMin.

export const SPORTS = {
  run:      {label: "Laufen",            icon: "🏃", color: "#f97316"},
  bike:     {label: "Radfahren",         icon: "🚴", color: "#3b82f6"},
  swim:     {label: "Schwimmen",         icon: "🏊", color: "#06b6d4"},
  strength: {label: "Kraft / Fitness",   icon: "🏋️", color: "#a855f7"},
  football: {label: "Fußball / Teamsport", icon: "⚽", color: "#22c55e"},
  climb:    {label: "Bouldern / Klettern", icon: "🧗", color: "#d97706"},
  cardio:   {label: "Ausdauer allgemein", icon: "❤️‍🔥", color: "#ef4444"},
  mobility: {label: "Yoga / Mobility",   icon: "🧘", color: "#14b8a6"},
  walk:     {label: "Gehen / Wandern",   icon: "🥾", color: "#84cc16"},
  event:    {label: "Wettkampf",         icon: "🏁", color: "#eab308"}
};

const K = (sport, group, intensity, label, icon, loadPerMin, extra = {}) => ({sport, group, intensity, label, icon, loadPerMin, ...extra});
export const KINDS = {
  run_walkrun:   K("run", "cardio", "easy", "Lauf-/Geh-Intervalle", "🏃", 1.0),
  run_easy:      K("run", "cardio", "easy", "Lockerer Lauf", "🏃", 1.0),
  run_long:      K("run", "cardio", "easy", "Langer Lauf", "🏃", 1.1, {key: true, long: true}),
  run_tempo:     K("run", "cardio", "moderate", "Tempolauf", "⚡", 1.7, {key: true, quality: true}),
  run_intervals: K("run", "cardio", "hard", "Intervall-Lauf", "🔥", 2.2, {key: true, quality: true}),
  bike_easy:      K("bike", "cardio", "easy", "Lockere Radeinheit", "🚴", 0.9),
  bike_long:      K("bike", "cardio", "easy", "Lange Ausfahrt", "🚴", 1.0, {key: true, long: true}),
  bike_tempo:     K("bike", "cardio", "moderate", "Tempo / Schwelle (Rad)", "⚡", 1.6, {key: true, quality: true}),
  bike_intervals: K("bike", "cardio", "hard", "Intervalle (Rad)", "🔥", 2.0, {key: true, quality: true}),
  swim_technique: K("swim", "cardio", "easy", "Technik-Schwimmen", "🏊", 1.1),
  swim_endurance: K("swim", "cardio", "moderate", "Ausdauer-Schwimmen", "🏊", 1.5, {key: true, long: true}),
  swim_intervals: K("swim", "cardio", "hard", "Schwimm-Intervalle", "🔥", 2.0, {key: true, quality: true}),
  strength_full:  K("strength", "strength", "moderate", "Ganzkörper-Kraft", "🏋️", 1.3),
  strength_lower: K("strength", "strength", "moderate", "Kraft Beine & Rumpf", "🦵", 1.4, {lower: true}),
  strength_upper: K("strength", "strength", "moderate", "Kraft Oberkörper", "💪", 1.2),
  strength_core:  K("strength", "strength", "easy", "Rumpf & Prävention", "🧱", 0.9),
  strength_snack: K("strength", "strength", "moderate", "Kraft-Snack (kurz)", "🏋️", 1.3),
  football_skills:       K("football", "skill", "moderate", "Technik & Ball", "⚽", 1.3),
  football_conditioning: K("football", "skill", "hard", "Fußball-Kondition", "🔥", 2.0, {key: true, quality: true}),
  team_match:            K("football", "skill", "hard", "Spiel / Mannschaftstraining", "🏟️", 2.0, {key: true}),
  climb_easy: K("climb", "skill", "moderate", "Bouldern (Technik & Volumen)", "🧗", 1.2),
  climb_hard: K("climb", "skill", "hard", "Bouldern (Projekte & Kraft)", "🧗", 1.8, {key: true, quality: true}),
  cardio_easy:      K("cardio", "cardio", "easy", "Lockeres Cardio", "❤️‍🔥", 0.9),
  cardio_intervals: K("cardio", "cardio", "hard", "Cardio-Intervalle", "🔥", 2.0, {key: true, quality: true}),
  mobility: K("mobility", "recovery", "easy", "Yoga / Mobility", "🧘", 0.5),
  walk:     K("walk", "recovery", "easy", "Spaziergang / Wanderung", "🥾", 0.6),
  event:    K("event", "event", "hard", "Wettkampf", "🏁", 2.2, {key: true}),
  custom:   K("cardio", "cardio", "moderate", "Eigenes Training", "⭐", 1.3)
};
export const kindInfo = kind => KINDS[kind] || KINDS.custom;
export const sportOfKind = kind => kindInfo(kind).sport;

// Sportarten, aus denen beim Anlegen/Tauschen einer Einheit gewählt werden kann (event/custom bewusst separat)
export const PICKABLE_SPORTS = ["run", "bike", "swim", "strength", "football", "climb", "cardio", "mobility", "walk"];
export const kindsOfSport = sport => Object.keys(KINDS).filter(k => KINDS[k].sport === sport && k !== "strength_snack" && k !== "run_walkrun");
// Eine Stufe entschärfen, falls zwei harte Einheiten direkt aufeinander folgen
export const DOWNGRADE = {run_intervals: "run_tempo", run_tempo: "run_easy", bike_intervals: "bike_tempo", bike_tempo: "bike_easy",
  swim_intervals: "swim_endurance", swim_endurance: "swim_technique", football_conditioning: "football_skills",
  team_match: "football_skills", climb_hard: "climb_easy", cardio_intervals: "cardio_easy"};

// Übungsbibliothek. tier: 0 = nur Körpergewicht/Zuhause, 1 = Kurzhanteln/Bänder, 2 = Fitnessstudio
export const EXERCISES = [
  {name: "Kniebeuge (Körpergewicht)", pattern: "squat", tier: 0, type: "reps", cue: "Brust hoch, Knie über den Füßen, kontrolliert absenken."},
  {name: "Goblet-Kniebeuge", pattern: "squat", tier: 1, type: "weight", cue: "Hantel vor der Brust, tief und aufrecht."},
  {name: "Beinpresse", pattern: "squat", tier: 2, type: "weight", cue: "Kontrolliert absenken, über den ganzen Fuß drücken."},
  {name: "Glute Bridge", pattern: "hinge", tier: 0, type: "reps", cue: "Hüfte heben, Gesäß aktiv, Rippen unten."},
  {name: "Rumänisches Kreuzheben (Kurzhanteln)", pattern: "hinge", tier: 1, type: "weight", cue: "Hüfte nach hinten, Rücken neutral."},
  {name: "Rumänisches Kreuzheben", pattern: "hinge", tier: 2, type: "weight", cue: "Hüfte nach hinten, Stange nah am Körper."},
  {name: "Ausfallschritt (Körpergewicht)", pattern: "lunge", tier: 0, type: "reps", cue: "Becken stabil, Knie zeigt über den Fuß."},
  {name: "Split Squat (Kurzhanteln)", pattern: "lunge", tier: 1, type: "weight", cue: "Aufrecht, kontrolliert absenken."},
  {name: "Step-up", pattern: "lunge", tier: 2, type: "weight", cue: "Kontrolliert hoch, oben stabilisieren."},
  {name: "Wadenheben", pattern: "calves", tier: 0, type: "reps", cue: "Langsam absenken, voll hochdrücken."},
  {name: "Wadenheben (gewichtet)", pattern: "calves", tier: 1, type: "weight", cue: "Langsam absenken, voll hochdrücken."},
  {name: "Liegestütze", pattern: "push", tier: 0, type: "reps", cue: "Körper in einer Linie, Brust zum Boden."},
  {name: "Kurzhantel-Bankdrücken", pattern: "push", tier: 1, type: "weight", cue: "Schulterblätter zusammen, kontrolliert drücken."},
  {name: "Bankdrücken", pattern: "push", tier: 2, type: "weight", cue: "Füße fest, Stange kontrolliert zur Brust."},
  {name: "Pike Push-up", pattern: "push2", tier: 0, type: "reps", cue: "Hüfte hoch, Kopf zwischen die Arme."},
  {name: "Schulterdrücken (Kurzhanteln)", pattern: "push2", tier: 1, type: "weight", cue: "Rumpf stabil, nicht ins Hohlkreuz."},
  {name: "Schulterdrücken (Maschine)", pattern: "push2", tier: 2, type: "weight", cue: "Rücken anlehnen, kontrolliert drücken."},
  {name: "Rudern am Tisch / Türrahmen", pattern: "pull", tier: 0, type: "reps", cue: "Körper gerade, Schulterblätter zusammenziehen."},
  {name: "Einarmiges Kurzhantelrudern", pattern: "pull", tier: 1, type: "weight", cue: "Rücken neutral, Ellbogen nah am Körper."},
  {name: "Latzug", pattern: "pull", tier: 2, type: "weight", cue: "Brust raus, Ellbogen nach unten ziehen."},
  {name: "Superman / Reverse Fly", pattern: "pull2", tier: 0, type: "reps", cue: "Schulterblätter aktiv, Nacken lang."},
  {name: "Rudern vorgebeugt (Kurzhanteln)", pattern: "pull2", tier: 1, type: "weight", cue: "Hüfte nach hinten, Rücken gerade."},
  {name: "Rudern am Kabel", pattern: "pull2", tier: 2, type: "weight", cue: "Brust raus, Schulterblätter zusammenziehen."},
  {name: "Plank", pattern: "core", tier: 0, type: "time", cue: "Rippen unten, Gesäß fest, nicht durchhängen."},
  {name: "Dead Bug", pattern: "core2", tier: 0, type: "reps", cue: "Unterer Rücken bleibt am Boden."},
  {name: "Seitstütz", pattern: "core3", tier: 0, type: "time", cue: "Körper in einer Linie, Hüfte hoch."},
  {name: "Pallof Press", pattern: "core2", tier: 1, type: "weight", cue: "Ausatmen, Rumpf gegen Rotation stabil halten."},
  {name: "Bird Dog", pattern: "core3", tier: 0, type: "reps", cue: "Becken ruhig, langsam und kontrolliert."}
];

export const EQUIPMENT_TIERS = {none: 0, dumbbell: 1, gym: 2};
export const FOCUS_PATTERNS = {
  strength_full:  ["squat", "hinge", "push", "pull", "core", "lunge", "calves"],
  strength_lower: ["squat", "hinge", "lunge", "calves", "core", "core2"],
  strength_upper: ["push", "pull", "push2", "pull2", "core", "core3"],
  strength_core:  ["core", "core2", "core3", "hinge", "lunge"],
  strength_snack: ["squat", "push", "pull", "core"]
};
