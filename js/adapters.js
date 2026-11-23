// Datenschicht: SupabaseAdapter (Konten + Cloud, Zeilenschutz per RLS) und LocalAdapter (Demo-Modus ohne Konto).
const SESSION_COLS = ["id", "plan_id", "date", "status", "kind", "sport", "title", "duration_min", "intensity", "load", "priority"];

export function sessionToRow(s, userId) {
  const {id, planId, date, status, kind, sport, title, durationMin, intensity, load, priority, ...rest} = s;
  const row = {id, plan_id: planId, date, status, kind, sport, title, duration_min: durationMin, intensity, load, priority, data: rest};
  if (userId) row.user_id = userId;
  return row;
}
export function rowToSession(r) {
  return {...(r.data || {}), id: r.id, planId: r.plan_id, date: r.date, status: r.status, kind: r.kind, sport: r.sport, title: r.title,
    durationMin: r.duration_min, intensity: r.intensity, load: Number(r.load), priority: r.priority};
}
export const planToRow = (p, userId) => ({id: p.id, ...(userId ? {user_id: userId} : {}), title: p.title, status: p.status, start_date: p.startDate, end_date: p.endDate, goal: p.goal, meta: p.meta});
export const rowToPlan = r => ({id: r.id, title: r.title, status: r.status, startDate: r.start_date, endDate: r.end_date, goal: r.goal, meta: r.meta});

/* ---------- Demo / lokal ---------- */
export class LocalAdapter {
  constructor() { this.mode = "demo"; this.key = "tt2_demo_v1"; this.listeners = []; }
  _read() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } }
  _write(d) { try { localStorage.setItem(this.key, JSON.stringify(d)); } catch (e) { throw new Error("Lokaler Speicher voll oder gesperrt."); } }
  async init() { return {id: "demo", email: "Demo-Modus"}; }
  async signUp() { throw new Error("Im Demo-Modus gibt es keine Konten."); }
  signIn() { return this.signUp(); }
  async signOut() {}
  async resetPassword() { throw new Error("Im Demo-Modus nicht verfügbar."); }
  onAuth() { return () => {}; }
  async accessToken() { return null; }
  async loadAll() {
    const d = this._read();
    return {plans: d.plans || [], sessions: d.sessions || [], garmin: d.garmin || {activities: [], daily: []}, settings: d.settings || {}, link: null};
  }
  async savePlan(plan) { const d = this._read(); d.plans = (d.plans || []).filter(p => p.id !== plan.id).concat([plan]); this._write(d); }
  async saveSessions(list) {
    const d = this._read(), map = new Map((d.sessions || []).map(s => [s.id, s]));
    list.forEach(s => map.set(s.id, s)); d.sessions = [...map.values()]; this._write(d);
  }
  async deleteSessions(ids) { const d = this._read(); d.sessions = (d.sessions || []).filter(s => !ids.includes(s.id)); this._write(d); }
  async deletePlan(id) { const d = this._read(); d.plans = (d.plans || []).filter(p => p.id !== id); d.sessions = (d.sessions || []).filter(s => s.planId !== id); this._write(d); }
  async saveSettings(settings) { const d = this._read(); d.settings = settings; this._write(d); }
  async saveGarmin(g) {
    const d = this._read(), cur = d.garmin || {activities: [], daily: []};
    const a = new Map(cur.activities.map(x => [x.id, x])); (g.activities || []).forEach(x => a.set(x.id, x));
    const dd = new Map(cur.daily.map(x => [x.date, x])); (g.daily || []).forEach(x => dd.set(x.date, x));
    d.garmin = {activities: [...a.values()], daily: [...dd.values()]}; this._write(d);
  }
  async exportAll() { return this._read(); }
  async deleteAllData() { localStorage.removeItem(this.key); }
  async deleteAccount() { await this.deleteAllData(); }
}

/* ---------- Supabase ---------- */
export class SupabaseAdapter {
  constructor(url, anonKey) {
    if (!window.supabase) throw new Error("supabase-js nicht geladen");
    this.mode = "cloud";
    this.sb = window.supabase.createClient(url, anonKey, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}});
    this.user = null;
  }
  async init() {
    const {data} = await this.sb.auth.getSession();
    this.user = data.session ? data.session.user : null;
    return this.user && {id: this.user.id, email: this.user.email};
  }
  onAuth(cb) {
    const {data} = this.sb.auth.onAuthStateChange((event, session) => { this.user = session ? session.user : null; cb(event, this.user && {id: this.user.id, email: this.user.email}); });
    return () => data.subscription.unsubscribe();
  }
  async signUp(email, password) {
    const {data, error} = await this.sb.auth.signUp({email, password, options: {emailRedirectTo: location.origin + location.pathname}});
    if (error) throw error;
    return {needsConfirm: !data.session};
  }
  async signIn(email, password) { const {error} = await this.sb.auth.signInWithPassword({email, password}); if (error) throw error; return {}; }
  async signOut() { await this.sb.auth.signOut(); }
  async resetPassword(email) { const {error} = await this.sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname}); if (error) throw error; }
  async updatePassword(password) { const {error} = await this.sb.auth.updateUser({password}); if (error) throw error; }
  async accessToken() { const {data} = await this.sb.auth.getSession(); return data.session ? data.session.access_token : null; }
  _uid() { if (!this.user) throw new Error("Nicht angemeldet"); return this.user.id; }
  async _ok(q) { const {data, error} = await q; if (error) throw new Error(error.message); return data; }
  async loadAll() {
    const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
    const [plans, sessions, acts, daily, profile, link] = await Promise.all([
      this._ok(this.sb.from("plans").select("*").order("created_at")),
      this._ok(this.sb.from("sessions").select("*").order("date").range(0, 4999)),
      this._ok(this.sb.from("garmin_activities").select("*").gte("date", since).order("date")),
      this._ok(this.sb.from("garmin_daily").select("*").gte("date", since).order("date")),
      this._ok(this.sb.from("profiles").select("*").maybeSingle()),
      this._ok(this.sb.from("garmin_links").select("status,last_sync_at,last_error").maybeSingle())
    ]);
    return {plans: plans.map(rowToPlan), sessions: sessions.map(rowToSession),
      garmin: {activities: acts.map(r => ({...r.data, id: r.id, date: r.date})), daily: daily.map(r => ({...r.data, date: r.date}))},
      settings: (profile && profile.settings) || {}, link};
  }
  async savePlan(plan) { await this._ok(this.sb.from("plans").upsert(planToRow(plan, this._uid()))); }
  async saveSessions(list) {
    const uid = this._uid();
    for (let i = 0; i < list.length; i += 200) await this._ok(this.sb.from("sessions").upsert(list.slice(i, i + 200).map(s => sessionToRow(s, uid))));
  }
  async deleteSessions(ids) { if (ids.length) await this._ok(this.sb.from("sessions").delete().in("id", ids)); }
  async deletePlan(id) { await this._ok(this.sb.from("plans").delete().eq("id", id)); }
  async saveSettings(settings) { await this._ok(this.sb.from("profiles").upsert({id: this._uid(), settings})); }
  async saveGarmin(g) {
    const uid = this._uid();
    const acts = (g.activities || []).map(({id, date, ...data}) => ({user_id: uid, id, date, data}));
    const daily = (g.daily || []).map(({date, ...data}) => ({user_id: uid, date, data}));
    for (let i = 0; i < acts.length; i += 300) await this._ok(this.sb.from("garmin_activities").upsert(acts.slice(i, i + 300)));
    for (let i = 0; i < daily.length; i += 300) await this._ok(this.sb.from("garmin_daily").upsert(daily.slice(i, i + 300)));
  }
  async exportAll() { return this.loadAll(); }
  async deleteAllData() {
    await this._ok(this.sb.from("sessions").delete().not("id", "is", null));
    await this._ok(this.sb.from("plans").delete().not("id", "is", null));
    await this._ok(this.sb.from("garmin_activities").delete().not("id", "is", null));
    await this._ok(this.sb.from("garmin_daily").delete().not("date", "is", null));
  }
  async deleteAccount() { await this._ok(this.sb.rpc("delete_my_account")); await this.sb.auth.signOut(); }
}
