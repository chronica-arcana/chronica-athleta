"""ARCHIV / Referenz (nicht Teil des Vercel-Deployments): Garmin-Connect-Anbindung über die INOFFIZIELLE Bibliothek.

Ersetzt durch die offizielle Garmin Personal API (Key statt Passwort). Bleibt hier für Self-Hosting/Tests erhalten;
es ist bewusst nicht unter api/, damit Vercel kein Python-Projekt erkennt.

Ursprünglich: Vercel-Funktion: Garmin-Connect-Anbindung pro Nutzerkonto.

Jeder Nutzer trägt seine EIGENEN Garmin-Zugangsdaten im eigenen Konto ein. Das Passwort wird nur einmal für den
Login an Garmin verwendet und nie gespeichert. Gespeichert werden ausschließlich Zugriffs-Token, verschlüsselt (Fernet)
mit einem Server-Schlüssel, in einer Tabelle, die der Browser nicht lesen kann (siehe supabase/migrations).
Es wird die inoffizielle Bibliothek `garminconnect` genutzt (Garmin bietet Privatpersonen keine offene API).

Aktionen (POST JSON, Header Authorization: Bearer <Supabase-JWT>):
  connect {email, password} -> {status: connected | mfa_required}
  mfa {code}                -> {status: connected}
  sync {days}               -> {activities, daily}
  status                    -> {status, last_sync_at, last_error}
  disconnect                -> {ok: true}

Umgebungsvariablen: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GARMIN_ENC_KEY (Fernet-Key)
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler

MIN_SYNC_SECONDS = 120
MAX_DAYS = 45


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------- kleine HTTP-Helfer ----------
def _http(method, url, headers=None, body=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, None


class Supabase:
    """Minimaler PostgREST-Client mit Service-Key (umgeht RLS – darum nur serverseitig und immer mit user_id-Filter)."""

    def __init__(self, env=os.environ):
        self.url = env.get("SUPABASE_URL", "").rstrip("/")
        self.anon = env.get("SUPABASE_ANON_KEY", "")
        self.svc = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not (self.url and self.anon and self.svc):
            raise ApiError(503, "Server nicht konfiguriert (Supabase).")

    def _h(self, extra=None):
        return {"apikey": self.svc, "authorization": f"Bearer {self.svc}", **(extra or {})}

    def user_id(self, token):
        status, body = _http("GET", f"{self.url}/auth/v1/user", {"apikey": self.anon, "authorization": f"Bearer {token}"}, timeout=8)
        return body.get("id") if status == 200 and isinstance(body, dict) else None

    def get_link(self, uid):
        status, body = _http("GET", f"{self.url}/rest/v1/garmin_links?user_id=eq.{uid}&select=*", self._h())
        return body[0] if status == 200 and body else None

    def save_link(self, uid, fields):
        row = {"user_id": uid, "updated_at": datetime.now(timezone.utc).isoformat(), **fields}
        status, _ = _http("POST", f"{self.url}/rest/v1/garmin_links?on_conflict=user_id", self._h({"prefer": "resolution=merge-duplicates"}), row)
        if status >= 300:
            raise ApiError(502, "Speichern fehlgeschlagen.")

    def delete_link(self, uid):
        _http("DELETE", f"{self.url}/rest/v1/garmin_links?user_id=eq.{uid}", self._h())

    def upsert(self, table, rows, conflict):
        for i in range(0, len(rows), 200):
            status, _ = _http("POST", f"{self.url}/rest/v1/{table}?on_conflict={conflict}", self._h({"prefer": "resolution=merge-duplicates"}), rows[i:i + 200], timeout=30)
            if status >= 300:
                raise ApiError(502, "Speichern der Garmin-Daten fehlgeschlagen.")


def make_fernet(env=os.environ):
    from cryptography.fernet import Fernet
    key = env.get("GARMIN_ENC_KEY", "")
    if not key:
        raise ApiError(503, "Server nicht konfiguriert (GARMIN_ENC_KEY).")
    return Fernet(key.encode())


# ---------- Garmin-Daten normalisieren ----------
def _pick(d, *path):
    for k in path:
        if isinstance(d, dict):
            d = d.get(k)
        elif isinstance(d, list) and isinstance(k, int) and len(d) > k:
            d = d[k]
        else:
            return None
    return d


def _num(v, n=1):
    try:
        return None if v is None else round(float(v), n)
    except (TypeError, ValueError):
        return None


def activity_row(uid, a):
    start = str(a.get("startTimeLocal") or "")
    data = {
        "start": start[11:16], "type": (_pick(a, "activityType", "typeKey") or "").lower(), "name": str(a.get("activityName") or "")[:80],
        "durationMin": _num((a.get("duration") or 0) / 60), "distanceKm": _num((a.get("distance") or 0) / 1000, 2),
        "avgHr": _num(a.get("averageHR"), 0), "maxHr": _num(a.get("maxHR"), 0), "calories": _num(a.get("calories"), 0),
        "aerobicTE": _num(a.get("aerobicTrainingEffect")), "anaerobicTE": _num(a.get("anaerobicTrainingEffect")), "trainingLoad": _num(a.get("activityTrainingLoad"), 0),
    }
    return {"user_id": uid, "id": str(a.get("activityId")), "date": start[:10], "data": data}


def daily_data(client, iso):
    row = {}
    try:
        sleep = client.get_sleep_data(iso)
        secs = _pick(sleep, "dailySleepDTO", "sleepTimeSeconds")
        row["sleepHours"] = _num(secs / 3600, 2) if secs else None
        row["sleepScore"] = _pick(sleep, "dailySleepDTO", "sleepScores", "overall", "value")
    except Exception:
        pass
    try:
        hrv = client.get_hrv_data(iso)
        row["hrvAvg"] = _pick(hrv, "hrvSummary", "lastNightAvg")
        row["hrvStatus"] = _pick(hrv, "hrvSummary", "status")
    except Exception:
        pass
    try:
        stats = client.get_stats(iso)
        row["restingHr"] = stats.get("restingHeartRate")
        row["stressAvg"] = stats.get("averageStressLevel")
        row["bodyBatteryMorning"] = stats.get("bodyBatteryMostRecentValue") or stats.get("bodyBatteryHighestValue")
    except Exception:
        pass
    return row


# ---------- Aktionen ----------
def _clean_err(e, *secrets):
    """Nie Rohtext der Bibliothek speichern/ausgeben (kann Zugangsdaten enthalten): nur Fehlerklasse + HTTP-Code."""
    msg = str(e)
    for sec in secrets:
        if sec:
            msg = msg.replace(sec, "")
    codes = re.findall(r"\b(?:401|403|429|5\d\d)\b", msg)
    return e.__class__.__name__ + (f" ({codes[0]})" if codes else "")


def action_connect(uid, body, sb, fernet, Garmin):
    email, password = str(body.get("email") or "").strip(), str(body.get("password") or "")
    if not (3 <= len(email) <= 200 and 1 <= len(password) <= 200):
        raise ApiError(400, "E-Mail und Passwort angeben.")
    try:
        g = Garmin(email, password, return_on_mfa=True)
        status, state = g.login()
    except Exception as e:  # Zugangsdaten falsch, Garmin blockiert, Netzwerk …
        sb.save_link(uid, {"status": "error", "last_error": _clean_err(e, password, email)})
        raise ApiError(401, "Garmin-Anmeldung fehlgeschlagen. Zugangsdaten prüfen (bei Blockierung später erneut versuchen).")
    if status == "needs_mfa":
        sb.save_link(uid, {"status": "mfa_pending", "mfa_cipher": fernet.encrypt(json.dumps(state).encode()).decode(), "token_cipher": None, "last_error": None})
        return {"status": "mfa_required"}
    sb.save_link(uid, {"status": "connected", "token_cipher": fernet.encrypt(g.client.dumps().encode()).decode(), "mfa_cipher": None, "last_error": None})
    return {"status": "connected"}


def action_mfa(uid, body, sb, fernet, Garmin):
    code = re.sub(r"\D", "", str(body.get("code") or ""))
    link = sb.get_link(uid)
    if not link or link.get("status") != "mfa_pending" or not link.get("mfa_cipher"):
        raise ApiError(409, "Keine offene Bestätigung – bitte neu verbinden.")
    if not (4 <= len(code) <= 8):
        raise ApiError(400, "Bestätigungscode eingeben.")
    state = json.loads(fernet.decrypt(link["mfa_cipher"].encode()))
    try:
        g = Garmin()
        g.resume_login(state, code)
    except Exception as e:
        sb.save_link(uid, {"status": "error", "mfa_cipher": None, "last_error": _clean_err(e)})
        raise ApiError(401, "Bestätigungscode ungültig oder abgelaufen – bitte neu verbinden.")
    sb.save_link(uid, {"status": "connected", "token_cipher": fernet.encrypt(g.client.dumps().encode()).decode(), "mfa_cipher": None, "last_error": None})
    return {"status": "connected"}


def action_sync(uid, body, sb, fernet, Garmin, now=None):
    link = sb.get_link(uid)
    if not link or link.get("status") != "connected" or not link.get("token_cipher"):
        raise ApiError(409, "Garmin ist nicht verbunden.")
    now = now or datetime.now(timezone.utc)
    last = link.get("last_sync_at")
    if last:
        try:
            if (now - datetime.fromisoformat(str(last).replace("Z", "+00:00"))).total_seconds() < MIN_SYNC_SECONDS:
                raise ApiError(429, "Bitte kurz warten – es wurde gerade synchronisiert.")
        except ValueError:
            pass
    try:
        days = max(1, min(MAX_DAYS, int(body.get("days") or 14)))
    except (TypeError, ValueError):
        days = 14
    tokens = fernet.decrypt(link["token_cipher"].encode()).decode()
    try:
        g = Garmin()
        g.login(tokenstore=tokens)
    except Exception as e:
        sb.save_link(uid, {"status": "error", "last_error": _clean_err(e)})
        raise ApiError(401, "Garmin-Sitzung abgelaufen – bitte erneut verbinden.")
    end = now.date()
    start = end - timedelta(days=days)
    acts = [activity_row(uid, a) for a in (g.get_activities_by_date(start.isoformat(), end.isoformat()) or []) if a.get("activityId") and a.get("startTimeLocal")]
    isos = [(start + timedelta(days=i)).isoformat() for i in range(days + 1)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda iso: (iso, daily_data(g, iso)), isos))
    daily = [{"user_id": uid, "date": iso, "data": d} for iso, d in results if any(v is not None for v in d.values())]
    if acts:
        sb.upsert("garmin_activities", acts, "user_id,id")
    if daily:
        sb.upsert("garmin_daily", daily, "user_id,date")
    fields = {"status": "connected", "last_sync_at": now.isoformat(), "last_error": None}
    try:  # ggf. erneuerte Token zurückschreiben
        fresh = g.client.dumps()
        if fresh != tokens:
            fields["token_cipher"] = fernet.encrypt(fresh.encode()).decode()
    except Exception:
        pass
    sb.save_link(uid, fields)
    return {"activities": len(acts), "daily": len(daily)}


def action_status(uid, body, sb, fernet, Garmin):
    link = sb.get_link(uid) or {}
    return {"status": link.get("status") or "none", "last_sync_at": link.get("last_sync_at"), "last_error": link.get("last_error")}


def action_disconnect(uid, body, sb, fernet, Garmin):
    sb.delete_link(uid)
    return {"ok": True}


ACTIONS = {"connect": action_connect, "mfa": action_mfa, "sync": action_sync, "status": action_status, "disconnect": action_disconnect}


def handle(body, token, sb=None, fernet=None, Garmin=None):
    """Reine Funktion (testbar): gibt (status, dict) zurück."""
    try:
        action = (body or {}).get("action")
        if action not in ACTIONS:
            return 400, {"error": "Unbekannte Aktion."}
        sb = sb or Supabase()
        uid = sb.user_id(token) if token else None
        if not uid:
            return 401, {"error": "Bitte anmelden."}
        fernet = fernet or make_fernet()
        if Garmin is None:
            from garminconnect import Garmin  # noqa: PLC0415 (nur bei Bedarf importieren)
        return 200, ACTIONS[action](uid, body, sb, fernet, Garmin)
    except ApiError as e:
        return e.status, {"error": e.message}
    except Exception as e:  # nie Details/Zugangsdaten nach außen geben
        return 500, {"error": "Interner Fehler."}


def _token_from(auth):
    return auth[7:].strip() if auth.startswith("Bearer ") else ""


def app(environ, start_response):
    """WSGI-Einstiegspunkt (neuere Vercel-Python-Laufzeit erwartet eine Variable `app`)."""
    def respond(status, body):
        raw = json.dumps(body).encode()
        start_response(f"{status} {HTTPStatus(status).phrase}", [("content-type", "application/json; charset=utf-8"), ("cache-control", "no-store"), ("content-length", str(len(raw)))])
        return [raw]

    if environ.get("REQUEST_METHOD") != "POST":
        return respond(405, {"error": "Nur POST."})
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
        if length > 10000:
            return respond(413, {"error": "Anfrage zu groß."})
        body = json.loads(environ["wsgi.input"].read(length) or b"{}")
    except Exception:
        return respond(400, {"error": "Ungültige Anfrage."})
    status, out = handle(body, _token_from(environ.get("HTTP_AUTHORIZATION", "")))
    return respond(status, out)


class handler(BaseHTTPRequestHandler):
    """Klassischer Einstiegspunkt (ältere Vercel-Python-Laufzeit)."""

    def _send(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        try:
            length = int(self.headers.get("content-length") or 0)
            if length > 10000:
                return self._send(413, {"error": "Anfrage zu groß."})
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._send(400, {"error": "Ungültige Anfrage."})
        status, out = handle(body, _token_from(self.headers.get("authorization", "")))
        self._send(status, out)

    def do_GET(self):
        self._send(405, {"error": "Nur POST."})
