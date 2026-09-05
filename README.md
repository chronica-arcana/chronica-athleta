# Fußball-Wiedereinstieg · Trainings-Tracker

GitHub-Pages-taugliche, lokale Web-App für den Wiedereinstieg von September 2026 bis Januar 2027.

## Dateien
- `index.html` – Oberfläche
- `styles.css` – separates, responsives Design
- `app.js` – 17-Wochen-Plan, Eingaben, lokale Speicherung und automatische Belastungssteuerung

## GitHub Pages
Repository öffentlich anlegen → Dateien ins Repository-Root hochladen → **Settings → Pages → Deploy from a branch → main → / (root) → Save**.

## Planlogik
Der Plan ist kriteriumsorientiert und bewusst konservativ für eine Verletzung im rechten Hüft-/Oberschenkelbereich. Die genaue betroffene Struktur ist nicht diagnostisch festgelegt; deshalb darf eine Progression nicht als individuelle medizinische Freigabe verstanden werden.

- Wochen 1–3: Belastbarkeit und Grundlagenausdauer
- Wochen 4–7: Kraftbasis und einbeinige Kontrolle
- Wochen 8–11: Kraft-/Laufkapazität und kontrollierte schnellere Abschnitte
- Wochen 12–14: Beschleunigung, Bremsen, seitliche Kontrolle und Koordination
- Wochen 15–17: Return-to-Football-Vorbereitung; Einstieg ins Mannschaftstraining im Januar nur bei stabiler Verträglichkeit und ärztlich/sportphysiotherapeutischer Freigabe

## Eingaben
- Trainingsdatum wird einmal pro Einheit erfasst.
- Kraftübungen werden satzweise dokumentiert.
- Bei Gewichtsübungen kann das Gewicht in jedem Satz unterschiedlich eingetragen werden.
- Zeitübungen verwenden Dauer statt Gewicht/Wiederholungen.
- RPE 1–10 wird pro Einheit erfasst.
- Zusatztrainings werden der ausgewählten Woche als eigener Reiter hinzugefügt.
- Yoga hat in jeder Woche einen eigenen Reiter.

## Automatische Belastungssteuerung
Die App nutzt die letzten vier dokumentierten Einheiten:
- **Grün:** bei guter Verträglichkeit und Ø RPE ≤ 5 kann eine Variable um etwa 10 % gesteigert werden.
- **Gelb:** bei Ø RPE ≥ 7 Belastung halten oder nur konservativ steigern.
- **Rot:** bei Ø RPE ≥ 8, mindestens zwei Einheiten mit RPE ≥ 8 oder dokumentierten Warnhinweisen wie Schmerz/Beschwerden: nächste Belastung ca. 25–30 % reduzieren und keine neuen intensiven/explosiven Reize hinzufügen.

Die automatische Logik ersetzt keine medizinische Beurteilung. Bei tatsächlichem Schmerz, Schwellung, Kraftverlust oder Hinken nicht automatisch steigern.

## Befundbezogene Anpassung

Der Trainingsplan berücksichtigt folgenden angegebenen Bildbefund: secondary cleft sign am rechten Os pubis im Bereich der Symphyse mit minimalem Ödem im Insertionsgebiet von M. rectus abdominis und Adduktoren. Das wird im Plan als Belastungsproblematik im Bereich Symphyse/pubische Aponeurose/Adduktoren behandelt, ohne aus dem MRT allein eine definitive klinische Diagnose abzuleiten.

Die Progression ist deshalb zunächst kraft- und lauforientiert mit niedriger Intensität, später mit geradlinigem schnellerem Laufen, anschließend Beschleunigung/Bremsen und erst spät Richtungswechseln und fußballspezifischen Reizen. Explosive Sprünge und stärkere Adduktorenbelastungen sind nach hinten verschoben und an Verträglichkeit bzw. medizinische Freigabe gekoppelt.


## Return-to-Football-Test

In Woche 17 gibt es einen eigenen Reiter für eine praxisnahe Return-to-Football-Testbatterie. Sie kombiniert: klinische Bereitschaft, Adduktoren-Squeeze, objektive Adduktionskraft (LSI), geradliniges Laufen, Beschleunigen/Bremsen, Illinois Agility Test, Spider Test, Sprünge/Landungen, Pass- und Kicking-Progression, reaktive Fußballaktionen sowie 2–3 kontrollierte fußballspezifische Einheiten. Die App zeigt erst dann „Kriterien erfüllt“, wenn die dokumentierten Kriterien vorliegen und die medizinische Beurteilung bestätigt wurde. Die Batterie ist keine medizinische Freigabe und kein einzelner validierter Test.

### RPE

RPE wird ausschließlich als subjektive Belastung der **gesamten Trainingseinheit** erfasst. Es gibt kein RPE pro Kraftsatz und kein RPE pro Zeitübung. Das Gesamt-RPE fließt in die automatische Belastungssteuerung ein.
