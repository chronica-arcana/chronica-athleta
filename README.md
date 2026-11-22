# Football Training Tracker v7

## GitHub Pages
Lade **index.html**, **app.js**, **coach.js** und optional **styles.css** direkt in denselben Ordner deines GitHub-Pages-Repositories (normalerweise Repository-Root). Nicht nur die ZIP-Datei hochladen.

Die Seite zeigt Woche 1 nun bereits ohne JavaScript als Fallback an. Sobald `app.js` korrekt geladen wird, erscheint oberhalb der Wochenbuttons der Hinweis `✓ JavaScript aktiv · Speicherung aktiv`. Dann funktionieren Wochenwechsel, Eingaben und lokale Speicherung.

## Speicherung
Eingaben werden bei jeder Änderung in `localStorage` unter `football_training_tracker_v6` gespeichert. Frühere Daten aus v1-v3 werden weiterhin übernommen. Speicherung gilt pro Browser/Gerät und ist keine Cloud-Synchronisation.

## Garmin-Daten & KI-Coach (v8)

Nach jeder Einheit auf **„🤖 Training abschließen & Empfehlung“** klicken. Der Coach wertet Sätze, RPE, Schmerz (0–10) und – falls importiert – Garmin-Daten aus und zeigt pro Übung, was beim nächsten Mal geändert werden sollte (mehr Gewicht, mehr Wiederholungen, halten, reduzieren). Die Empfehlungen werden als **🎯 Ziel** in die folgenden Wochen des Plans eingeblendet (Platzhalter in den Eingabefeldern), Lauf-/Rad-Umfang und Satzanzahl der nächsten Einheit werden bei Bedarf automatisch angepasst. Auswertungen und Anpassungen lassen sich im Bereich „Garmin & KI-Coach“ zurücksetzen.

**Regeln (immer aktiv, auch mit KI):** Doppelte Progression (erst alle Sätze am oberen Wdh.-Ende, dann +2,5–5 % Gewicht). Keine Steigerung bei Schmerz ≥2, Beschwerden in den Notizen, RPE ≥8, fehlendem Schmerzwert oder auffälligen Garmin-Werten (Schlaf <6 h, HRV-Status LOW/UNBALANCED, Ruhepuls +5, Body Battery <30, sehr hoher Trainingseffekt). Entlastung bei Schmerz ≥4 oder RPE ≥9. Adduktorübungen nur bei Schmerz 0 und RPE ≤6. KI-Vorschläge werden auf diese Grenzen (max. +10 % Gewicht) begrenzt. Das ist keine medizinische Freigabe.

### Garmin importieren
Garmin hat keine offene persönliche Browser-API (die offizielle Health/Activity API ist nur für freigegebene Entwickler). Deshalb:

```bash
pip install garminconnect          # inoffiziell, nutzt deinen Garmin-Login
export GARMIN_EMAIL="…" GARMIN_PASSWORD="…"
python garmin_sync.py --days 120 --out garmin_data.json
```
Die Datei in der App unter „Garmin & KI-Coach“ importieren. **Nicht in ein öffentliches Repo committen** (Gesundheitsdaten; `garmin_data.json` steht in `.gitignore`). Das Skript wurde nicht gegen einen echten Garmin-Account getestet; Feldnamen der inoffiziellen API können sich ändern.

### KI-Empfehlungen (optional)
Anthropic-API-Key im Bereich „Garmin & KI-Coach“ eintragen. Der Key bleibt in diesem Browser (`localStorage`); beim Auswerten werden Trainings- und Garmin-Daten direkt an die Anthropic-API gesendet. Ohne Key arbeitet die App rein regelbasiert.
