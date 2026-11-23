"use strict";
/* Coach-Modul: Garmin-Daten, regelbasierte Auswertung, KI-Empfehlungen und automatische Plananpassung.
   Wird nach app.js geladen und nutzt dessen globale Daten (data, weeks, get, esc, save, renderPlan ...). */

const SETTINGS_KEY = "football_training_tracker_settings";
const GARMIN_KEY = "football_training_tracker_garmin";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

function loadJson(key, fallback){
  try { const raw = localStorage.getItem(key); return raw ? Object.assign({}, fallback, JSON.parse(raw)) : fallback; }
  catch(err){ console.error("Laden fehlgeschlagen:", key, err); return fallback; }
}
let settings = loadJson(SETTINGS_KEY, {apiKey:"", model:DEFAULT_MODEL, autoApply:true});
let garmin = loadJson(GARMIN_KEY, {activities:[], daily:[], syncedAt:null});
if(!Array.isArray(garmin.activities)) garmin.activities = [];
if(!Array.isArray(garmin.daily)) garmin.daily = [];
function saveSettings(){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){ console.error(e); } }
function saveGarmin(){ try{ localStorage.setItem(GARMIN_KEY, JSON.stringify(garmin)); }catch(e){ console.error(e); } }

/* ---------- Hilfsfunktionen ---------- */
function adapt(){
  if(!data.adapt) data.adapt = {};
  if(!data.adapt.targets) data.adapt.targets = {};
  if(!data.adapt.sessionMods) data.adapt.sessionMods = {};
  if(!data.adapt.analyses) data.adapt.analyses = {};
  return data.adapt;
}
function num(v){ const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; }
function fmt(n){ return n === null || n === undefined ? "–" : String(Math.round(n*100)/100).replace(".", ","); }
function roundTo(n, step){ return Math.round(n/step)*step; }
function median(a){ if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y), m=Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; }
function hasPainWords(text){
  const t = String(text||"").toLowerCase().replace(/\b(kein|keine|keinen|keiner|keinem|ohne|nicht)\s+\w+/g, " ");
  return ["schmerz","beschwer","ziehen","verletz","schwell","humpel","steif","probleme","stechen"].some(x=>t.includes(x));
}
function baseSets(e){ return Number((e[2].match(/^(\d+)/)||[3,3])[1]); }
function parsePlan(plan){
  const m = String(plan).match(/^(\d+)\s*×\s*(\d+)(?:\s*[–-]\s*(\d+))?/);
  if(!m) return {sets:3, min:8, max:8};
  const min = Number(m[2]), max = m[3] ? Number(m[3]) : min;
  return {sets:Number(m[1]), min, max};
}
function sessionOrder(){ const a=[]; weeks.forEach(w=>a.push(`w${w.n}_t1`,`w${w.n}_t2`)); return a; }
function parseKey(p){ const m=String(p).match(/^w(\d+)_(t1|t2)$/); return m ? {n:Number(m[1]), type:m[2]} : null; }
function nextKey(p, onlyType){
  const order = sessionOrder(), i = order.indexOf(p);
  for(let k=i+1;k<order.length;k++) if(!onlyType || order[k].endsWith("_"+onlyType)) return order[k];
  return null;
}

/* ---------- Anzeige der angepassten Ziele im Plan ---------- */
function targetFor(e, w){
  const t = adapt().targets[e[0]];
  if(!t || t.fromWeek > w.n) return null;
  const pp = parsePlan(e[2]);
  const out = Object.assign({}, t);
  if(out.reps != null) out.reps = Math.min(pp.max, Math.max(pp.min, out.reps));
  return out;
}
function setsFor(w, e, j){
  let s = baseSets(e);
  const mod = adapt().sessionMods[`w${w.n}_t1`];
  if(mod && mod.setsDelta) s = Math.max(1, s + mod.setsDelta);
  const kind = e[1]==="time" ? "time" : "reps";
  for(let i=s+1;i<=10;i++) if(get(`w${w.n}_ex${j}_set${i}_${kind}`) !== "") s = i; // erfasste Sätze nie ausblenden
  return s;
}
function targetBadge(e, w){
  const t = targetFor(e, w); if(!t) return "";
  const txt = e[1]==="time"
    ? (t.seconds!=null ? `${fmt(t.seconds)} Sek.` : "")
    : [t.weight!=null?`${fmt(t.weight)} kg`:"", t.reps!=null?`${t.reps} Wdh.`:""].filter(Boolean).join(" × ");
  if(!txt) return "";
  return `<div class="target-badge" title="${esc(t.reason||"")}">🎯 Ziel: ${esc(txt)}</div>`;
}
function scaleMinutes(text, factor){
  if(!factor || Math.abs(factor-1) < 0.01) return text;
  return text.replace(/(\d+)(?:–(\d+))?(\s*Min\.)/g, (m,a,b,u)=>{
    const x = Math.max(1, Math.round(a*factor)), y = b ? Math.max(1, Math.round(b*factor)) : null;
    return (y ? `${x}–${y}` : `${x}`) + u;
  });
}
function modFor(p){ return adapt().sessionMods[p] || null; }
function modBanner(p){
  const m = modFor(p); if(!m) return "";
  const parts = [];
  if(m.factor && Math.abs(m.factor-1) >= 0.01) parts.push(`Lauf/Rad-Umfang ×${fmt(m.factor)}`);
  if(m.setsDelta) parts.push(`${m.setsDelta>0?"+":""}${m.setsDelta} Satz je Kraftübung`);
  if(!parts.length && !m.note) return "";
  return `<div class="adapt-banner">🔧 <strong>Automatisch angepasst:</strong> ${esc([parts.join(" · "), m.note].filter(Boolean).join(" – "))}</div>`;
}

/* ---------- Garmin ---------- */
function normDate(s){ const m = String(s||"").match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ""; }
function normalizeGarmin(raw){
  if(!raw || typeof raw !== "object") throw new Error("Keine gültige JSON-Datei.");
  const acts = Array.isArray(raw.activities) ? raw.activities : [];
  const daily = Array.isArray(raw.daily) ? raw.daily : [];
  const n = v => { const x = num(v); return x; };
  return {
    activities: acts.map(a=>({
      id:String(a.id ?? `${a.date}_${a.start}`), date:normDate(a.date), start:String(a.start||"").slice(0,5),
      type:String(a.type||"").toLowerCase(), name:String(a.name||"").slice(0,80),
      durationMin:n(a.durationMin), distanceKm:n(a.distanceKm), avgHr:n(a.avgHr), maxHr:n(a.maxHr),
      calories:n(a.calories), aerobicTE:n(a.aerobicTE), anaerobicTE:n(a.anaerobicTE), trainingLoad:n(a.trainingLoad)
    })).filter(a=>a.date),
    daily: daily.map(d=>({
      date:normDate(d.date), restingHr:n(d.restingHr), hrvAvg:n(d.hrvAvg), hrvStatus:String(d.hrvStatus||"").toUpperCase(),
      sleepHours:n(d.sleepHours), sleepScore:n(d.sleepScore), bodyBatteryMorning:n(d.bodyBatteryMorning), stressAvg:n(d.stressAvg)
    })).filter(d=>d.date),
    generated: raw.generated || null
  };
}
function mergeGarmin(incoming){
  const byAct = new Map(garmin.activities.map(a=>[a.id,a]));
  incoming.activities.forEach(a=>byAct.set(a.id,a));
  const byDay = new Map(garmin.daily.map(d=>[d.date,d]));
  incoming.daily.forEach(d=>byDay.set(d.date,d));
  garmin.activities = [...byAct.values()].sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
  garmin.daily = [...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date));
  garmin.syncedAt = incoming.generated || new Date().toISOString();
  saveGarmin();
}
function garminStatusText(){
  if(!garmin.activities.length && !garmin.daily.length) return "Noch keine Garmin-Daten importiert.";
  const last = garmin.daily.length ? garmin.daily[garmin.daily.length-1] : null;
  const bits = [`${garmin.activities.length} Aktivitäten`, `${garmin.daily.length} Tageswerte`];
  if(garmin.syncedAt) bits.push(`Stand ${String(garmin.syncedAt).slice(0,16).replace("T"," ")}`);
  let s = "✓ " + bits.join(" · ");
  if(last) s += ` · zuletzt ${last.date}: ${[last.sleepHours!=null?`Schlaf ${fmt(last.sleepHours)} h`:"", last.restingHr!=null?`Ruhepuls ${fmt(last.restingHr)}`:"", last.hrvStatus||"", last.bodyBatteryMorning!=null?`Body Battery ${fmt(last.bodyBatteryMorning)}`:""].filter(Boolean).join(", ")}`;
  return s;
}
function setGarminStatus(msg, bad){
  const el = document.getElementById("garminStatus"); if(!el) return;
  el.textContent = msg; el.className = "small" + (bad ? " status-bad" : "");
}
function importGarminText(text){
  try { mergeGarmin(normalizeGarmin(JSON.parse(text))); setGarminStatus(garminStatusText()); }
  catch(err){ setGarminStatus("⚠ Import fehlgeschlagen: " + err.message, true); }
}
function onGarminFile(ev){
  const f = ev.target.files && ev.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => importGarminText(String(r.result));
  r.onerror = () => setGarminStatus("⚠ Datei konnte nicht gelesen werden.", true);
  r.readAsText(f); ev.target.value = "";
}
async function fetchGarminFromSite(){
  try {
    const res = await fetch("./garmin_data.json", {cache:"no-store"});
    if(!res.ok) throw new Error("garmin_data.json nicht gefunden (HTTP " + res.status + ")");
    importGarminText(await res.text());
  } catch(err){ setGarminStatus("⚠ " + err.message, true); }
}
function recovery(date){
  const d = garmin.daily.find(x=>x.date===date);
  if(!d) return {data:null, flags:[]};
  const prior = garmin.daily.filter(x=>x.date<date && x.restingHr!=null).slice(-14).map(x=>x.restingHr);
  const base = prior.length>=5 ? median(prior) : null;
  const flags = [];
  if(d.sleepHours!=null && d.sleepHours<6) flags.push(`wenig Schlaf (${fmt(d.sleepHours)} h)`);
  if(["LOW","UNBALANCED","POOR"].includes(d.hrvStatus)) flags.push(`HRV-Status ${d.hrvStatus}`);
  if(base!=null && d.restingHr!=null && d.restingHr >= base+5) flags.push(`Ruhepuls erhöht (${fmt(d.restingHr)} statt ~${fmt(base)})`);
  if(d.bodyBatteryMorning!=null && d.bodyBatteryMorning<30) flags.push(`Body Battery morgens niedrig (${fmt(d.bodyBatteryMorning)})`);
  return {data:d, flags, restingBase:base};
}
function activityFlags(acts){
  const flags = [];
  const loads = garmin.activities.map(a=>a.trainingLoad).filter(x=>x!=null);
  const base = median(loads);
  acts.forEach(a=>{
    if(a.aerobicTE!=null && a.aerobicTE>=4.5) flags.push(`aerober Trainingseffekt sehr hoch (${fmt(a.aerobicTE)})`);
    if(a.anaerobicTE!=null && a.anaerobicTE>=3.5) flags.push(`anaerober Trainingseffekt hoch (${fmt(a.anaerobicTE)})`);
    if(a.trainingLoad!=null && base && loads.length>=5 && a.trainingLoad >= base*1.6) flags.push(`Trainingsload deutlich über Median (${fmt(a.trainingLoad)})`);
  });
  return flags;
}
/* Garmin-Erholung fließt in die allgemeine Wochenbewertung ein */
function assessment(){
  const a = assessmentBase();
  const last = garmin.daily.length ? garmin.daily[garmin.daily.length-1] : null;
  if(last){
    const r = recovery(last.date);
    a.garminFlags = r.flags;
    if(r.flags.length>=2 && a.zone==="green"){
      a.zone = "yellow"; a.label = "Konservativ (Erholung)"; a.factor = Math.min(a.factor, 0.9);
      a.rule = `Garmin-Erholungswerte auffällig (${r.flags.join(", ")}): Umfang halten, keine Steigerung.`;
    }
  }
  return a;
}

/* ---------- Daten einer Einheit sammeln ---------- */
function collectSession(p){
  const k = parseKey(p); if(!k) return null;
  const w = weeks[k.n-1], date = get(`${p}_date`);
  const exercises = [];
  if(k.type==="t1"){
    w.strength.forEach((e,j)=>{
      const [name,kind,plan] = e, pp = parsePlan(plan), sets = [];
      const pk = kind==="time" ? "time" : "reps";
      for(let s=1;s<=10;s++){
        const reps = get(`w${w.n}_ex${j}_set${s}_${pk}`);
        if(reps === "" ) continue;
        if(kind==="time") sets.push({seconds:num(reps)});
        else sets.push({weight:num(get(`w${w.n}_ex${j}_set${s}_weight`)), reps:num(reps)});
      }
      exercises.push({name, kind:kind==="time"?"time":"weight", plan, min:pp.min, max:pp.max, plannedSets:setsFor(w,e,j), sets});
    });
  }
  const acts = garmin.activities.filter(a=>a.date===date);
  const rec = recovery(date);
  return {
    key:p, week:w.n, type:k.type, date, phase:w.phase.name, phaseGoal:w.phase.goal,
    rpe:num(get(`${p}_rpe`)), pain:num(get(`${p}_pain`)), notes:get(`${p}_notes`), durationMin:durationFor(p),
    cardioPlan: k.type==="t1" ? w.run1 : `${w.bike} | Laufband: ${w.run2}`,
    cardioLogged: k.type==="t1" ? get(`${p}_run`) : `${get(`${p}_bike`)} | ${get(`${p}_run`)}`,
    exercises, garminActivities:acts, recovery:rec, actFlags:activityFlags(acts)
  };
}
function exerciseHistory(name, uptoWeek){
  const out = [];
  weeks.forEach(w=>{ if(w.n>=uptoWeek) return;
    w.strength.forEach((e,j)=>{ if(e[0]!==name) return;
      const pk = e[1]==="time"?"time":"reps", sets=[];
      for(let s=1;s<=10;s++){ const r=get(`w${w.n}_ex${j}_set${s}_${pk}`); if(r==="") continue;
        sets.push(e[1]==="time" ? {seconds:num(r)} : {weight:num(get(`w${w.n}_ex${j}_set${s}_weight`)), reps:num(r)}); }
      if(sets.length) out.push({week:w.n, sets});
    });
  });
  return out.slice(-3);
}
function topOf(ex){
  if(ex.kind==="time"){ const v = ex.sets.map(s=>s.seconds).filter(x=>x!=null); return {seconds: v.length?Math.min(...v):null}; }
  const ws = ex.sets.map(s=>s.weight).filter(x=>x!=null);
  const weight = ws.length ? Math.max(...ws) : null;
  const atTop = ex.sets.filter(s=>weight==null || s.weight==null || s.weight >= weight*0.98);
  const reps = atTop.map(s=>s.reps).filter(x=>x!=null);
  return {weight, minReps: reps.length?Math.min(...reps):null, allReps: reps};
}

/* ---------- Regelbasierte Auswertung (Sicherheitsgrenze und Fallback) ---------- */
function ruleAnalysis(ctx){
  const reasons = [];
  const painSevere = ctx.pain!=null && ctx.pain>=4;
  const painMild = (ctx.pain!=null && ctx.pain>=2) || hasPainWords(ctx.notes);
  const rpeHigh = ctx.rpe!=null && ctx.rpe>=8, rpeVeryHigh = ctx.rpe!=null && ctx.rpe>=9;
  const gFlags = ctx.recovery.flags.concat(ctx.actFlags);
  if(painSevere) reasons.push(`Schmerz ${fmt(ctx.pain)}/10`);
  else if(painMild) reasons.push(ctx.pain!=null && ctx.pain>=2 ? `Schmerz ${fmt(ctx.pain)}/10` : "Beschwerden in den Notizen");
  if(rpeHigh) reasons.push(`RPE ${fmt(ctx.rpe)}`);
  if(ctx.recovery.flags.length>=2) reasons.push("Garmin-Erholung auffällig: " + ctx.recovery.flags.join(", "));
  if(ctx.actFlags.length) reasons.push("Garmin: " + ctx.actFlags.join(", "));
  const reduce = painSevere || rpeVeryHigh;
  const hold = reduce || painMild || rpeHigh || ctx.recovery.flags.length>=2 || ctx.actFlags.length>0;
  const painKnown = ctx.pain!=null;
  const zone = reduce ? "red" : hold ? "yellow" : "green";
  const tips = [];
  if(!painKnown) tips.push("Schmerzwert (0–10) eintragen – ohne ihn gibt die App keine Gewichtssteigerungen frei.");
  if(ctx.rpe==null) tips.push("RPE der Einheit eintragen, damit die Belastung eingeordnet werden kann.");
  if(!ctx.garminActivities.length && garmin.activities.length) tips.push("Für dieses Datum wurde keine Garmin-Aktivität gefunden – Garmin-Daten neu importieren?");

  const exs = ctx.exercises.filter(e=>e.sets.length).map(ex=>{
    const t = topOf(ex), sens = /adduktor/i.test(ex.name);
    const res = {name:ex.name, kind:ex.kind, lastWeight:t.weight ?? null, lastReps:t.minReps ?? null, lastSeconds:t.seconds ?? null, action:"hold", reason:""};
    if(ex.kind==="time"){
      const allMax = ex.sets.length>=ex.plannedSets && ex.sets.every(s=>s.seconds!=null && s.seconds>=ex.max);
      if(reduce){ res.action="reduce"; res.nextSeconds=Math.max(10, (t.seconds||ex.min)-5); res.reason="Belastung zurücknehmen."; }
      else if(!hold && painKnown && allMax && !sens){ res.action="increase_reps"; res.nextSeconds=Math.min(60,(t.seconds||ex.max)+5); res.reason=`Alle Sätze ≥ ${ex.max} Sek. – Haltedauer +5 Sek.`; }
      else if(!hold && painKnown && allMax && sens && ctx.pain===0 && ctx.rpe<=6){ res.action="increase_reps"; res.nextSeconds=Math.min(45,(t.seconds||ex.max)+5); res.reason="Adduktor-Isometrie: vorsichtig +5 Sek., da schmerzfrei."; }
      else { res.nextSeconds = t.seconds ?? ex.min; res.reason = hold ? "Halten – " + (reasons.join("; ")||"Erholung sichern") : "Dauer stabil halten, bis alle Sätze das Ziel erreichen."; }
      return res;
    }
    const w = t.weight, minReps = t.minReps;
    const allTop = ex.sets.length>=ex.plannedSets && ex.sets.every(s=>s.reps!=null && s.reps>=ex.max);
    const allInRange = ex.sets.every(s=>s.reps!=null && s.reps>=ex.min);
    if(w==null){ // Körpergewicht/Band: nur Wiederholungen
      res.nextReps = hold ? (minReps ?? ex.min) : Math.min(ex.max, (minReps ?? ex.min)+(allInRange?1:0));
      res.action = !hold && res.nextReps>(minReps??0) ? "increase_reps" : "hold";
      res.reason = hold ? "Halten – " + (reasons.join("; ")||"Erholung sichern") : "Wiederholungen schrittweise steigern, bevor Widerstand erhöht wird.";
      return res;
    }
    if(reduce){ res.action="reduce"; res.nextWeight=roundTo(w*0.9,1.25); res.nextReps=ex.min; res.reason="Gewicht ~10 % senken: " + (reasons.join("; ")||"Belastung zu hoch"); return res; }
    if(hold || !painKnown){ res.nextWeight=w; res.nextReps=Math.min(ex.max, Math.max(ex.min, minReps ?? ex.min)); res.reason = hold ? "Gewicht halten – " + reasons.join("; ") : "Gewicht halten – Schmerzwert fehlt für eine Steigerung."; return res; }
    if(allTop && !(sens && !(ctx.pain===0 && ctx.rpe<=6))){
      const inc = ctx.week<=3 ? 0.025 : 0.05;
      const step = Math.max(1.25, roundTo(w*inc,1.25));
      res.action="increase_weight"; res.nextWeight=w+step; res.nextReps=ex.min;
      res.reason=`Alle ${ex.plannedSets} Sätze mit ${ex.max} Wdh. geschafft (RPE ${fmt(ctx.rpe)}) → +${fmt(step)} kg, zurück auf ${ex.min} Wdh.`;
    } else if(allTop){ res.nextWeight=w; res.nextReps=ex.max; res.reason="Adduktorenbelastung nur bei Schmerz 0 und RPE ≤6 steigern."; }
    else if(allInRange){
      res.action="increase_reps"; res.nextWeight=w; res.nextReps=Math.min(ex.max,(minReps??ex.min)+1);
      res.reason=`Gewicht beibehalten, nächstes Ziel ${res.nextReps} Wdh. in allen Sätzen (Zielbereich ${ex.min}–${ex.max}).`;
    } else {
      const low = ex.sets.some(s=>s.reps!=null && s.reps<ex.min-2);
      res.nextWeight = low ? roundTo(w*0.95,1.25) : w; res.nextReps=ex.min;
      res.action = low ? "reduce" : "hold";
      res.reason = low ? "Wiederholungen deutlich unter Zielbereich → Gewicht ~5 % senken." : `Unter ${ex.min} Wdh. in mind. einem Satz → Gewicht halten und sauber ausführen.`;
    }
    return res;
  });

  const nextSession = {factor:1, setsDelta:0, advice:""};
  if(reduce){ nextSession.factor=0.75; nextSession.setsDelta=-1; nextSession.advice="Nächste Einheit ca. 25 % kürzer/leichter, 1 Satz weniger je Kraftübung, keine neue hohe Intensität."; }
  else if(hold){ nextSession.factor=0.9; nextSession.advice="Nächste Einheit Umfang halten bzw. ~10 % reduzieren; keine Steigerung."; }
  else if(painKnown && ctx.pain===0 && ctx.rpe!=null && ctx.rpe<=5 && ctx.type==="t2"){ nextSession.factor=1.1; nextSession.advice="Gut verträglich: Lauf-/Radumfang um ca. 10 % steigern (nur diese eine Variable)."; }
  else nextSession.advice = "Plan beibehalten; nur eine Variable (Gewicht ODER Umfang) auf einmal steigern.";

  const cardio = {factor:nextSession.factor, advice:""};
  let summary = reduce ? "Hohe Belastung bzw. Beschwerden – nächste Einheit entlasten." : hold ? "Einheit abgeschlossen – aktuell konsolidieren statt steigern." : painKnown ? "Gut verträglich – Progression freigegeben." : "Einheit dokumentiert – für Steigerungen fehlt der Schmerzwert.";
  if(ctx.garminActivities.length){
    const a = ctx.garminActivities[0];
    cardio.advice = [a.avgHr!=null?`Ø-Puls ${fmt(a.avgHr)}`:"", a.aerobicTE!=null?`aerober TE ${fmt(a.aerobicTE)}`:""].filter(Boolean).join(", ");
  }
  return {source:"regel", zone, summary, exercises:exs, cardio, nextSession, tips, hold, reduce, reasons, painKnown};
}

/* ---------- KI (Claude) ---------- */
const SYSTEM_PROMPT = `Du bist ein erfahrener Kraft- und Reha-Coach für einen Fußballer im Wiedereinstieg nach einer Belastungsproblematik an Symphyse/Adduktoren (Rectus-abdominis-/Adduktoren-Ansatz). Du bekommst die Daten einer gerade abgeschlossenen Trainingseinheit (Plan, protokollierte Sätze, RPE, Schmerz, Garmin-Daten) und gibst konkrete Empfehlungen für die nächste Einheit.
Regeln:
- Doppelte Progression: erst alle Sätze am oberen Wiederholungsende sauber schaffen, dann Gewicht um 2,5–5 % erhöhen und Wiederholungen auf das untere Ende zurücksetzen. Nur EINE Variable pro Einheit ändern.
- Bei Schmerz ≥2/10, Beschwerden, RPE ≥8, auffälliger Garmin-Erholung (wenig Schlaf, niedrige HRV, erhöhter Ruhepuls, sehr hoher Trainingseffekt) NICHT steigern. Bei Schmerz ≥4 oder RPE ≥9 entlasten.
- Adduktorenübungen nur bei Schmerz 0 und RPE ≤6 steigern. Keine Sprint-/Sprung-/Richtungswechselfreigabe, keine medizinische Freigabe – dafür sind Arzt/Sportphysio zuständig.
- Gewichte nie um mehr als 10 % erhöhen. Antworte knapp, konkret, auf Deutsch.
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Text davor oder danach) in genau diesem Format:
{"summary":"2-3 Sätze Gesamtbewertung","exercises":[{"name":"exakter Übungsname aus den Daten","next_weight_kg":number|null,"next_reps":number|null,"next_seconds":number|null,"reason":"kurze Begründung"}],"cardio_advice":"Empfehlung für Lauf/Rad","next_session":{"volume_factor":0.7-1.1,"advice":"Empfehlung"},"tips":["max. 4 kurze Verbesserungshinweise, z. B. Tempo, Technik, Pausen, Schlaf"]}`;

function aiPayload(ctx, rule){
  return {
    einheit:{woche:ctx.week, typ:ctx.type==="t1"?"Kraft & Laufband":"Fahrrad & Laufband", datum:ctx.date, phase:ctx.phase, phasenziel:ctx.phaseGoal,
      rpe:ctx.rpe, schmerz_0_bis_10:ctx.pain, notizen:ctx.notes||"", dauer_min:ctx.durationMin, cardio_plan:ctx.cardioPlan, cardio_protokoll:ctx.cardioLogged},
    uebungen: ctx.exercises.filter(e=>e.sets.length).map(e=>({name:e.name, art:e.kind, plan:e.plan, saetze:e.sets, verlauf:exerciseHistory(e.name, ctx.week)})),
    garmin:{aktivitaeten:ctx.garminActivities, erholung:ctx.recovery.data, auffaelligkeiten:ctx.recovery.flags.concat(ctx.actFlags)},
    regel_vorschlag:{freigabe_steigerung:!rule.hold && rule.painKnown, grund_fuer_bremse:rule.reasons}
  };
}
async function callClaude(ctx, rule){
  const res = await fetch(API_URL, {
    method:"POST",
    headers:{"content-type":"application/json","x-api-key":settings.apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({model:settings.model||DEFAULT_MODEL, max_tokens:1500, system:SYSTEM_PROMPT, messages:[{role:"user", content:JSON.stringify(aiPayload(ctx, rule))}]})
  });
  if(!res.ok){ let t=""; try{ t=(await res.json()).error.message; }catch(e){} throw new Error(`KI-Anfrage fehlgeschlagen (HTTP ${res.status}${t?": "+t:""})`); }
  const j = await res.json();
  const text = (j.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if(!m) throw new Error("KI-Antwort enthielt kein JSON.");
  return JSON.parse(m[0]);
}
function clamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }
function short(s, n){ return String(s||"").slice(0,n); }
/* KI-Vorschläge dürfen nur innerhalb der Sicherheitsgrenzen der Regeln wirken. */
function mergeAI(ai, rule){
  const out = JSON.parse(JSON.stringify(rule)); out.source = "ki"; out.limited = false;
  if(typeof ai.summary==="string") out.summary = short(ai.summary, 600);
  out.exercises.forEach(ex=>{
    const a = (Array.isArray(ai.exercises)?ai.exercises:[]).find(x=>x && x.name===ex.name); if(!a) return;
    if(typeof a.reason==="string" && a.reason) ex.reason = short(a.reason, 300);
    if(ex.kind==="time"){
      const s = num(a.next_seconds), last = ex.lastSeconds;
      if(s!=null && last!=null){ const hi = out.hold ? last : Math.min(last+10, 60); const v = clamp(Math.round(s), 10, hi); if(v!==Math.round(s)) out.limited = true; ex.nextSeconds = v; }
    } else {
      const wgt = num(a.next_weight_kg), reps = num(a.next_reps), last = ex.lastWeight;
      if(wgt!=null && last!=null){ const hi = out.hold || !out.painKnown ? last : last*1.1; const v = roundTo(clamp(wgt, last*0.8, hi), 1.25); if(Math.abs(v-wgt)>0.01) out.limited = true; ex.nextWeight = v; }
      if(reps!=null){ const v = clamp(Math.round(reps), 1, Math.max(ex.nextReps||0, parsePlanReps(ex)) ); if(v!==Math.round(reps)) out.limited = true; ex.nextReps = v; }
    }
    // Aktion aus den Zahlen ableiten, damit Text und Ziel nie widersprüchlich sind
    if(ex.kind==="time") ex.action = ex.nextSeconds>ex.lastSeconds ? "increase_reps" : ex.nextSeconds<ex.lastSeconds ? "reduce" : "hold";
    else if(ex.lastWeight!=null && ex.nextWeight!=null && ex.nextWeight>ex.lastWeight+0.01) ex.action="increase_weight";
    else if(ex.lastWeight!=null && ex.nextWeight!=null && ex.nextWeight<ex.lastWeight-0.01) ex.action="reduce";
    else if(ex.nextReps!=null && ex.lastReps!=null && ex.nextReps>ex.lastReps) ex.action="increase_reps";
    else ex.action="hold";
  });
  if(ai.cardio_advice && !out.hold) out.cardio.advice = short(ai.cardio_advice, 300);
  if(ai.next_session){
    if(ai.next_session.advice) out.nextSession.advice = out.hold ? `${rule.nextSession.advice} ${short(ai.next_session.advice, 250)}` : short(ai.next_session.advice, 300);
    const f = num(ai.next_session.volume_factor);
    if(f!=null){ const hi = out.hold ? out.nextSession.factor : 1.1; const v = clamp(f, 0.7, hi); if(Math.abs(v-f)>0.001) out.limited = true; out.nextSession.factor = Math.round(v*100)/100; out.cardio.factor = out.nextSession.factor; }
  }
  if(Array.isArray(ai.tips)) out.tips = out.tips.concat(ai.tips.slice(0,4).map(t=>short(t,200)));
  return out;
}
function parsePlanReps(ex){ return ex.max || 0; }

/* ---------- Anpassung anwenden ---------- */
function applyAnalysis(p){
  const a = adapt(), an = a.analyses[p]; if(!an || an.applied) return;
  const nextT1 = nextKey(p, "t1"), r = an.result;
  r.exercises.forEach(ex=>{
    if(!nextT1) return;
    const t = {fromWeek:parseKey(nextT1).n, reason:ex.reason, source:an.source, date:an.date};
    if(ex.kind==="time"){ if(ex.nextSeconds==null) return; t.seconds = ex.nextSeconds; }
    else { if(ex.nextWeight!=null) t.weight = ex.nextWeight; if(ex.nextReps!=null) t.reps = ex.nextReps; if(t.weight==null && t.reps==null) return; }
    a.targets[ex.name] = t;
  });
  const nk = nextKey(p), m = r.nextSession;
  if(nk) a.sessionMods[nk] = Object.assign({}, a.sessionMods[nk], {factor:m.factor, note:short(m.advice,160)});
  if(nextT1) a.sessionMods[nextT1] = Object.assign({}, a.sessionMods[nextT1], {setsDelta:m.setsDelta||0, note:short(m.advice,160)});
  an.applied = true;
  save();
}
function resetAdaptations(){
  if(!confirm("Alle automatischen Anpassungen (Zielgewichte, Umfangsfaktoren, Auswertungen) zurücksetzen? Deine Trainingseingaben bleiben erhalten.")) return;
  data.adapt = {targets:{}, sessionMods:{}, analyses:{}};
  save(); renderPlan();
}

/* ---------- Ablauf: Training abschließen ---------- */
const busy = {};
async function finishSession(p){
  if(busy[p]) return;
  const ctx = collectSession(p); if(!ctx) return;
  const box = document.getElementById(`coach-result-${p}`);
  if(!ctx.date){ if(box) box.innerHTML = `<div class="notice warning">Bitte zuerst das Trainingsdatum eintragen.</div>`; return; }
  if(ctx.type==="t1" && !ctx.exercises.some(e=>e.sets.length) && ctx.rpe==null){ if(box) box.innerHTML = `<div class="notice warning">Bitte Sätze und/oder RPE eintragen, dann auswerten.</div>`; return; }
  if(ctx.type==="t2" && ctx.rpe==null){ if(box) box.innerHTML = `<div class="notice warning">Bitte RPE eintragen, dann auswerten.</div>`; return; }
  busy[p] = true;
  if(box) box.innerHTML = `<div class="notice">⏳ Einheit wird ausgewertet …</div>`;
  const rule = ruleAnalysis(ctx);
  let result = rule, error = "";
  if(settings.apiKey){
    try { result = mergeAI(await callClaude(ctx, rule), rule); }
    catch(err){ error = err.message || String(err); result = rule; }
  }
  const prev = adapt().analyses[p];
  if(prev && prev.applied){ /* neue Auswertung ersetzt die alte; frühere Zielwerte werden überschrieben */ }
  adapt().analyses[p] = {at:new Date().toISOString(), date:ctx.date, source:result.source, result, error, applied:false,
    garmin:{n:ctx.garminActivities.length, flags:ctx.recovery.flags.concat(ctx.actFlags)}};
  if(settings.autoApply) applyAnalysis(p); else save();
  busy[p] = false;
  renderPlan();
}
function applyClicked(p){ applyAnalysis(p); renderPlan(); }

/* ---------- Darstellung ---------- */
const ACTION = {increase_weight:["⬆","Mehr Gewicht"], increase_reps:["➕","Mehr Wiederholungen"], hold:["⏸","Halten"], reduce:["⬇","Reduzieren"]};
function targetText(ex){
  if(ex.kind==="time") return ex.nextSeconds!=null ? `${fmt(ex.nextSeconds)} Sek.` : "–";
  return [ex.nextWeight!=null?`${fmt(ex.nextWeight)} kg`:"", ex.nextReps!=null?`${ex.nextReps} Wdh.`:""].filter(Boolean).join(" × ") || "–";
}
function coachBlock(p){
  const an = adapt().analyses[p];
  const btn = `<button class="primary" onclick="finishSession('${p}')">🤖 Training abschließen &amp; Empfehlung</button>`;
  const hint = `<span class="small">${settings.apiKey ? "Auswertung durch Claude, begrenzt durch Sicherheitsregeln." : "Regelbasierte Auswertung (für KI-Empfehlungen unten im Abschnitt „Garmin &amp; KI-Coach“ einen API-Key hinterlegen)."}</span>`;
  let body = "";
  if(an){
    const r = an.result, z = r.zone;
    const exs = r.exercises.map(ex=>{
      const [ic,lb] = ACTION[ex.action] || ACTION.hold;
      return `<div class="rec-row"><div><strong>${esc(ex.name)}</strong><div class="small">${esc(ex.reason)}</div></div><div class="rec-side"><span class="pill rec-${ex.action}">${ic} ${lb}</span><div class="rec-target">Nächstes Mal: ${esc(targetText(ex))}</div></div></div>`;
    }).join("");
    const garm = an.garmin && an.garmin.n ? `Garmin: ${an.garmin.n} Aktivität(en) zugeordnet.` : (garmin.activities.length ? "Garmin: keine Aktivität für dieses Datum." : "");
    body = `<div class="coach-result zone-card zone-${z}">
      <div class="session-head"><div><div class="section-kicker">${an.source==="ki"?"🤖 KI-EMPFEHLUNG (CLAUDE)":"📏 REGELBASIERTE EMPFEHLUNG"}</div><strong>${esc(r.summary)}</strong></div><span class="pill">${esc(String(an.at).slice(0,16).replace("T"," "))}</span></div>
      ${an.error?`<div class="notice warning">KI nicht verfügbar – es wird die regelbasierte Empfehlung gezeigt. ${esc(an.error)}</div>`:""}
      ${r.limited?`<div class="notice">Einzelne KI-Vorschläge wurden von den Sicherheitsregeln begrenzt (max. +10 % Gewicht, keine Steigerung bei Schmerz/hoher Belastung).</div>`:""}
      ${exs?`<div class="rec-list">${exs}</div>`:""}
      <p><strong>Nächste Einheit:</strong> ${esc(r.nextSession.advice)}</p>
      ${r.cardio.advice?`<p><strong>Ausdauer:</strong> ${esc(r.cardio.advice)}</p>`:""}
      ${r.tips.length?`<ul class="tips">${r.tips.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:""}
      <p class="small">${esc(garm)} ${an.garmin&&an.garmin.flags.length?"Auffälligkeiten: "+esc(an.garmin.flags.join(", "))+".":""}</p>
      <div class="coach-foot">${an.applied?`<span class="pill pill-success">✓ In den Plan übernommen</span>`:`<button class="primary" onclick="applyClicked('${p}')">Anpassung in den Plan übernehmen</button>`}
      <span class="small">Keine medizinische Freigabe – bei Schmerzen nicht steigern.</span></div></div>`;
  }
  return `<div class="coach-box"><div class="coach-actions">${btn}${hint}</div><div id="coach-result-${p}">${body}</div></div>`;
}

function renderAdaptTargets(){
  const el = document.getElementById("adaptTargets"); if(!el) return;
  const t = adapt().targets, names = Object.keys(t);
  if(!names.length){ el.innerHTML = `<div class="empty">Noch keine automatischen Anpassungen. Sie entstehen, sobald du eine Einheit abschließt und auswertest.</div>`; return; }
  el.innerHTML = names.map(n=>{
    const x = t[n];
    const txt = x.seconds!=null ? `${fmt(x.seconds)} Sek.` : [x.weight!=null?`${fmt(x.weight)} kg`:"", x.reps!=null?`${x.reps} Wdh.`:""].filter(Boolean).join(" × ");
    return `<div class="extra-item"><div><strong>${esc(n)}</strong><div class="small">${esc(x.reason||"")}</div></div><div class="item-meta"><span class="pill">🎯 ${esc(txt)}</span><span class="pill">ab Woche ${x.fromWeek}</span></div></div>`;
  }).join("");
}

function initCoach(){
  const $ = id => document.getElementById(id);
  if($("garminFile")) $("garminFile").addEventListener("change", onGarminFile);
  if($("garminFetchBtn")) $("garminFetchBtn").addEventListener("click", fetchGarminFromSite);
  if($("apiKey")) $("apiKey").value = settings.apiKey || "";
  if($("apiModel")) $("apiModel").value = settings.model || DEFAULT_MODEL;
  if($("autoApply")) $("autoApply").checked = !!settings.autoApply;
  const bind = (id, fn) => { const el=$(id); if(el) el.addEventListener("change", ()=>{ fn(el); saveSettings(); }); };
  bind("apiKey", el=>settings.apiKey = el.value.trim());
  bind("apiModel", el=>settings.model = el.value.trim() || DEFAULT_MODEL);
  bind("autoApply", el=>settings.autoApply = el.checked);
  if($("clearKeyBtn")) $("clearKeyBtn").addEventListener("click", ()=>{ settings.apiKey=""; saveSettings(); if($("apiKey")) $("apiKey").value=""; renderPlan(); });
  if($("resetAdaptBtn")) $("resetAdaptBtn").addEventListener("click", resetAdaptations);
  setGarminStatus(garminStatusText());
  renderAdaptTargets();
}
