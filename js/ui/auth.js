import {html, useState} from "../../vendor/preact-htm.js";
import {auth, state, toast} from "../store.js";

export function AuthScreen() {
  const [mode, setMode] = useState("login"); // login | signup | reset
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const submit = async e => {
    e.preventDefault(); setBusy(true); setMsg("");
    try {
      if (mode === "login") await auth.signIn(email.trim(), pw);
      else if (mode === "signup") { const r = await auth.signUp(email.trim(), pw); setMsg(r.needsConfirm ? "Fast geschafft! Bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben." : "Konto erstellt."); }
      else { await auth.reset(email.trim()); setMsg("Falls ein Konto existiert, wurde ein Link zum Zurücksetzen gesendet."); }
    } catch (err) { setMsg("⚠ " + (/Invalid login/i.test(err.message) ? "E-Mail oder Passwort falsch." : err.message)); }
    setBusy(false);
  };
  return html`<div class="auth">
    <img class="logo" src="icons/icon-192.png" alt="Chronica Athleta" width="72" height="72" />
    <div class="stack" style="gap:6px"><div class="small bold muted" style="letter-spacing:.14em;text-transform:uppercase">Chronica</div><h1>Athleta</h1><p class="muted">Dein flexibler Trainingsplan: Laufen, Rad, Schwimmen, Kraft, Teamsport – mit KI-Coach, Garmin und einem Plan, der sich deinem Alltag anpasst.</p></div>
    <form class="stack" onSubmit=${submit}>
      <label class="field">E-Mail<input type="email" autocomplete="email" inputmode="email" required value=${email} onInput=${e => setEmail(e.target.value)} /></label>
      ${mode !== "reset" && html`<label class="field">Passwort<input type="password" autocomplete=${mode === "login" ? "current-password" : "new-password"} minlength="8" required value=${pw} onInput=${e => setPw(e.target.value)} /></label>`}
      ${msg && html`<div class="banner info">${msg}</div>`}
      <button class="btn primary block" disabled=${busy}>${busy ? "…" : mode === "login" ? "Anmelden" : mode === "signup" ? "Konto erstellen" : "Link senden"}</button>
    </form>
    <div class="row wrap" style="justify-content:center">
      ${mode !== "login" && html`<button class="btn ghost sm" onClick=${() => { setMode("login"); setMsg(""); }}>Zur Anmeldung</button>`}
      ${mode !== "signup" && html`<button class="btn ghost sm" onClick=${() => { setMode("signup"); setMsg(""); }}>Neu hier? Registrieren</button>`}
      ${mode === "login" && html`<button class="btn ghost sm" onClick=${() => { setMode("reset"); setMsg(""); }}>Passwort vergessen</button>`}
    </div>
    <p class="tiny muted center">Deine Daten gehören nur zu deinem Konto und werden per Zeilenschutz (Row Level Security) abgeschottet.</p>
  </div>`;
}

export function RecoveryScreen({onDone}) {
  const [pw, setPw] = useState(""), [msg, setMsg] = useState("");
  const submit = async e => { e.preventDefault(); try { await auth.updatePassword(pw); toast("Passwort geändert.", "info"); onDone(); } catch (err) { setMsg("⚠ " + err.message); } };
  return html`<div class="auth"><div class="logo">🔑</div><h1>Neues Passwort</h1>
    <form class="stack" onSubmit=${submit}><label class="field">Neues Passwort (min. 8 Zeichen)<input type="password" minlength="8" required value=${pw} onInput=${e => setPw(e.target.value)} /></label>
    ${msg && html`<div class="banner">${msg}</div>`}<button class="btn primary block">Speichern</button></form></div>`;
}
