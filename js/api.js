// Client für die serverlose KI-Funktion (/api/ai). Die Funktion prüft das Supabase-JWT.
const cfg = () => window.TT_CONFIG || {};
let adapterRef = null;
export const bindAdapter = a => { adapterRef = a; };

async function post(path, body) {
  const headers = {"content-type": "application/json"};
  const token = adapterRef && await adapterRef.accessToken();
  if (token) headers.authorization = "Bearer " + token;
  let res;
  try { res = await fetch((cfg().apiBase || "") + path, {method: "POST", headers, body: JSON.stringify(body)}); }
  catch { throw new Error("Server nicht erreichbar."); }
  let json = null; try { json = await res.json(); } catch {}
  if (!res.ok) { const e = new Error((json && json.error) || `Fehler ${res.status}`); e.status = res.status; throw e; }
  return json;
}
export const aiAvailable = () => !!(adapterRef && adapterRef.mode === "cloud");
let aiDown = false;
export async function ai(task, payload) {
  if (aiDown) throw new Error("KI vorübergehend nicht verfügbar.");
  try { return (await post("/api/ai", {task, payload})).data; }
  catch (e) { if (e.status === 404 || e.status === 503) aiDown = true; throw e; }
}
export const garmin = {
  connect: apiKey => post("/api/garmin", {action: "connect", apiKey}),
  sync: (days = 30) => post("/api/garmin", {action: "sync", days}),
  disconnect: () => post("/api/garmin", {action: "disconnect"}),
  status: () => post("/api/garmin", {action: "status"})
};
