
const KEY = "football_training_tracker_v2";
let data = JSON.parse(localStorage.getItem(KEY) || "{}");
data.sessions ||= {};
data.extras ||= [];
data.yoga ||= [];
let selectedWeek = 0;
let selectedDay = "t1";

function save() {
  localStorage.setItem(KEY, JSON.stringify(data));
  document.getElementById("saveStatus").textContent = "Gerade gespeichert";
  setTimeout(() => document.getElementById("saveStatus").textContent = "Lokal gespeichert", 900);
  updateDashboard();
}
function get(k) { return data.sessions[k] ?? ""; }
function set(k, v) { data.sessions[k] = v; save(); }

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function field(k, type="text", placeholder="") {
  return `<input type="${type}" value="${esc(get(k))}" placeholder="${esc(placeholder)}"
    onchange="set('${k}',this.value)" ${type==="number" ? 'min="1" max="10"' : ""}>`;
}

function renderWeekTabs() {
  document.getElementById("weekTabs").innerHTML = weeks.map((w, i) =>
    `<button class="${i===selectedWeek ? "active":""}" onclick="selectWeek(${i})">${esc(w.label)}</button>`
  ).join("");
  document.getElementById("dayTabs").innerHTML = [
    ["t1","Tag 1 · Kraft & Lauf"],
    ["t2","Tag 2 · Fahrrad & Lauf"]
  ].map(([id,label]) =>
    `<button class="${selectedDay===id ? "active":""}" onclick="selectDay('${id}')">${label}</button>`
  ).join("");
}

function selectWeek(i) { selectedWeek=i; renderPlan(); }
function selectDay(id) { selectedDay=id; renderPlan(); }

function strengthTable(w) {
  return `<div class="plan-box">
    <h3>🏋️ Kraft & Athletik</h3>
    <p class="small">Tatsächliche Wiederholungen und Gewicht dokumentieren.</p>
    <table><thead><tr><th>Übung</th><th>Plan</th><th>Gewicht</th><th>Ist-Wdh.</th><th>Notiz</th></tr></thead>
    <tbody>${w.strength.map((e,j)=>`
      <tr>
        <td><span class="exercise">${esc(e[0])}</span><br><span class="small">${esc(e[2])}<br><strong>Fokus:</strong> ${esc(e[3])}</span></td>
        <td>${esc(e[1])}</td>
        <td>${field(`w${w.n}_s${j}_weight`,"text","12,5 kg")}</td>
        <td>${field(`w${w.n}_s${j}_reps`,"text","10/10/9")}</td>
        <td>${field(`w${w.n}_s${j}_notes`,"text","Notiz")}</td>
      </tr>`).join("")}</tbody></table>
  </div>`;
}

function sessionForm(w, type) {
  const is1 = type==="t1";
  const prefix=`w${w.n}_${type}`;
  return `<div class="plan-box">
    <div class="session-summary">
      <span class="pill">${is1 ? "Tag 1" : "Tag 2"}</span>
      <span class="pill">${is1 ? "Kraft & Lauf" : "Fahrrad & Lauf"}</span>
    </div>
    <h3>${is1 ? "🏃 Laufband + Kraft/Athletik" : "🚴 Fahrrad + Laufband"}</h3>
    <p><strong>Plan:</strong> ${esc(is1 ? w.run1 : w.run2)}</p>
    ${!is1 ? `<p><strong>Fahrrad:</strong> ${esc(w.bike)}</p>` : ""}
    <table><thead><tr><th>Datum</th><th>Start</th><th>Ende</th><th>RPE</th><th>${is1 ? "Notizen" : "Rad: Zeit / km / Watt"}</th>${is1 ? "" : "<th>Lauf: Zeit / km / Tempo</th>"}</tr></thead>
    <tbody><tr>
      <td>${field(`${prefix}_date`,"date")}</td>
      <td>${field(`${prefix}_start`,"time")}</td>
      <td>${field(`${prefix}_end`,"time")}</td>
      <td>${field(`${prefix}_rpe`,"number","1–10")}</td>
      <td>${field(`${prefix}_${is1 ? "notes":"bike"}`,"text",is1 ? "Gefühl / Beschwerden" : "28 Min / 10 km")}</td>
      ${is1 ? "" : `<td>${field(`${prefix}_run`,"text","18 Min / 2,8 km")}</td>`}
    </tr></tbody></table>
    <div class="progress"><div class="bar" id="bar-${prefix}"></div></div>
    <p class="small" id="prog-${prefix}"></p>
  </div>`;
}

function renderPlan() {
  renderWeekTabs();
  const w=weeks[selectedWeek];
  let content;
  if(selectedDay==="t1") {
    content = `<div class="session-grid">${sessionForm(w,"t1")}${strengthTable(w)}</div>`;
  } else {
    content = sessionForm(w,"t2");
  }
  content += `<div class="plan-box" style="margin-top:14px">
    <h3>📝 Wochen-Notiz</h3>
    <textarea rows="3" onchange="set('w${w.n}_notes',this.value)" placeholder="Beine, Ausdauer, Beschwerden, Folgetag ...">${esc(get(`w${w.n}_notes`))}</textarea>
  </div>`;
  document.getElementById("weekContent").innerHTML=content;
  updateWeekProgress(w);
}

function updateWeekProgress(w) {
  const keys=[];
  for(let j=0;j<w.strength.length;j++) keys.push(`w${w.n}_s${j}_weight`,`w${w.n}_s${j}_reps`);
  keys.push(`w${w.n}_t1_date`,`w${w.n}_t2_date`);
  const done=keys.filter(k=>get(k)!=="").length;
  const pct=Math.round(done/keys.length*100);
  ["t1","t2"].forEach(type=>{
    const p=`w${w.n}_${type}`;
    const bar=document.getElementById(`bar-${p}`);
    const prog=document.getElementById(`prog-${p}`);
    if(bar) bar.style.width = (get(`${p}_date`) ? Math.max(pct,35) : Math.round(pct*.55))+"%";
    if(prog) prog.textContent = `Dokumentiert: ${pct}%`;
  });
}

function allRpes() {
  const vals=[];
  weeks.forEach(w=>["t1","t2"].forEach(t=>{
    const n=Number(get(`w${w.n}_${t}_rpe`));
    if(n>=1 && n<=10) vals.push(n);
  }));
  data.extras.forEach(x=>{ if(x.rpe) vals.push(Number(x.rpe)); });
  return vals.filter(Number.isFinite);
}

function updateDashboard() {
  let expected=0, done=0;
  weeks.forEach(w=>{
    expected += w.strength.length*2 + 2;
    for(let j=0;j<w.strength.length;j++) {
      if(get(`w${w.n}_s${j}_weight`) && get(`w${w.n}_s${j}_reps`)) done++;
    }
    if(get(`w${w.n}_t1_date`)) done++;
    if(get(`w${w.n}_t2_date`)) done++;
  });
  const pct=Math.round(done/expected*100);
  document.getElementById("overallProgress").textContent=pct+"%";
  document.getElementById("overallBar").style.width=pct+"%";
  let completed=weeks.reduce((n,w)=>n+(get(`w${w.n}_t1_date`)?1:0)+(get(`w${w.n}_t2_date`)?1:0),0);
  completed += data.extras.length + data.yoga.length;
  document.getElementById("completedSessions").textContent=completed;
  const r=allRpes();
  document.getElementById("avgRpe").textContent=r.length ? (r.reduce((a,b)=>a+b,0)/r.length).toFixed(1) : "–";
  document.getElementById("extraCount").textContent=data.extras.length;
  renderExtras();
  renderYoga();
  renderAdaptation();
}

function renderExtras() {
  const el=document.getElementById("extraTrainings");
  if(!data.extras.length){ el.innerHTML=`<div class="empty">Noch keine Zusatztrainings. Nutze „＋ Training hinzufügen“.</div>`; return; }
  el.innerHTML=data.extras.slice().reverse().map((x,idx)=>{
    const realIndex=data.extras.length-1-idx;
    return `<div class="extra-item">
      <div><strong>${esc(x.title)}</strong>
        <div class="item-meta"><span class="pill">${esc(x.type)}</span><span class="pill">${esc(x.date)}</span>${x.duration?`<span class="pill">${esc(x.duration)} Min.</span>`:""}${x.rpe?`<span class="pill">RPE ${esc(x.rpe)}</span>`:""}</div>
        <div class="small">${esc(x.notes||"Keine Notiz")}</div>
      </div>
      <div class="item-actions"><button class="danger" onclick="removeExtra(${realIndex})">Löschen</button></div>
    </div>`;
  }).join("");
}

function renderYoga() {
  const el=document.getElementById("yogaList");
  if(!data.yoga.length){ el.innerHTML=`<div class="empty">Yoga ist als eigenes Training getrennt erfasst. Füge hier Yoga 1/2 oder freie Einheiten hinzu.</div>`; return; }
  el.innerHTML=data.yoga.slice().reverse().map((x,idx)=>{
    const realIndex=data.yoga.length-1-idx;
    return `<div class="yoga-item">
      <div><strong>${esc(x.title||"Yoga")}</strong>
        <div class="item-meta"><span class="pill">${esc(x.date)}</span>${x.duration?`<span class="pill">${esc(x.duration)} Min.</span>`:""}${x.focus?`<span class="pill">${esc(x.focus)}</span>`:""}</div>
        <div class="small">${esc(x.notes||"")}</div>
      </div>
      <button class="danger" onclick="removeYoga(${realIndex})">Löschen</button>
    </div>`;
  }).join("");
}

function getCompletedSessions() {
  const sessions=[];
  weeks.forEach(w=>["t1","t2"].forEach(t=>{
    const p=`w${w.n}_${t}`, date=get(`${p}_date`);
    if(date) sessions.push({kind:t==="t1"?"Kraft & Lauf":"Fahrrad & Lauf",date,rpe:Number(get(`${p}_rpe`))||null,notes:get(`${p}_notes`)||get(`w${w.n}_notes`)||""});
  }));
  data.extras.forEach(x=>sessions.push({kind:x.type||"Zusatztraining",date:x.date,rpe:Number(x.rpe)||null,notes:x.notes||"",duration:Number(x.duration)||45}));
  return sessions.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}

function getLoadAssessment() {
  const recent=getCompletedSessions().slice(-4), rpes=recent.map(s=>s.rpe).filter(n=>n>=1&&n<=10);
  const avg=rpes.length?rpes.reduce((a,b)=>a+b,0)/rpes.length:null;
  const hardCount=rpes.filter(n=>n>=8).length;
  const loadValues=recent.map(s=>s.rpe?s.rpe*(s.duration||45):null).filter(Boolean);
  const loadAvg=loadValues.length?loadValues.reduce((a,b)=>a+b,0)/loadValues.length:null;
  const notes=recent.map(s=>s.notes).join(" ").toLowerCase();
  const warning=["schmerz","beschwer","ziehen","verletz","schwell","humpel","steif","probleme"].some(x=>notes.includes(x));
  let zone="green", factor=1, label="Normale Progression", rule="Planmäßig weiterführen.";
  if(warning){zone="red";factor=.70;label="Belastung bremsen";rule="Beschwerden erkannt: nächste Einheit um ca. 30 % im Umfang reduzieren und keine zusätzliche Intensität einbauen.";}
  else if(avg!==null&&(avg>=8||hardCount>=2)){zone="red";factor=.75;label="Deload / Entlastung";rule="Hohe Belastung: nächsten Umfang um ca. 25 % reduzieren; schnelle Abschnitte bzw. explosive Zusatzreize zurückstellen.";}
  else if(avg!==null&&avg>=7){zone="yellow";factor=.90;label="Konservativ steigern";rule="Belastung eher hoch: Umfang nur moderat erhöhen oder zunächst halten.";}
  else if(avg!==null&&avg<=5&&recent.length>=2){zone="green";factor=1.10;label="Progression möglich";rule="Gute Verträglichkeit: maximal eine Variable um ca. 10 % erhöhen.";}
  return {recent,avg,hardCount,loadAvg,warning,zone,factor,label,rule};
}

function nextTrainingAdjustment(){
  const a=getLoadAssessment();
  if(a.zone==="red") return {title:"Nächste Einheit: 25–30 % weniger Umfang",detail:"Kürzere/lockerere Version des aktuellen Plans; keine zusätzliche intensive oder explosive Belastung."};
  if(a.zone==="yellow") return {title:"Nächste Einheit: ca. 10 % konservativer",detail:"Intensität kontrolliert halten und nur eine Trainingsvariable verändern."};
  if(a.factor>1) return {title:"Nächste Einheit: bis zu 10 % Progression",detail:"Nur bei gutem Folgetag; etwas mehr Umfang oder eine kleine Wiederholungssteigerung, nicht beides."};
  return {title:"Nächste Einheit: Plan beibehalten",detail:"Aktuell spricht die Dokumentation für eine normale Weiterführung."};
}

function renderAdaptation(){
  const a=getLoadAssessment(), next=nextTrainingAdjustment();
  const zoneText=a.zone==="red"?"ROT":a.zone==="yellow"?"GELB":"GRÜN";
  document.getElementById("adaptationPanel").innerHTML=`
    <div class="adaptation zone-${a.zone}"><strong>${zoneText} · ${a.label}</strong><span class="small">${a.rule}</span></div>
    <div class="adaptation"><strong>${next.title}</strong><span class="small">${next.detail}</span></div>
    <div class="adaptation"><strong>Belastungsdaten</strong><span class="small">${a.recent.length} aktuelle Einheit(en) · ${a.avg!==null?"Ø RPE "+a.avg.toFixed(1):"noch kein RPE"} · ${a.hardCount}× RPE ≥ 8${a.loadAvg?" · Ø Last "+Math.round(a.loadAvg)+" RPE-Min.":""}</span></div>`;
}

function openModal() {
  document.getElementById("trainingModal").classList.remove("hidden");
  document.getElementById("extraDate").value=new Date().toISOString().slice(0,10);
  document.getElementById("extraTitle").focus();
}
function closeModal() { document.getElementById("trainingModal").classList.add("hidden"); }
function removeExtra(i) { data.extras.splice(i,1); save(); }
function removeYoga(i) { data.yoga.splice(i,1); save(); }

document.getElementById("addTrainingBtn").onclick=openModal;
document.getElementById("addTrainingTop").onclick=openModal;
document.querySelectorAll("[data-close-modal]").forEach(x=>x.addEventListener("click",closeModal));
document.getElementById("recommendBtn").onclick=()=>{
  const a=getLoadAssessment();
  const list=(a.warning||a.zone==="red")?[
    ["Regeneration","20–30 Min. sehr lockere Mobility/Yoga-Einheit. Kein zusätzlicher harter Reiz."],
    ["Aktive Erholung","20–30 Min. lockeres Fahrrad oder Spaziergang, nur beschwerdefrei."],
    ["Core leicht","10–15 Min. kontrollierte Core-Arbeit ohne zusätzliche Beinermüdung."]
  ]:a.zone==="yellow"?[
    ["Mobility","15–25 Min. Hüfte, Sprunggelenk und hintere Kette."],
    ["Grundlagenausdauer","25–35 Min. locker, ohne zusätzliche Intervalle."],
    ["Technik","15–20 Min. leichte Koordination/Fußarbeit statt Maximalbelastung."]
  ]:[
    ["Mobility","15–25 Min. Hüfte, Sprunggelenk und hintere Kette."],
    ["Grundlagenausdauer","25–40 Min. lockeres Fahrrad oder Joggen, wenn der Folgetag beschwerdefrei ist."],
    ["Athletik","15–20 Min. Technik/Koordination mit niedriger bis moderater Ermüdung."]
  ];
  document.getElementById("recommendations").classList.remove("hidden");
  document.getElementById("recommendations").innerHTML=`<div class="recommendation"><strong>Auf Basis: ${a.label}</strong><div class="small">Die Vorschläge berücksichtigen aktuelle RPE-Werte und Notizen.</div></div>`+list.map(([x,y])=>`<div class="recommendation"><strong>${x}</strong><div class="small">${y}</div></div>`).join("");
};
document.getElementById("trainingForm").addEventListener("submit",e=>{
  e.preventDefault();
  data.extras.push({
    type:document.getElementById("extraType").value,
    title:document.getElementById("extraTitle").value,
    date:document.getElementById("extraDate").value,
    duration:document.getElementById("extraDuration").value,
    rpe:document.getElementById("extraRpe").value,
    notes:document.getElementById("extraNotes").value
  });
  save(); e.target.reset(); closeModal();
});
document.getElementById("addYogaBtn").onclick=()=>{
  const title=prompt("Yoga-Einheit / Titel (z. B. Yoga 1 oder Yoga 2):","Yoga");
  if(!title) return;
  const date=prompt("Datum (YYYY-MM-DD):",new Date().toISOString().slice(0,10));
  data.yoga.push({title,date,duration:prompt("Dauer in Minuten:","30")||"",focus:prompt("Fokus / Video:","")||"",notes:""});
  save();
};
document.getElementById("resetBtn").onclick=()=>{
  if(confirm("Wirklich alle gespeicherten Trainingsdaten löschen?")) {
    data={sessions:{},extras:[],yoga:[]}; save(); renderPlan(); updateDashboard();
  }
};

renderPlan();
updateDashboard();
