# Chronica Athleta

*Flexibler Multisport-Trainingsplaner* – Teil der Chronica-Tools.

Mobil-optimierte Web-App (PWA, am Desktop mit Seitenleiste und zwei Spalten) für Laufen, Rad, Schwimmen, Kraft, Teamsport, Yoga/Mobility und Wiedereinstieg nach Verletzung.
Ein **Wizard** erfasst dein Ziel (frei formuliert, die KI füllt vor und fragt nach), erstellt einen Plan für den von dir gewählten Zeitraum –
und der Plan bleibt danach **flexibel**: Einheiten tauschen (z. B. Cardio statt Kraft), verschieben, kürzen, auslassen oder Spontanes eintragen –
der Rest der Woche rechnet sich automatisch neu.

## Funktionen

| | |
|---|---|
| **Plan-Wizard** | Freitext-Ziel → die KI füllt aus, was sie erkennt; gefragt wird nur noch, was fehlt → Zusammenfassung zum Bestätigen → Vorschau mit Phasen und erster Einheit. Ohne Freitext/KI der volle Ablauf |
| **Phasen & Last** | Grundlage → Aufbau → Spezifisch → Tapering (bei Event) bzw. Fundament/Aufbau/Festigung; Entlastungswoche alle 4 Wochen; Wochenlast steigt höchstens ~10 % |
| **Flexibel** | Tauschen (Kraft ↔ Cardio …), Verschieben, Kürzer/Länger, Auslassen, Hinzufügen, „Woche anpassen“ (nur bestimmte Tage frei). Ausgefallene Kraft wird als 20-Min-Kraft-Snack nachgeholt, verpasste Last höchstens +25 % auf lockere Einheiten verteilt, zu viel Last kürzt den Rest der Woche, keine harten Einheiten hintereinander |
| **Dauerhafte Änderungen** | Per Coach-Chat oder Einheit → „Diese Art dauerhaft ersetzen“: Einheitsarten (z. B. Fußballtraining) bis zu einem Datum aus dem Plan nehmen; wird bei jeder Anpassung beachtet, unter Plan jederzeit entfernbar |
| **Entwürfe** | Eingaben beim Loggen werden laufend gespeichert und nach versehentlichem Schließen wiederhergestellt |
| **Garmin zuerst** | Dauer/Distanz alternativer Einheiten (Laufen, Rad …) werden aus den eigenen Garmin-Aktivitäten vorgeschlagen; nur Kraft wird manuell erfasst |
| **Empfehlungen** | Nach mindestens 5 Einheiten (und danach alle 5) erscheint ein Pop-up mit gezielten Verbesserungen aus Verlauf und Garmin-Daten, optional mit KI-Fokus |
| **Mehrere Pläne** | Pläne umbenennen, löschen, speichern; immer nur einer aktiv (Profil → Trainingspläne) |
| **KI-Coach nach dem Training** | Mehr Gewicht / mehr Wiederholungen / halten / reduzieren pro Übung, Hinweise zu Tempo, Pausen, Erholung. Regeln (Double Progression, Schmerz-/RPE-/Garmin-Bremsen) sind immer aktiv; KI-Vorschläge werden darauf begrenzt (max. +10 % Gewicht) |
| **Coach-Chat** | Fragen zu Training, Erholung und Plan; der Coach kennt nächste und letzte Einheiten, Erholung, Belastung, VO₂max und Kraftziele. Er kann Änderungen an der nächsten Einheit **vorschlagen** (tauschen, auslassen, kürzen/verlängern, heute machen) – ausgeführt wird nur nach deiner Bestätigung |
| **Yoga/Mobility** | Wird automatisch eingeplant, wenn sinnvoll (Wiedereinstieg/Gesundheit, Entlastungswochen, viel Kraft oder viele Schlüsseleinheiten, bei niedriger Erholung statt Training), mit Ablauf aus Positionen, Dauer und Hinweisen |
| **Anpassung an Alltag und Erholung** | Garmin-Aktivitäten werden automatisch übernommen (die Woche passt sich an); eigene Trainingsbereitschaft aus Schlaf, HRV, Ruhepuls, Body Battery, Schritten und Belastung passt die heutige Einheit an. Der Fokus liegt auf der nächsten Einheit, Späteres ist vorläufig |
| **Statistiken und Auszeichnungen** | Summen, Vergleich zum Vormonat, Belastungsverhältnis, Intensitätsverteilung, Kraft-Volumen und Steigerungen, Schritte, Schlaf, Ruhepuls, VO₂max. Auszeichnungen werden nur angezeigt, wenn sie erreicht sind |
| **Garmin (eigener Account)** | Jeder Nutzer trägt im Profil seinen *eigenen* Garmin **Personal API Key** ein (offizielle API, kein Passwort). Der Key wird geprüft und verschlüsselt gespeichert; die App holt Aktivitäten, Trainingseffekt, Schlaf, HRV, Ruhepuls und Body Battery. Auffällige Erholung bremst Steigerungen; nicht geplante Aktivitäten lassen sich mit einem Tipp übernehmen. **Stand:** gebaut und mit Fake-Garmin getestet, aber noch nicht gegen einen echten Account bestätigt (Diagnose-Button im Profil) |
| **Konten** | Supabase Auth (E-Mail/Passwort), Daten per Row Level Security strikt je Konto getrennt, Export als JSON, Konto löschen |
| **Nur kostenlose Dienste** | Supabase Free, Vercel Hobby, KI über kostenlose Anbieter (Groq/Gemini/OpenRouter), keine Bezahl-APIs |

## Architektur

```
Browser (statisch, kein Build)                 Vercel (kostenlos)                 Supabase (kostenlos)
  index.html · js/ · engine/ · styles/   ──►   api/ai.js      (KI-Proxy)    ──►   Auth · Postgres + RLS
  Preact+htm lokal in vendor/                  api/garmin.js  (Personal API)      garmin_links (verschlüsselter Key)
        │                                              │
        └── supabase-js (Konto, Daten) ────────────────┴──► KI-Anbieter (Groq/Gemini/…)
```

* `engine/` – reine Logik ohne UI (Planung, Anpassung, Auswertung, Garmin-Auswertung); mit Tests.
* `js/` – Store, Datenadapter (Supabase / lokaler Demo-Modus), Oberfläche.
* `api/` – serverlose Funktionen: `ai.js` (KI-Proxy: feste Prompts, Login-Pflicht, Tageslimit) und `garmin.js` (Garmin Personal API: Key prüfen, verschlüsselt speichern, Daten abrufen, Diagnose). `_lib.js`/`_garmin-map.js` = Helfer.
* `supabase/migrations` – Schema + Zeilenschutz; `supabase/tests` – Prüfung gegen lokales Postgres.
* `tools/` – Garmin-Export-Skript (Fallback) und archivierte inoffizielle Garmin-Anbindung.

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

* **Garmin:** Pfade stammen aus der Swagger-Übersicht der Personal API; Query-Parameter und Feldnamen der Antworten sind aus dem bekannten Garmin-Connect-Datenmodell abgeleitet und **noch nicht gegen einen echten Account bestätigt**. Der Mapper liest tolerant, der Diagnose-Button im Profil zeigt die echte Struktur. **Nutzungsbedingungen:** Garmin bietet die Personal API für den *persönlichen Gebrauch* an und schließt kommerzielle Anwendungen mit mehreren Endnutzern aus – diese App ist für private, nicht-kommerzielle Nutzung gedacht (Kreis: du/Familie). Für einen öffentlichen Dienst wäre das Garmin Connect Developer Program nötig. Keys laufen nach 30/90/180/365 Tagen ab; die Access-Tokens (24 h) holt die App bei jedem Sync neu.
* **Kostenlose KI:** Kontingente und Modelle der Anbieter ändern sich; bei Ausfall/Limit arbeitet der Coach regelbasiert weiter.
* **Medizinisch:** Die App ersetzt keine Untersuchung oder Freigabe durch Arzt/Sportphysio. Im Wiedereinstiegs-Modus wird nur bei dokumentiertem Schmerzwert gesteigert.
