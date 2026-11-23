#!/usr/bin/env python3
"""FALLBACK: Holt Trainings- und Erholungsdaten aus Garmin Connect lokal auf DEINEM Rechner und schreibt garmin_data.json.

Normalerweise verbindest du Garmin direkt in der App (Profil → Garmin). Falls Garmin Logins vom Server blockiert,
nutze dieses Skript und importiere die Datei in der App (Profil → Garmin → Datei importieren).

Garmin bietet für Privatpersonen keine offene API (die offizielle Health/Activity API ist
nur für freigegebene Entwickler-Partner). Dieses Skript nutzt die inoffizielle Bibliothek
`garminconnect`, die sich wie die Garmin-Connect-Web-App mit deinem Account anmeldet.

Nutzung (lokal auf deinem Rechner):
    pip install garminconnect
    export GARMIN_EMAIL="du@example.com"
    export GARMIN_PASSWORD="..."
    python garmin_sync.py --days 120 --out garmin_data.json

Beim ersten Login werden Tokens in ~/.garminconnect gespeichert (kein erneutes Passwort nötig,
auch MFA wird abgefragt). Die erzeugte JSON-Datei importierst du in der App unter Profil → Garmin. Lege sie NICHT in ein öffentliches Repository: sie enthält Gesundheitsdaten.
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("Bitte zuerst installieren: pip install garminconnect")

TOKENSTORE = os.path.expanduser(os.environ.get("GARMINTOKENS", "~/.garminconnect"))


def login():
    try:  # gespeicherte Tokens wiederverwenden
        client = Garmin()
        client.login(TOKENSTORE)
        return client
    except Exception:
        pass
    email, password = os.environ.get("GARMIN_EMAIL"), os.environ.get("GARMIN_PASSWORD")
    if not email or not password:
        sys.exit("GARMIN_EMAIL und GARMIN_PASSWORD setzen (nur für den ersten Login nötig).")
    client = Garmin(email, password)
    client.login()
    try:
        client.garth.dump(TOKENSTORE)
    except Exception as err:  # Token-Cache ist optional
        print(f"Hinweis: Tokens nicht gespeichert ({err})", file=sys.stderr)
    return client


def pick(d, *path):
    """Sicherer verschachtelter Zugriff: pick(x, 'a', 'b') -> x['a']['b'] oder None."""
    for key in path:
        if isinstance(d, dict):
            d = d.get(key)
        elif isinstance(d, list) and isinstance(key, int) and len(d) > key:
            d = d[key]
        else:
            return None
    return d


def round_or_none(v, n=1):
    try:
        return None if v is None else round(float(v), n)
    except (TypeError, ValueError):
        return None


def activity_row(a):
    start = str(a.get("startTimeLocal") or "")
    return {
        "id": str(a.get("activityId")),
        "date": start[:10],
        "start": start[11:16],
        "type": pick(a, "activityType", "typeKey") or "",
        "name": a.get("activityName") or "",
        "durationMin": round_or_none((a.get("duration") or 0) / 60),
        "distanceKm": round_or_none((a.get("distance") or 0) / 1000, 2),
        "avgHr": round_or_none(a.get("averageHR"), 0),
        "maxHr": round_or_none(a.get("maxHR"), 0),
        "calories": round_or_none(a.get("calories"), 0),
        "aerobicTE": round_or_none(a.get("aerobicTrainingEffect")),
        "anaerobicTE": round_or_none(a.get("anaerobicTrainingEffect")),
        "trainingLoad": round_or_none(a.get("activityTrainingLoad"), 0),
    }


def daily_row(client, day):
    iso = day.isoformat()
    row = {"date": iso}
    try:
        sleep = client.get_sleep_data(iso)
        secs = pick(sleep, "dailySleepDTO", "sleepTimeSeconds")
        row["sleepHours"] = round_or_none(secs / 3600, 2) if secs else None
        row["sleepScore"] = pick(sleep, "dailySleepDTO", "sleepScores", "overall", "value")
    except Exception as err:
        print(f"{iso}: Schlaf nicht abrufbar ({err})", file=sys.stderr)
    try:
        hrv = client.get_hrv_data(iso)
        row["hrvAvg"] = pick(hrv, "hrvSummary", "lastNightAvg")
        row["hrvStatus"] = pick(hrv, "hrvSummary", "status")
    except Exception as err:
        print(f"{iso}: HRV nicht abrufbar ({err})", file=sys.stderr)
    try:
        stats = client.get_stats(iso)
        row["restingHr"] = stats.get("restingHeartRate")
        row["stressAvg"] = stats.get("averageStressLevel")
        row["bodyBatteryMorning"] = stats.get("bodyBatteryMostRecentValue") or stats.get("bodyBatteryHighestValue")
    except Exception as err:
        print(f"{iso}: Tageswerte nicht abrufbar ({err})", file=sys.stderr)
    return row


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=60, help="Wie viele Tage rückwirkend (Standard 60)")
    ap.add_argument("--out", default="garmin_data.json")
    args = ap.parse_args()

    client = login()
    end = date.today()
    start = end - timedelta(days=args.days)

    activities = [activity_row(a) for a in client.get_activities_by_date(start.isoformat(), end.isoformat())]
    daily = []
    day = start
    while day <= end:
        row = daily_row(client, day)
        if any(v is not None for k, v in row.items() if k != "date"):
            daily.append(row)
        day += timedelta(days=1)

    out = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "activities": activities, "daily": daily}
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"{len(activities)} Aktivitäten, {len(daily)} Tageswerte -> {args.out}")


if __name__ == "__main__":
    main()
