import json, sys, unittest, os
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.dirname(__file__))
import garmin_api as G
from cryptography.fernet import Fernet

class FakeSB:
    def __init__(self): self.link = None; self.rows = {}; self.saved = []
    def user_id(self, token): return "u1" if token == "good" else None
    def get_link(self, uid): return self.link
    def save_link(self, uid, fields): self.saved.append(fields); self.link = {**(self.link or {}), "user_id": uid, **fields}
    def delete_link(self, uid): self.link = None
    def upsert(self, table, rows, conflict): self.rows.setdefault(table, []).extend(rows)

class FakeClient:
    def __init__(self): self.tok = '{"di_token":"T1"}'
    def dumps(self): return self.tok

class FakeGarmin:
    mfa = False; fail_login = False; PASSWORD_SEEN = None
    def __init__(self, email=None, password=None, return_on_mfa=False):
        FakeGarmin.PASSWORD_SEEN = password; self.client = FakeClient(); self.return_on_mfa = return_on_mfa
    def login(self, tokenstore=None):
        if FakeGarmin.fail_login: raise RuntimeError("401 bad password hunter2")
        if tokenstore: return None, None
        return ("needs_mfa", {"cookies": "x"}) if FakeGarmin.mfa else (None, None)
    def resume_login(self, state, code):
        if code != "123456": raise RuntimeError("bad code")
        return None, None
    def get_activities_by_date(self, a, b):
        return [{"activityId": 1, "startTimeLocal": f"{b} 07:30:00", "activityName": "Morgenlauf", "activityType": {"typeKey": "Running"}, "duration": 2700, "distance": 8000, "averageHR": 150, "aerobicTrainingEffect": 3.1}, {"startTimeLocal": "x"}]
    def get_sleep_data(self, iso): return {"dailySleepDTO": {"sleepTimeSeconds": 27000, "sleepScores": {"overall": {"value": 80}}}}
    def get_hrv_data(self, iso): return {"hrvSummary": {"lastNightAvg": 55, "status": "BALANCED"}}
    def get_stats(self, iso): return {"restingHeartRate": 51, "bodyBatteryMostRecentValue": 70}

class T(unittest.TestCase):
    def setUp(self):
        self.sb, self.f = FakeSB(), Fernet(Fernet.generate_key()); FakeGarmin.mfa = False; FakeGarmin.fail_login = False
    def call(self, body, token="good"): return G.handle(body, token, self.sb, self.f, FakeGarmin)

    def test_auth_required(self):
        self.assertEqual(self.call({"action": "status"}, token="")[0], 401)
        self.assertEqual(self.call({"action": "status"}, token="bad")[0], 401)
        self.assertEqual(self.call({"action": "evil"})[0], 400)

    def test_connect_stores_only_encrypted_tokens_never_password(self):
        st, out = self.call({"action": "connect", "email": "a@b.de", "password": "hunter2"})
        self.assertEqual((st, out), (200, {"status": "connected"}))
        blob = json.dumps(self.sb.saved)
        self.assertNotIn("hunter2", blob); self.assertNotIn("T1", blob)      # kein Klartext
        self.assertEqual(self.f.decrypt(self.sb.link["token_cipher"].encode()), b'{"di_token":"T1"}')
        self.assertNotIn("token", json.dumps(out))

    def test_login_failure_does_not_leak_password(self):
        FakeGarmin.fail_login = True
        st, out = self.call({"action": "connect", "email": "a@b.de", "password": "hunter2"})
        self.assertEqual(st, 401); self.assertNotIn("hunter2", json.dumps(out) + json.dumps(self.sb.saved))

    def test_mfa_flow(self):
        FakeGarmin.mfa = True
        self.assertEqual(self.call({"action": "connect", "email": "a@b.de", "password": "x"})[1], {"status": "mfa_required"})
        self.assertEqual(self.sb.link["status"], "mfa_pending"); self.assertNotIn("cookies", json.dumps(self.sb.link))
        self.assertEqual(self.call({"action": "mfa", "code": "000000"})[0], 401)
        FakeGarmin.mfa = True; self.call({"action": "connect", "email": "a@b.de", "password": "x"})
        self.assertEqual(self.call({"action": "mfa", "code": "123456"}), (200, {"status": "connected"}))
        self.assertIsNone(self.sb.link["mfa_cipher"])

    def test_sync_maps_and_stores_rows(self):
        self.call({"action": "connect", "email": "a@b.de", "password": "x"})
        st, out = self.call({"action": "sync", "days": 3})
        self.assertEqual(st, 200); self.assertEqual(out["activities"], 1); self.assertEqual(out["daily"], 4)
        a = self.sb.rows["garmin_activities"][0]
        self.assertEqual((a["user_id"], a["id"], a["data"]["type"], a["data"]["durationMin"], a["data"]["distanceKm"]), ("u1", "1", "running", 45.0, 8.0))
        d = self.sb.rows["garmin_daily"][0]; self.assertEqual((d["data"]["sleepHours"], d["data"]["restingHr"], d["data"]["hrvStatus"]), (7.5, 51, "BALANCED"))
        self.assertTrue(all(r["user_id"] == "u1" for rows in self.sb.rows.values() for r in rows))

    def test_sync_requires_connection_and_throttles(self):
        self.assertEqual(self.call({"action": "sync"})[0], 409)
        self.call({"action": "connect", "email": "a@b.de", "password": "x"})
        self.call({"action": "sync", "days": 1})
        self.assertEqual(self.call({"action": "sync", "days": 1})[0], 429)

    def test_disconnect_deletes_tokens(self):
        self.call({"action": "connect", "email": "a@b.de", "password": "x"})
        self.assertEqual(self.call({"action": "disconnect"}), (200, {"ok": True})); self.assertIsNone(self.sb.link)

class WSGI(unittest.TestCase):
    def call(self, method="POST", body=b"{}", auth=""):
        from io import BytesIO
        out = {}
        env = {"REQUEST_METHOD": method, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": auth}
        res = G.app(env, lambda status, headers: out.update(status=status, headers=dict(headers)))
        return out["status"], json.loads(b"".join(res)), out["headers"]

    def test_wsgi_entrypoint(self):
        self.assertEqual(self.call("GET")[0], "405 Method Not Allowed")
        self.assertEqual(self.call(body=b"nope")[0], "400 Bad Request")
        self.assertEqual(self.call(body=b"x" * 20000)[0], "413 Content Too Large" if hasattr(__import__("http").HTTPStatus, "CONTENT_TOO_LARGE") else "413 Request Entity Too Large")
        st, out, h = self.call(body=json.dumps({"action": "evil"}).encode())
        self.assertEqual((st, out["error"], h["cache-control"]), ("400 Bad Request", "Unbekannte Aktion.", "no-store"))
        self.assertTrue(callable(G.handler) and callable(G.app))

if __name__ == "__main__": unittest.main()
