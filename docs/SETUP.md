# Einrichtung (alles kostenlos, ca. 20 Minuten)

Du brauchst: ein GitHub-Konto (Repo existiert), ein [Supabase](https://supabase.com)-Konto, ein [Vercel](https://vercel.com)-Konto (Hobby) und einen kostenlosen KI-Schlüssel (z. B. [Groq](https://console.groq.com)).

## 1. Supabase (Konten + Datenbank)

1. **New project** anlegen (Region EU, Datenbank-Passwort merken).
2. **SQL Editor → New query**: Inhalt von `supabase/migrations/20261123000000_init.sql` einfügen → **Run**.
3. **Project Settings → API**: notiere
   * `Project URL` → `SUPABASE_URL`
   * `anon public` Key → `SUPABASE_ANON_KEY` (öffentlich, darf in `config.js`)
   * `service_role` Key → `SUPABASE_SERVICE_ROLE_KEY` (**geheim**, nur in Vercel!)
4. **Authentication → Providers → Email**: aktiviert lassen. Für den Privatgebrauch kannst du „Confirm email“ ausschalten (der Standard-Mailversand hat ein sehr kleines Stundenlimit); sonst eigenen SMTP eintragen.
5. **Authentication → URL Configuration**: *Site URL* und *Redirect URLs* = deine spätere Vercel-Adresse (für Bestätigungs-/Passwort-Mails).

## 2. KI-Schlüssel (kostenlos)

Standard ist **Groq** (OpenAI-kompatibel, kostenloses Kontingent): Schlüssel unter console.groq.com → API Keys → `AI_API_KEY`.
Alternativen (nur Variablen ändern):

| Anbieter | `AI_BASE_URL` | `AI_MODEL` (Beispiel) |
|---|---|---|
| Groq (Standard) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| OpenRouter | `https://openrouter.ai/api/v1` | ein Modell mit Endung `:free` |

Kontingente/Modelle ändern sich – bitte beim Anbieter prüfen. Ohne KI-Schlüssel funktioniert alles, der Coach arbeitet dann regelbasiert.

## 3. Vercel (Hosting + serverlose Funktionen)

1. **Add New → Project** → GitHub-Repo importieren. Framework „Other“, kein Build-Befehl.
2. **Environment Variables** setzen:

| Variable | Wert |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon public Key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role Key (geheim) |
| `AI_API_KEY` | KI-Schlüssel |
| `GARMIN_ENC_KEY` | siehe unten (Fernet-Schlüssel) |
| optional `AI_BASE_URL`, `AI_MODEL`, `AI_DAILY_LIMIT` (Standard 60/Tag/Nutzer) | |

   Schlüssel erzeugen:
   ```bash
   python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
   **Sichere `GARMIN_ENC_KEY`!** Geht er verloren, müssen alle Nutzer Garmin neu verbinden.
3. `config.js` im Repo ausfüllen (nur **öffentliche** Werte) und pushen:
   ```js
   window.TT_CONFIG = { supabaseUrl: "https://xyz.supabase.co", supabaseAnonKey: "<anon key>", apiBase: "" };
   ```
4. Deploy. Öffne die Vercel-Adresse → registrieren → Wizard. Auf dem Handy: „Zum Home-Bildschirm hinzufügen“.

`vercel.json` setzt längere Laufzeiten für die Funktionen (KI 30 s, Garmin 60 s). Auf dem Hobby-Plan gelten Obergrenzen von Vercel.

## 4. Garmin verbinden (jeder Nutzer für sich)

Profil → **Garmin Connect** → eigene Garmin-E-Mail + Passwort → *Verbinden* (ggf. MFA-Code). Das Passwort wird nur einmal an Garmin gesendet und **nicht gespeichert**; gespeichert werden nur Token, verschlüsselt mit `GARMIN_ENC_KEY` in einer Tabelle, die der Browser nicht lesen kann.
Blockiert Garmin den Login vom Server (Fehler 401/429), nutze den Fallback:

```bash
pip install garminconnect
export GARMIN_EMAIL="…" GARMIN_PASSWORD="…"
python tools/garmin_export.py --days 90 --out garmin_data.json
```
und importiere `garmin_data.json` im Profil („Export-Datei importieren“).

## Betrieb & Datenschutz

* Jede Tabelle hat Row Level Security – Nutzer sehen/ändern nur eigene Zeilen (`supabase/tests/run-local.sh` prüft das gegen Postgres).
* Beim Auswerten werden Trainings-/Garmin-Daten an den gewählten KI-Anbieter gesendet; die Prompts liegen serverseitig in `api/ai.js`.
* Supabase-Free-Projekte können nach längerer Inaktivität pausieren (im Dashboard wieder aktivieren).
* Konto löschen im Profil entfernt Konto und alle Daten (CASCADE). Export als JSON ebenfalls im Profil.
* Der alte Fußball-Tracker liegt unter `/legacy/` und nutzt weiter seine lokalen Browserdaten.
