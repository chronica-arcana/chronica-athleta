# Fußball Training Tracker

Statische Web-App für GitHub Pages.

## Struktur

- `index.html` – Oberfläche
- `styles.css` – separates, responsives Design
- `app.js` – Tabs, lokale Speicherung, Zusatztrainings, Empfehlungen und automatische Belastungsbewertung

## GitHub Pages

1. Repository anlegen.
2. Die drei Dateien in den Repository-Root kopieren.
3. GitHub → Settings → Pages → Deployment from a branch.
4. Branch `main` und Ordner `/ (root)` wählen.
5. Speichern. GitHub Pages veröffentlicht anschließend `index.html`.

Die Trainingsdaten werden ausschließlich per `localStorage` im Browser gespeichert. Es gibt bewusst keine Import-/Export-Funktion.


## Automatische Belastungssteuerung

- **GRÜN:** normale Progression; bei Ø RPE ≤ 5 und mindestens zwei aktuellen Einheiten bis zu ca. 10 % mehr Umfang.
- **GELB:** bei Ø RPE 7 konservativ steigern bzw. Umfang zunächst halten.
- **ROT:** bei Ø RPE ≥ 8, mindestens zwei Einheiten mit RPE ≥ 8 oder dokumentierten Warnbegriffen ca. 25–30 % weniger Umfang und keine zusätzlichen intensiven/explosiven Reize.
- Es wird immer nur **eine Trainingsvariable** verändert.
- Beschwerden werden nicht medizinisch diagnostiziert; bei tatsächlichen Schmerzen/Verletzungszeichen Belastung nicht automatisch erhöhen.

Die Empfehlungsfunktion nutzt dieselbe Belastungsampel.
