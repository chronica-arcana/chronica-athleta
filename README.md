# Chronica Athleta

*Flexibler Multisport-Trainingsplaner* – Teil der Chronica-Tools.

Mobil-optimierte Web-App (PWA) für Laufen, Rad, Schwimmen, Kraft, Teamsport, Yoga/Mobility und Wiedereinstieg nach Verletzung.
Ein **Wizard** erfasst dein Ziel (frei formuliert, die KI füllt vor und fragt nach), erstellt einen Plan für den von dir gewählten Zeitraum –
und der Plan bleibt danach **flexibel**: Einheiten tauschen (z. B. Cardio statt Kraft), verschieben, kürzen, auslassen oder Spontanes eintragen –
der Rest der Woche rechnet sich automatisch neu.

## Funktionen

| | |
|---|---|
| **Plan-Wizard** | Freitext-Ziel → KI-Vorbelegung + Rückfragen → Event-/Zeitraum, Niveau, Zeitbudget, Ausstattung, Beschwerden → Vorschau mit Phasen & Beispielwoche |
| **Phasen & Last** | Grundlage → Aufbau → Spezifisch → Tapering (bei Event) bzw. Fundament/Aufbau/Festigung; Entlastungswoche alle 4 Wochen; Wochenlast steigt höchstens ~10 % |
| **Flexibel** | Tauschen (Kraft ↔ Cardio …), Verschieben, Kürzer/Länger, Auslassen, Hinzufügen, „Woche anpassen“ (nur bestimmte Tage frei). Ausgefallene Kraft wird als 20-Min-Kraft-Snack nachgeholt, verpasste Last höchstens +25 % auf lockere Einheiten verteilt, zu viel Last kürzt den Rest der Woche, keine harten Einheiten hintereinander |
| **KI-Coach nach dem Training** | Mehr Gewicht / mehr Wiederholungen / halten / reduzieren pro Übung, Hinweise zu Tempo, Pausen, Erholung. Regeln (Double Progression, Schmerz-/RPE-/Garmin-Bremsen) sind immer aktiv; KI-Vorschläge werden darauf begrenzt (max. +10 % Gewicht) |
| **Garmin** | Aktivitäten, Trainingseffekt, Schlaf, HRV, Ruhepuls, Body Battery bremsen oder erlauben Steigerungen; nicht geplante Garmin-Aktivitäten lassen sich mit einem Tipp übernehmen. Heute per Datei-Import (`tools/garmin_export.py`), direkte Anbindung über die offizielle **Garmin Personal API** (eigener API-Key je Nutzer) folgt |
| **Konten** | Supabase Auth (E-Mail/Passwort), Daten per Row Level Security strikt je Konto getrennt, Export als JSON, Konto löschen |
| **Nur kostenlose Dienste** | Supabase Free, Vercel Hobby, KI über kostenlose Anbieter (Groq/Gemini/OpenRouter), keine Bezahl-APIs |

## Architektur

```
Browser (statisch, kein Build)                 Vercel (kostenlos)                 Supabase (kostenlos)
  index.html · js/ · engine/ · styles/   ──►   api/ai.js      (KI-Proxy)    ──►   Auth · Postgres + RLS
  Preact+htm lokal in vendor/                  (Garmin Personal API folgt)         garmin_links (verschlüsselte Keys)
        │                                              │
        └── supabase-js (Konto, Daten) ────────────────┴──► KI-Anbieter (Groq/Gemini/…)
```

* `engine/` – reine Logik ohne UI (Planung, Anpassung, Auswertung, Garmin-Auswertung); mit Tests.
* `js/` – Store, Datenadapter (Supabase / lokaler Demo-Modus), Oberfläche.
* `api/` – serverlose Funktion: KI-Proxy (feste Prompts, Login-Pflicht, Tageslimit). Garmin-Funktion über die Personal API folgt.
* `supabase/migrations` – Schema + Zeilenschutz; `supabase/tests` – Prüfung gegen lokales Postgres.
* `tools/` – Garmin-Export-Skript (Fallback) und archivierte inoffizielle Garmin-Anbindung.
* `legacy/` – die frühere Fußball-Reha-Version (läuft weiter, eigene lokale Daten).

## Schnellstart

* **Ohne Einrichtung (Demo-Modus):** `config.js` leer lassen → App läuft mit lokalen Daten, regelbasiertem Coach und Datei-Import für Garmin. Lokal starten: `python3 -m http.server 8000` → <http://localhost:8000>.
* **Mit Konten, KI & Garmin:** siehe **[docs/SETUP.md](docs/SETUP.md)** (ca. 20 Minuten, alles kostenlos).

## Tests

```bash
npm test                              # Engine, KI-Proxy, Store/Adapter (Node ≥ 20)
# optional (archivierte inoffizielle Garmin-Anbindung): python -m unittest tools/garmin_unofficial/test_garmin_api.py
./supabase/tests/run-local.sh         # Migration + Zeilenschutz gegen lokales PostgreSQL
```

## Grenzen / ehrliche Hinweise

* **Garmin:** Die direkte Anbindung über die offizielle Personal API (Key aus dem eigenen Garmin-Connect-Account) ist noch nicht eingebaut; bis dahin Datei-Import. Die frühere inoffizielle Passwort-Anbindung liegt archiviert unter `tools/garmin_unofficial/` und ist nicht Teil des Deployments.
* **Kostenlose KI:** Kontingente und Modelle der Anbieter ändern sich; bei Ausfall/Limit arbeitet der Coach regelbasiert weiter.
* **Medizinisch:** Die App ersetzt keine Untersuchung oder Freigabe durch Arzt/Sportphysio. Im Wiedereinstiegs-Modus wird nur bei dokumentiertem Schmerzwert gesteigert.
