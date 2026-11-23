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
| `GARMIN_ENC_KEY` | 32 zufällige Bytes, base64 – erzeugen mit `openssl rand -base64 32` |
| optional `AI_BASE_URL`, `AI_MODEL`, `AI_DAILY_LIMIT` (Standard 60/Tag/Nutzer) | |

3. `config.js` im Repo ausfüllen (nur **öffentliche** Werte) und pushen:
   ```js
   window.TT_CONFIG = { supabaseUrl: "https://xyz.supabase.co", supabaseAnonKey: "<anon key>", apiBase: "" };
   ```
4. Deploy. Öffne die Vercel-Adresse → registrieren → Wizard. Auf dem Handy: „Zum Home-Bildschirm hinzufügen“.

`vercel.json` setzt eine längere Laufzeit für die KI-Funktion (30 s). Auf dem Hobby-Plan gelten Obergrenzen von Vercel.
Framework-Preset in Vercel: **Other**, kein Build-Befehl. Im Hauptordner darf **keine** `requirements.txt`/`pyproject.toml` liegen (sonst erkennt Vercel ein Python-Projekt).

## 4. Garmin (jeder Nutzer für sich)

**Voraussetzung:** `GARMIN_ENC_KEY` in Vercel gesetzt (`openssl rand -base64 32`) und danach **Redeploy**. **Sichere den Schlüssel** – geht er verloren, müssen alle Nutzer ihren Key neu eintragen. Prüfen: `https://DEINE-ADRESSE/api/garmin` zeigt `"encKey":true`.

**Key erzeugen (jeder Nutzer in seinem Garmin-Connect-Web-Account):**
1. Seite **Personal API Key** öffnen → **Create Key** → Bedingungen akzeptieren.
2. Ablaufdauer wählen → **Create**. Der Key wird **nur einmal** angezeigt: kopieren.
3. In der App: Profil → Garmin Connect → Key einfügen → **Verbinden**.

Die App tauscht den Key gegen ein Access-Token (Garmin-Endpunkt `personalapitoken-service`), speichert den Key mit AES-256-GCM verschlüsselt in einer Tabelle, die der Browser nicht lesen kann, und gibt ihn nie zurück. Trennen löscht ihn.

**Stand und Fehlersuche:** Verbinden, Prüfen, Speichern, Trennen und der Datenabruf sind gebaut und mit einem nachgebauten Garmin-Server getestet. Die Query-Parameter und Feldnamen der echten Antworten sind **noch nicht bestätigt**. Zeigt „Jetzt synchronisieren“ „Nicht abrufbar: … (HTTP …)“ oder 0 Aktivitäten, tippe im Profil auf **Diagnose** und schick die Ausgabe (nur Feldnamen, keine Werte) – damit lässt sich der Abruf gezielt korrigieren.

**Hinweise zur Personal API:** Sie ist für den *persönlichen Gebrauch* gedacht (kein kommerzieller Dienst für viele Nutzer). Keys laufen nach 30/90/180/365 Tagen ab (Garmin mailt eine Woche vorher); abgelaufene Keys erkennt die App und bittet um einen neuen. Zugriffs-Token gelten 24 h, die App holt bei jedem Sync ein neues.

**Ohne Personal API (Fallback): Datei-Import**

```bash
pip install garminconnect
export GARMIN_EMAIL="…" GARMIN_PASSWORD="…"
python tools/garmin_export.py --days 90 --out garmin_data.json
```
Profil → Garmin → „Export-Datei importieren“.

## Betrieb & Datenschutz

* Jede Tabelle hat Row Level Security – Nutzer sehen/ändern nur eigene Zeilen (`supabase/tests/run-local.sh` prüft das gegen Postgres).
* Beim Auswerten werden Trainings-/Garmin-Daten an den gewählten KI-Anbieter gesendet; die Prompts liegen serverseitig in `api/ai.js`.
* Supabase-Free-Projekte können nach längerer Inaktivität pausieren (im Dashboard wieder aktivieren).
* Konto löschen im Profil entfernt Konto und alle Daten (CASCADE). Export als JSON ebenfalls im Profil.
* Der alte Fußball-Tracker liegt unter `/legacy/` und nutzt weiter seine lokalen Browserdaten.
