const KEY = "football_training_tracker_v3";
let data = JSON.parse(localStorage.getItem(KEY) || "{}");
data.sessions ||= {};
data.extras ||= [];
let selectedWeek = 0;
let selectedTab = "t1";

const startDate = new Date("2026-09-07T12:00:00");
const phases = [
  {from:1,to:3,name:"Phase 1 · Beruhigen & Belastbarkeit",goal:"Alltagsbelastung stabilisieren, schmerzarmen Bewegungsumfang nutzen und Grundkraft ohne hohe Scher-/Explosivbelastung aufbauen.",criteria:["Folgetag stabil","kein Hinken","keine Zunahme von Leisten-/Symphysenschmerz"]},
  {from:4,to:7,name:"Phase 2 · Kraftbasis",goal:"Progressive bilaterale und kontrollierte einbeinige Kraft; Adduktoren gezielt, aber dosiert belasten.",criteria:["Krafttraining gut verträglich","Adduktionsbelastung kontrolliert","lockeres Laufen stabil"]},
  {from:8,to:11,name:"Phase 3 · Laufkapazität",goal:"Laufdauer erhöhen und erste kurze zügige Abschnitte einführen; Kraft weiter aufbauen.",criteria:["RPE meist ≤7","keine Verschlechterung am Folgetag","geradliniges Laufen stabil"]},
  {from:12,to:14,name:"Phase 4 · Beschleunigen & Bremsen",goal:"Beschleunigung, Abbremsen, seitliche Kontrolle und reaktive Kraft schrittweise entwickeln.",criteria:["zügiges Laufen schmerzfrei","kontrolliertes Abbremsen","seitliche Belastung verträglich"]},
  {from:15,to:17,name:"Phase 5 · Return to Football",goal:"Fußballspezifische Belastung mit Richtungswechseln und Ballarbeit vorbereiten. Mannschaftstraining erst bei erfüllten Kriterien und Freigabe.",criteria:["volle Trainingswoche verträglich","kein Folgetag-Rebound","Sportphysio/Arzt bestätigt Einstieg"]}
];

const strengthTemplates = [
  ["Beinpresse", "weight", "3 × 10", "Kontrolliert absenken und über den ganzen Fuß drücken.", "Kraftbasis mit wenig Gerätewechsel."],
  ["Rumänisches Kreuzheben", "weight", "3 × 8–10", "Hüfte nach hinten, Rücken neutral, Gewicht nah am Körper.", "Hintere Kette; Bewegungsumfang nur gut verträglich."],
  ["Glute Bridge", "weight", "3 × 10–12", "Hüfte heben, Gesäß aktiv, Rippen unten.", "Gesäß-/Beckenstreckung ohne aggressive Endposition."],
  ["Wadenheben", "weight", "3 × 12–15", "Langsam absenken, kontrolliert hochdrücken.", "Unterschenkelkraft."],
  ["Pallof Press", "weight", "3 × 10 je Seite", "Ausatmen, Rumpf gegen Rotation stabil halten.", "Core und Beckenstabilität."]
];

function mondayOfWeek(n){ const d=new Date(startDate); d.setDate(d.getDate()+(n-1)*7); return d; }
function fmtDate(d){ return d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}); }
function phaseFor(n){ return phases.find(p=>n>=p.from&&n<=p.to); }
function buildStrength(n){
  if(n<=3) return [
    ["Beinpresse","weight","2 × 10–12","Leicht bis moderat, kontrollierte Tiefe.","Kraftbasis; keine provokative Hüft-/Leistenposition."],
    ["Rumänisches Kreuzheben","weight","2 × 8–10","Kurzer bis mittlerer Bewegungsumfang, Hüfte nach hinten.","Hintere Kette; kein Dehnungsschmerz im Leistenbereich."],
    ["Glute Bridge","weight","3 × 10–12","Hüfte ruhig heben und senken.","Gesäß und Beckenstabilität."],
    ["Wadenheben","weight","3 × 12–15","Kontrollierte volle Bewegung.","Unterschenkel."],
    ["Pallof Press","weight","2 × 10 je Seite","Rumpf ruhig halten.","Anti-Rotation."],
    ["Adduktor-Isometrie leicht","time","3 × 20–30 Sek.","Sehr sanfter Druck gegen Ball/Pad; nicht maximal.","Nur schmerzarm und nur wenn von Behandler freigegeben."]
  ];
  if(n<=7) return [
    ["Beinpresse","weight","3 × 8–10","Kontrolliert absenken, kräftig hoch.","Progressive Kraftbasis."],
    ["Rumänisches Kreuzheben","weight","3 × 8","Hüfte nach hinten, Rücken neutral.","Hintere Kette."],
    ["Split Squat","weight","3 × 8 je Seite","Kontrolliert absenken, Becken stabil.","Einbeinige Kontrolle ohne seitliches Wegkippen."],
    ["Glute Bridge","weight","3 × 10–12","Oben kurz halten.","Gesäß/Becken."],
    ["Wadenheben","weight","3 × 12–15","Langsam absenken.","Unterschenkel."],
    ["Pallof Press","weight","3 × 10 je Seite","Rumpf gegen Rotation stabil.","Core."],
    ["Adduktor-Isometrie","time","3 × 30–45 Sek.","Submaximal drücken, gleichmäßig atmen.","Gezielte Adduktorenbelastung; nur gut verträglich."]
  ];
  if(n<=11) return [
    ["Beinpresse","weight","4 × 6–8","Kräftig hoch, kontrolliert zurück.","Kraftentwicklung."],
    ["Rumänisches Kreuzheben","weight","3 × 6–8","Sauberer Hüftknick.","Hintere Kette."],
    ["Step-up","weight","3 × 6 je Seite","Kontrolliert hoch, oben stabilisieren.","Einbeinige Kraft."],
    ["Glute Bridge","weight","3 × 8–10","Kräftig strecken, sauber zurück.","Hüftstreckung."],
    ["Wadenheben","weight","3 × 10–12","Kontrolliert.","Unterschenkel."],
    ["Pallof Press","weight","3 × 8–10 je Seite","Kein Verdrehen.","Core."],
    ["Adduktor-Isometrie","time","3 × 30–45 Sek.","Submaximal bis moderat.","Adduktorbelastung nach Verträglichkeit."]
  ];
  if(n<=14) return [
    ["Beinpresse","weight","3 × 6–8","Kraftvoll hoch, kontrolliert zurück.","Schwere Grundübung, wenig Stationswechsel."],
    ["Rumänisches Kreuzheben","weight","3 × 6–8","Hüfte nach hinten, neutraler Rücken.","Hintere Kette."],
    ["Step-up + Kniehub","weight","3 × 5–6 je Seite","Kontrolliert hoch, Kniehub nur wenn schmerzfrei.","Einbeinige und fußballspezifische Kontrolle."],
    ["Wadenheben","weight","3 × 10–12","Volle kontrollierte Bewegung.","Unterschenkel."],
    ["Adduktor-Maschine leicht","weight","2 × 10–12","Kleiner bis mittlerer Bewegungsumfang.","Nur wenn medizinisch freigegeben und schmerzarm."],
    ["Pallof Press","weight","3 × 8–10 je Seite","Rumpf stabil.","Core."],
    ["Seitlicher Band-Walk","time","3 × 30 Sek.","Kleine Schritte, Becken stabil.","Becken-/Hüftkontrolle."]
  ];
  return [
    ["Beinpresse","weight","3 × 5–6","Kraftvoll, aber nicht bis zur Ermüdung.","Kraft erhalten/aufbauen."],
    ["Rumänisches Kreuzheben","weight","3 × 6","Sauberer Hüftknick.","Hintere Kette."],
    ["Step-up + Kniehub","weight","3 × 5 je Seite","Explosiv nur so weit wie kontrolliert und schmerzfrei.","Einbeinige Fußballvorbereitung."],
    ["Wadenheben","weight","3 × 10","Kräftig und kontrolliert.","Unterschenkel."],
    ["Adduktor-Maschine moderat","weight","3 × 8–10","Kontrollierte Bewegung; kein Schmerzanstieg.","Adduktorenkraft, nur nach Freigabe."],
    ["Pallof Press","weight","3 × 8 je Seite","Rumpf stabil.","Core."],
    ["Seitlicher Band-Walk","time","3 × 30–40 Sek.","Kurze Schritte, stabile Beckenposition.","Beckenkontrolle."]
  ];
}

const weeks = Array.from({length:17},(_,i)=>{
  const n=i+1, d=mondayOfWeek(n), p=phaseFor(n);
  const run1 = n<=3?"10 Min. Gehen/lockeres Joggen; insgesamt 15–20 Min. · kein Tempo":n<=7?"10 Min. locker → 15–25 Min. ruhiges Laufen · optional 4 × 20 Sek. leicht zügig":n<=11?"10 Min. locker → 20–30 Min. locker → 4–6 × 30 Sek. zügig / 90 Sek. locker":n<=14?"10 Min. locker → 20–25 Min. → 6 × 30–45 Sek. zügig / 90 Sek. locker": "10 Min. locker → 20–25 Min. → 6 × 45–60 Sek. zügig / 90 Sek. locker; später kontrollierte Beschleunigungen";
  const run2 = n<=3?"15–25 Min. Gehen/lockeres Joggen; alternativ nur Gehen":n<=7?"20–30 Min. lockeres geradliniges Laufen":n<=11?"25–35 Min. locker + 6 × 20 Sek. kontrollierte Strides":n<=14?"25–35 Min. + Beschleunigen/Abbremsen mit submaximalem Tempo": "25–40 Min. mit Beschleunigen, Bremsen und schrittweisen Richtungswechseln; keine Vollsprints ohne Freigabe";
  const bike = n<=3?"25–35 Min. locker bis moderat":n<=7?"30–40 Min. · 5 × 2 Min. moderat-zügig / 2 Min. locker":n<=11?"35–45 Min. · 6–8 × 2 Min. zügig / 2 Min. locker":n<=14?"35–45 Min. · 8 × 1 Min. kräftig / 2 Min. locker": "35–45 Min. · 6 × 2 Min. kräftig / 2 Min. locker";
  return {n,label:`Woche ${n}`,range:`${fmtDate(d)} – ${fmtDate(new Date(d.getTime()+6*86400000))}`,phase:p,run1,run2,bike,strength:buildStrength(n)};
});

function save(){localStorage.setItem(KEY,JSON.stringify(data));const s=document.getElementById("saveStatus");if(s){s.textContent="Gerade gespeichert";setTimeout(()=>s.textContent="Lokal gespeichert",900)}updateDashboard();}
function get(k){return data.sessions[k] ?? ""}
function setVal(k,v){data.sessions[k]=v;save()}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function field(k,type="text",placeholder="",opts=""){return `<input type="${type}" value="${esc(get(k))}" placeholder="${esc(placeholder)}" ${opts} onchange="setVal('${k}',this.value)">`}
function renderWeekTabs(){document.getElementById("weekTabs").innerHTML=weeks.map((w,i)=>`<button class="${i===selectedWeek?"active":""}" onclick="selectWeek(${i})">${w.label}</button>`).join("");}
function currentExtras(){return data.extras.filter(x=>x.week===weeks[selectedWeek].n)}
function renderDayTabs(){
  const w=weeks[selectedWeek], extras=currentExtras();
  const tabs=[["t1","🏋️ Tag 1"],["t2","🚴 Tag 2"],["yoga","🧘 Yoga"]].concat(extras.map(x=>[`extra:${x.id}`,`＋ ${x.title}`])); if(w.n===17) tabs.push(["rtf","🏁 Return-to-Football-Test"]);
  if(!tabs.some(t=>t[0]===selectedTab)) selectedTab="t1";
  document.getElementById("dayTabs").innerHTML=tabs.map(([id,label])=>`<button class="${selectedTab===id?"active":""}" onclick="selectTab('${esc(id)}')">${esc(label)}</button>`).join("");
}
function selectWeek(i){selectedWeek=i;selectedTab="t1";renderPlan()}
function selectTab(id){selectedTab=id;renderPlan()}
function sessionHeader(w,type){
 const p=`w${w.n}_${type}`; const title=type==="t1"?"🏋️ Tag 1 · Kraft & Laufband":"🚴 Tag 2 · Fahrrad & Laufband";
 return `<div class="session-head"><div><div class="section-kicker">${w.phase.name}</div><h3>${title}</h3></div><span class="pill">${esc(w.range)}</span></div>
 <div class="phase-note"><strong>Wochenziel:</strong> ${esc(w.phase.goal)}</div>
 <div class="session-date"><div class="date-wide"><label>Trainingsdatum${field(`${p}_date`,"date")}</label></div><label>Start${field(`${p}_start`,"time")}</label><label>Ende${field(`${p}_end`,"time")}</label><label>RPE gesamt (1–10)${field(`${p}_rpe`,"number","z. B. 6",'min="1" max="10"')}<small>Eine Zahl für die gesamte Einheit – Lauf, Kraft, Athletik und Pausen zusammen.</small></label></div>`;
}
function exerciseRow(w,e,j){
 const [name,type,plan,desc,focus]=e, sets=(plan.match(/^(\d+)/)||[3,3])[1];
 const isTime=type==="time";
 const rows=Array.from({length:Number(sets)},(_,s)=>{
   const base=`w${w.n}_ex${j}_set${s+1}`;
   return `<div class="set-grid"><div class="tag">${s+1}</div>${isTime?field(`${base}_time`,"text","z. B. 40 Sek."):field(`${base}_weight`,"text","kg")}${isTime?"<span class="set-unit">Sek.</span>" :field(`${base}_reps`,"number","Wdh.", 'min="0" step="1"')}</div>`;
 }).join("");
 return `<div class="exercise-row"><div class="exercise-main"><div><div class="exercise-name">${esc(name)}</div><div class="exercise-desc">${esc(desc)}</div><div class="small"><strong>Fokus:</strong> ${esc(focus)}</div></div><span class="pill">${esc(plan)}</span></div><div class="set-grid"><div class="set-head">Satz</div><div class="set-head">${isTime?"Dauer":"Gewicht"}</div><div class="set-head">${isTime?"Einheit":"Wiederholungen"}</div></div>${rows}</div>`;
}
function strengthSection(w){return `<div class="plan-box"><h3>Kraft & Athletik</h3><p class="small">Jeder Satz wird einzeln dokumentiert. Bei Gewichtsübungen kannst du das Gewicht pro Satz ändern; bei Zeitübungen wird die Dauer pro Satz erfasst. Übungs-Notizen wurden bewusst entfernt.</p><div class="exercise-list">${w.strength.map((e,j)=>exerciseRow(w,e,j)).join("")}</div></div>`}
function sessionForm(w,type){const p=`w${w.n}_${type}`, is1=type==="t1";return `<div class="plan-box">${sessionHeader(w,type)}<p><strong>${is1?"Laufband":"Fahrrad"}:</strong> ${esc(is1?w.run1:w.bike)}</p>${!is1?`<p><strong>Laufband:</strong> ${esc(w.run2)}</p>`:""}<div class="form-grid"><label>${is1?"Laufband: Zeit / km / Tempo":"Fahrrad: Zeit / km / Watt"}${field(`${p}_${is1?"run":"bike"}`,"text",is1?"z. B. 25 Min / 3 km":"z. B. 40 Min / 15 km / 120 W")}</label>${is1?`<label>Laufgefühl / Beschwerden${field(`${p}_notes`,"text","z. B. stabil, kein Ziehen")}</label>`:`<label>Laufband: Zeit / km / Tempo${field(`${p}_run`,"text","z. B. 20 Min / 3 km")}</label>`}</div><div class="progress"><div class="bar" id="bar-${p}"></div></div><p class="small" id="prog-${p}"></p></div>${is1?strengthSection(w):""}`}
function yogaSection(w){const p=`w${w.n}_yoga`;return `<div class="plan-box"><div class="session-head"><div><div class="section-kicker">REGENERATION</div><h3>🧘 Yoga · Woche ${w.n}</h3></div><span class="pill">2 optionale Einheiten</span></div><p>Yoga bleibt als eigener Reiter in jeder Woche. Schwerpunkt: Atem, Beweglichkeit und Regeneration; keine aggressive Dehnung des verletzten Bereichs.</p><div class="form-grid"><label>Datum Yoga 1${field(`${p}1_date`,"date")}</label><label>Dauer Yoga 1${field(`${p}1_duration`,"number","Min.")}</label><label>RPE gesamt Yoga 1${field(`${p}1_rpe`,"number","1–10",'min="1" max="10"')}<small>Bewertung der gesamten Yoga-Einheit.</small></label><label>Fokus / Video Yoga 1${field(`${p}1_focus`,"text","z. B. Mobility")}</label><label>Datum Yoga 2${field(`${p}2_date`,"date")}</label><label>Dauer Yoga 2${field(`${p}2_duration`,"number","Min.")}</label><label>RPE gesamt Yoga 2${field(`${p}2_rpe`,"number","1–10",'min="1" max="10"')}<small>Bewertung der gesamten Yoga-Einheit.</small></label><label>Fokus / Video Yoga 2${field(`${p}2_focus`,"text","z. B. Recovery")}</label></div></div>`}
function extraSection(x){const p=`extra_${x.id}`;return `<div class="plan-box"><div class="session-head"><div><div class="section-kicker">ZUSATZTRAINING</div><h3>＋ ${esc(x.title)}</h3></div><button class="danger" onclick="removeExtra('${x.id}')">Reiter löschen</button></div><p><span class="pill">${esc(x.type)}</span> <span class="pill">Woche ${x.week}</span></p><div class="session-date"><div class="date-wide"><label>Trainingsdatum${field(`${p}_date`,"date")}</label></div><label>Start${field(`${p}_start`,"time")}</label><label>Ende${field(`${p}_end`,"time")}</label><label>RPE gesamt (1–10)${field(`${p}_rpe`,"number","1–10",'min="1" max="10"')}<small>Eine Bewertung für das komplette Zusatztraining.</small></label></div><div class="form-grid"><label>Dauer (Min.)${field(`${p}_duration`,"number","45")}</label><label>Ergebnis / Hinweise${field(`${p}_notes`,"text","Gefühl, Beschwerden")}</label></div></div>`}
function check(k,label,help="") { return `<label class="check-row"><input type="checkbox" ${get(k)==="1"?"checked":""} onchange="setVal('${k}',this.checked?'1':'')"><span><strong>${label}</strong>${help?`<small>${help}</small>`:""}</span></label>`; }
function numField(k,label,placeholder,opts="") { return `<label>${label}${field(k,"number",placeholder,opts)}</label>`; }
function returnToFootballTest(){
 const vals={rest:get("rtf_rest"),walk:get("rtf_walk"),squeeze:get("rtf_squeeze"),lsi:get("rtf_lsi"),run:get("rtf_run"),acc:get("rtf_acc"),cod:get("rtf_cod"),jump:get("rtf_jump"),pass:get("rtf_pass"),kick:get("rtf_kick"),reactive:get("rtf_reactive"),ball:get("rtf_ball"),sessions:get("rtf_sessions"),nextday:get("rtf_nextday"),clinician:get("rtf_clinician")};
 const numericSqueeze=vals.squeeze!==""&&Number(vals.squeeze)<=2, numericLsi=vals.lsi!==""&&Number(vals.lsi)>=90;
 const checks=[vals.rest,vals.walk,vals.run,vals.acc,vals.cod,vals.jump,vals.pass,vals.kick,vals.reactive,vals.ball,vals.sessions,vals.nextday,vals.clinician].filter(Boolean).length;
 const ready=vals.rest==="1"&&vals.walk==="1"&&numericSqueeze&&numericLsi&&vals.run==="1"&&vals.acc==="1"&&vals.cod==="1"&&vals.jump==="1"&&vals.pass==="1"&&vals.kick==="1"&&vals.reactive==="1"&&vals.ball==="1"&&vals.sessions==="1"&&vals.nextday==="1"&&vals.clinician==="1";
 return `<div class="plan-box rtf-box"><div class="session-head"><div><div class="section-kicker">FINALER MEILENSTEIN</div><h3>🏁 Return to Football Test</h3></div><span class="pill ${ready?"pill-success":"pill-warning"}">${ready?"Kriterien erfüllt":"Noch nicht freigegeben"}</span></div>
 <div class="notice warning"><strong>Kein einzelner Test kann eine medizinische Freigabe ersetzen.</strong> Diese Batterie kombiniert klinische Bereitschaft, Adduktorenkraft und fußballspezifische Belastungen. Sie sollte idealerweise mit Sportphysio/Arzt durchgeführt und bewertet werden. Bei Schmerzen oder Reaktion am Folgetag abbrechen bzw. Stufe zurücknehmen.</div>
 <h4>1 · Klinische Bereitschaft</h4><div class="check-list">${check("rtf_rest","Schmerz in Ruhe 0/10")}${check("rtf_walk","Gehen und Alltag ohne relevanten Schmerz / Hinken")}${check("rtf_nextday","Nach den letzten Belastungen keine relevante Verschlechterung am Folgetag")}</div>
 <div class="form-grid"><label>Adduktoren-Squeeze Schmerz 0–10${field("rtf_squeeze","number","z. B. 0",'min="0" max="10" step="1"')}<small>Für diese Batterie: Ziel ≤ 2/10; bei akuter Verletzung ist schmerzfreie Belastung die konservativere Vorgabe.</small></label><label>Adduktionskraft LSI (%)${field("rtf_lsi","number","z. B. 95",'min="0" max="120" step="1"')}<small>Wenn objektiv gemessen: Ziel ≥ 90 % zur Gegenseite; Testmethode dokumentieren.</small></label></div>
 <h4>2 · Lauf- und Belastungsprogression</h4><div class="check-list">${check("rtf_run","Geradliniges Laufen bis 100 % der geplanten Intensität symptomfrei")}${check("rtf_acc","Mehrfache Beschleunigungen und Abbremsungen bis 100 % symptomfrei")}${check("rtf_cod","Illinois Agility Test bei 100 % symptomfrei")}${check("rtf_reactive","Spider Test / reaktive Agility bei 100 % symptomfrei")}${check("rtf_jump","Beidbeinige und einbeinige Sprünge, Landungen und seitliche Sprünge symptomfrei")}</div>
 <h4>3 · Fußballbelastung</h4><div class="check-list">${check("rtf_pass","Pässe: kurz → lang, beide Füße, symptomfrei")}${check("rtf_kick","Flanken / Schüsse / hohe Kicks schrittweise bis voller Intensität symptomfrei")}${check("rtf_ball","Dribbling, Zweikämpfe/1-gegen-1 und unvorhersehbare Fußballaktionen symptomfrei")}${check("rtf_sessions","Mindestens 2–3 kontrollierte fußballspezifische Einheiten über mehrere Tage ohne Rebound vertragen")}</div>
 <h4>4 · Freigabe & Dokumentation</h4><div class="check-list">${check("rtf_clinician","Sportphysio/Arzt beurteilt die Rückkehr als vertretbar", "Die App erteilt keine medizinische Freigabe.")}</div>
 <div class="rtf-summary"><strong>${ready?"Bereit für einen progressiven Einstieg ins Mannschaftstraining – sofern die medizinische Freigabe vorliegt.":"Noch nicht bereit für den uneingeschränkten Einstieg."}</strong><p class="small">Erfüllte Checkpunkte: ${checks}/13 · Zahlenkriterien: ${numericSqueeze&&numericLsi?"2/2":"0/2"} · Squeeze: ${vals.squeeze||"–"}/10 · Adduktions-LSI: ${vals.lsi||"–"}%</p></div>
 <p class="small">Orientierung: Die sportartspezifische Progression umfasst Sprinten, Richtungswechsel, Sprünge sowie Pass-/Kicking-Drills. Ein schrittweiser Einstieg in normale Trainingseinheiten ist sinnvoller als ein einmaliger „Alles-oder-nichts“-Test.</p></div>`;
}
function renderPlan(){renderWeekTabs();renderDayTabs();const w=weeks[selectedWeek];let c=selectedTab==="t1"?sessionForm(w,"t1"):selectedTab==="t2"?sessionForm(w,"t2"):selectedTab==="yoga"?yogaSection(w):selectedTab==="rtf"?returnToFootballTest():extraSection(currentExtras().find(x=>`extra:${x.id}`===selectedTab));document.getElementById("weekContent").innerHTML=c;updateWeekProgress(w);}
function updateWeekProgress(w){let keys=[`w${w.n}_t1_date`,`w${w.n}_t2_date`,`w${w.n}_yoga1_date`,`w${w.n}_yoga2_date`];w.strength.forEach((e,j)=>{const sets=Number((e[2].match(/^(\d+)/)||[3,3])[1]);for(let s=1;s<=sets;s++)keys.push(`w${w.n}_ex${j}_set${s}_${e[1]==="time"?"time":"reps"}`)});const done=keys.filter(k=>get(k)!=="").length,pct=Math.round(done/keys.length*100);["t1","t2"].forEach(t=>{const el=document.getElementById(`bar-w${w.n}_${t}`),p=document.getElementById(`prog-w${w.n}_${t}`);if(el)el.style.width=pct+"%";if(p)p.textContent=`Dokumentiert: ${pct}%`})}
function getCompletedSessions(){const arr=[];weeks.forEach(w=>["t1","t2"].forEach(t=>{const p=`w${w.n}_${t}`,date=get(`${p}_date`);if(date)arr.push({date,rpe:Number(get(`${p}_rpe`))||null,duration:durationFor(p),notes:get(`${p}_notes`)||"",kind:t});}));data.extras.forEach(x=>{const p=`extra_${x.id}`,date=get(`${p}_date`)||x.date;if(date)arr.push({date,rpe:Number(get(`${p}_rpe`))||Number(x.rpe)||null,duration:Number(get(`${p}_duration`))||Number(x.duration)||45,notes:get(`${p}_notes`)||x.notes||"",kind:"extra"});});return arr.sort((a,b)=>a.date.localeCompare(b.date))}
function durationFor(p){const s=get(`${p}_start`),e=get(`${p}_end`);if(s&&e){const [sh,sm]=s.split(":").map(Number),[eh,em]=e.split(":").map(Number);let d=(eh*60+em)-(sh*60+sm);if(d<0)d+=1440;if(d>0)return d}return 45}
function assessment(){const recent=getCompletedSessions().slice(-4),r=recent.map(x=>x.rpe).filter(x=>x>=1&&x<=10),avg=r.length?r.reduce((a,b)=>a+b,0)/r.length:null,hard=r.filter(x=>x>=8).length,notes=recent.map(x=>x.notes).join(" ").toLowerCase(),warning=["schmerz","beschwer","ziehen","verletz","schwell","humpel","steif","probleme"].some(x=>notes.includes(x));let zone="green",label="Planmäßig",factor=1,rule="Belastung beibehalten und nur eine Variable auf einmal steigern.";if(warning){zone="red";label="Belastung bremsen";factor=.7;rule="Beschwerden dokumentiert: nächste Einheit 25–30 % kürzer/leichter und keine neue hohe Intensität."}else if(avg!==null&&(avg>=8||hard>=2)){zone="red";label="Deload";factor=.75;rule="Hohe Belastung: nächste Einheit ca. 25 % weniger Umfang; explosive Reize pausieren."}else if(avg!==null&&avg>=7){zone="yellow";label="Konservativ";factor=.9;rule="Belastung eher hoch: Umfang halten oder höchstens moderat steigern."}else if(avg!==null&&avg<=5&&recent.length>=2){zone="green";label="Progression möglich";factor=1.1;rule="Gute Verträglichkeit: höchstens ca. 10 % mehr Umfang bei nur einer Trainingsvariable."}return{recent,avg,hard,zone,label,factor,rule,warning}}
function renderAdaptation(){const a=assessment(),el=document.getElementById("adaptationPanel");el.innerHTML=`<div class="adaptation-grid"><div class="zone-card zone-${a.zone}"><div class="section-kicker">${a.label}</div><strong>${a.zone==="red"?"Nächste Einheit entlasten":a.zone==="yellow"?"Nächste Einheit konservativ":a.zone==="green"&&a.factor>1?"Progression möglich":"Plan beibehalten"}</strong><p>${esc(a.rule)}</p><div class="criteria"><span>Ø RPE ${a.avg?a.avg.toFixed(1):"–"}</span><span>${a.hard} × RPE ≥8</span><span>${a.recent.length} letzte Einheiten</span></div></div><div class="zone-card"><strong>Wochenentscheidung</strong><p>${a.zone==="red"?"Woche wiederholen bzw. Umfang reduzieren, bis Training und Folgetag stabil sind.":a.zone==="yellow"?"Woche mindestens halten; erst bei stabiler Verträglichkeit weitergehen.":a.factor>1?"Nächste Woche kann leicht gesteigert werden.":"Aktuelle Woche planmäßig fortführen."}</p><p class="small">Bei tatsächlichem Schmerz oder Verletzungszeichen nicht automatisch steigern.</p></div></div>`}
function allRpes(){return getCompletedSessions().map(x=>x.rpe).filter(x=>x>=1&&x<=10)}
function updateDashboard(){let total=0,done=0;weeks.forEach(w=>{total+=4; if(get(`w${w.n}_t1_date`))done++;if(get(`w${w.n}_t2_date`))done++;if(get(`w${w.n}_yoga1_date`))done++;if(get(`w${w.n}_yoga2_date`))done++;w.strength.forEach((e,j)=>{const sets=Number((e[2].match(/^(\d+)/)||[3,3])[1]);total+=sets;if(Array.from({length:sets},(_,s)=>get(`w${w.n}_ex${j}_set${s+1}_${e[1]==="time"?"time":"reps"}`).trim()).some(Boolean))done++})});const pct=Math.min(100,Math.round(done/Math.max(total,1)*100));document.getElementById("overallProgress").textContent=pct+"%";document.getElementById("overallBar").style.width=pct+"%";const r=allRpes();document.getElementById("avgRpe").textContent=r.length?(r.reduce((a,b)=>a+b,0)/r.length).toFixed(1):"–";document.getElementById("completedSessions").textContent=getCompletedSessions().length;document.getElementById("extraCount").textContent=data.extras.length;renderExtras();renderAdaptation()}
function renderExtras(){const el=document.getElementById("extraTrainings");if(!data.extras.length){el.innerHTML='<div class="empty">Noch keine Zusatztrainings. Eine neue Einheit wird der aktuell ausgewählten Woche als Reiter hinzugefügt.</div>';return}el.innerHTML=data.extras.slice().reverse().map(x=>`<div class="extra-item"><div><strong>${esc(x.title)}</strong><div class="item-meta"><span class="pill">${esc(x.type)}</span><span class="pill">Woche ${x.week}</span><span class="pill">${esc(get(`extra_${x.id}_date`)||x.date||"ohne Datum")}</span></div></div><button class="danger" onclick="removeExtra('${x.id}')">Löschen</button></div>`).join("")}
function openModal(){document.getElementById("trainingModal").classList.remove("hidden");document.getElementById("extraDate").value=new Date().toISOString().slice(0,10)}
function closeModal(){document.getElementById("trainingModal").classList.add("hidden")}
function addExtra(e){e.preventDefault();const id=Date.now().toString(36);data.extras.push({id,week:weeks[selectedWeek].n,type:document.getElementById("extraType").value,title:document.getElementById("extraTitle").value,date:document.getElementById("extraDate").value,duration:document.getElementById("extraDuration").value,rpe:document.getElementById("extraRpe").value,notes:document.getElementById("extraNotes").value});save();closeModal();document.getElementById("trainingForm").reset();selectedTab=`extra:${id}`;renderPlan()}
function removeExtra(id){data.extras=data.extras.filter(x=>x.id!==id);Object.keys(data.sessions).filter(k=>k.startsWith(`extra_${id}_`)).forEach(k=>delete data.sessions[k]);save();selectedTab="t1";renderPlan()}
function recommendations(){const a=assessment(),el=document.getElementById("recommendations");const list=a.zone==="red"?["20–30 Min. sehr lockeres Fahrrad oder Spaziergang","10–15 Min. Mobility ohne provokative Endposition","Leichter Core: Pallof Press / ruhige Rumpfarbeit"]:a.zone==="yellow"?["20–30 Min. lockere Grundlagenausdauer","10–15 Min. Mobility und kontrollierte Hüftbewegung","Technik: leichte Koordination ohne Sprint- oder Sprungbelastung"]:["25–40 Min. lockere Grundlagenausdauer","10–15 Min. Mobility / Yoga","Koordination und Technik mit niedriger bis moderater Intensität"];el.innerHTML=`<strong>Passend zur aktuellen Belastung:</strong><ul>${list.map(x=>`<li>${x}</li>`).join("")}</ul><p class="small">Bei Beschwerden gilt die Entlastungsregel unabhängig von der Empfehlung.</p>`;el.classList.remove("hidden")}
function resetData(){if(confirm("Wirklich alle Trainingsdaten löschen?")){data={sessions:{},extras:[]};save();selectedWeek=0;selectedTab="t1";renderPlan()}}
document.getElementById("recommendBtn").addEventListener("click",recommendations);document.getElementById("addTrainingBtn").addEventListener("click",openModal);document.getElementById("addTrainingTop").addEventListener("click",openModal);document.getElementById("resetBtn").addEventListener("click",resetData);document.getElementById("trainingForm").addEventListener("submit",addExtra);document.querySelectorAll("[data-close-modal]").forEach(x=>x.addEventListener("click",closeModal));
renderPlan();updateDashboard();
