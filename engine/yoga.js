// Yoga-/Mobility-Abläufe mit Positionen, Haltedauer und Hinweisen. Dauer wird auf die geplante Minutenzahl skaliert.
const P = (name, seconds, cue) => ({name, seconds, cue});

export const FLOWS = {
  regeneration: {title: "Regeneration nach Ausdauer", focus: "Hüfte, Oberschenkel, Waden, unterer Rücken", poses: [
    P("Ankommen und Atmung", 60, "Rückenlage, Hände auf den Bauch. 4 Sek. einatmen, 6 Sek. ausatmen."),
    P("Knie zur Brust", 60, "Beide Knie sanft zur Brust ziehen, Becken locker lassen."),
    P("Tiefer Ausfallschritt (Hüftbeuger), je Seite", 90, "Hinteres Knie am Boden, Becken nach vorn schieben, Rippen unten."),
    P("Taube oder Figur 4, je Seite", 120, "Außenseite der Hüfte dehnen, nur bis zu einem angenehmen Zug."),
    P("Vorbeuge im Sitzen", 90, "Rücken lang, Atem in die Rückseite der Beine lenken."),
    P("Wadendehnung (herabschauender Hund)", 60, "Fersen abwechselnd Richtung Boden sinken lassen."),
    P("Schmetterling", 60, "Fußsohlen zusammen, Knie schwer werden lassen."),
    P("Beine an der Wand", 180, "Rückenlage, Beine hoch, ruhig atmen."),
    P("Endentspannung", 120, "Alles loslassen, Atem frei fließen lassen.")]},
  strength: {title: "Mobilität nach Kraft", focus: "Rücken, Schultern, Brust, Hüfte", poses: [
    P("Ankommen und Atmung", 60, "Im Sitzen oder Liegen, tief in den Bauch atmen."),
    P("Katze und Kuh", 90, "Im Vierfüßlerstand Wirbelsäule im Atemrhythmus runden und strecken."),
    P("Kindhaltung", 90, "Gesäß Richtung Fersen, Arme lang nach vorn."),
    P("Fadennadel (Schulter), je Seite", 90, "Ein Arm unter dem Körper hindurch, Schulter zum Boden sinken lassen."),
    P("Brustöffner am Türrahmen", 60, "Unterarm an den Rahmen, Brustkorb sanft nach vorn drehen."),
    P("Sphinx", 60, "Auf den Unterarmen aufstützen, Brustbein weit, Nacken lang."),
    P("Liegender Drehsitz, je Seite", 90, "Knie zur Seite sinken lassen, Schultern bleiben am Boden."),
    P("Taube oder Figur 4, je Seite", 90, "Gesäß und Hüfte lösen, nicht ins Hohlkreuz fallen."),
    P("Endentspannung", 120, "Rückenlage, alles loslassen.")]},
  relax: {title: "Entspannung und Atem", focus: "Nervensystem, Schlaf, Erholung", poses: [
    P("Atemübung 4-6", 120, "4 Sek. einatmen, 6 Sek. ausatmen. Schultern weich."),
    P("Kindhaltung", 120, "Stirn auf den Boden oder ein Kissen, Rücken weit atmen."),
    P("Liegender Drehsitz, je Seite", 90, "Sanft und passiv, ohne Anstrengung."),
    P("Schmetterling liegend", 120, "Fußsohlen zusammen, Hände auf Bauch und Brust."),
    P("Beine an der Wand", 240, "Rückenlage, Beine hoch, Augen schließen."),
    P("Body Scan", 180, "Körper von den Füßen zum Kopf durchgehen und jeweils loslassen.")]},
  morning: {title: "Kurzer Morgenflow", focus: "Wachwerden, Wirbelsäule, Hüfte", poses: [
    P("Katze und Kuh", 60, "Wirbelsäule im Atemrhythmus mobilisieren."),
    P("Sonnengruß A, 3 Runden", 150, "Fließend im Atemrhythmus, kleine Schritte."),
    P("Ausfallschritt mit Drehung, je Seite", 60, "Arm zur Decke öffnen, Blick folgt der Hand."),
    P("Vorbeuge, locker hängen", 45, "Knie leicht gebeugt, Nacken entspannt."),
    P("Hüftkreisen", 45, "Große Kreise, in beide Richtungen."),
    P("Berghaltung", 45, "Fest stehen, Atem beobachten, Tag beginnen.")]}
};

const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function buildFlow(key, minutes) {
  const f = FLOWS[key] || FLOWS.regeneration, sum = f.poses.reduce((a, p) => a + p.seconds, 0), factor = (minutes * 60) / sum;
  return f.poses.map(p => { const sec = Math.max(20, Math.round(p.seconds * factor / 5) * 5); return {name: p.name, seconds: sec, label: fmt(sec), cue: p.cue}; });
}
export function pickFlow(ctx = {}) {
  if (ctx.flowKey && FLOWS[ctx.flowKey]) return ctx.flowKey;
  if (ctx.deload) return "relax";
  if (ctx.after === "strength") return "strength";
  return "regeneration";
}
