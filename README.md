# Football Training Tracker v7

## GitHub Pages
Lade **index.html**, **app.js** und optional **styles.css** direkt in denselben Ordner deines GitHub-Pages-Repositories (normalerweise Repository-Root). Nicht nur die ZIP-Datei hochladen.

Die Seite zeigt Woche 1 nun bereits ohne JavaScript als Fallback an. Sobald `app.js` korrekt geladen wird, erscheint oberhalb der Wochenbuttons der Hinweis `✓ JavaScript aktiv · Speicherung aktiv`. Dann funktionieren Wochenwechsel, Eingaben und lokale Speicherung.

## Speicherung
Eingaben werden bei jeder Änderung in `localStorage` unter `football_training_tracker_v6` gespeichert. Frühere Daten aus v1-v3 werden weiterhin übernommen. Speicherung gilt pro Browser/Gerät und ist keine Cloud-Synchronisation.
