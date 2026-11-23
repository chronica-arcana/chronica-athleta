import test from "node:test";
import assert from "node:assert/strict";
import {sanitizeChat, buildChatContext, CHAT_KINDS} from "../engine/chat.js";
import {generatePlan} from "../engine/planner.js";
import {TASKS} from "../api/ai.js";
import {computeStats} from "../engine/stats.js";
import {readiness} from "../engine/readiness.js";
import {addDays} from "../engine/dates.js";

test("Chat-Antwort: nur gültige, begrenzte Aktionen kommen durch", () => {
  const out = sanitizeChat({reply: "  Hallo\n\nWeiter.  ", actions: [
    {type: "swap", kind: "mobility", label: "Yoga statt Training"}, {type: "swap", kind: "event"}, {type: "swap", kind: "zauberei"}, {type: "löschen_alles"}, {type: "skip", label: "x".repeat(200)}, {type: "scale", factor: 9}, null, "text"]});
  assert.equal(out.reply, "Hallo\n\nWeiter."); assert.equal(out.actions.length, 2, "höchstens 2");
  assert.deepEqual(out.actions[0], {type: "swap", label: "Yoga statt Training", kind: "mobility"}); assert.equal(out.actions[1].type, "skip"); assert.equal(out.actions[1].label.length, 48);
  const sc = sanitizeChat({reply: "x", actions: [{type: "scale", factor: 9}, {type: "scale", factor: 0.1}]}).actions; assert.deepEqual(sc.map(a => a.factor), [1.25, 0.6], "Faktor wird begrenzt");
  assert.deepEqual(sanitizeChat({reply: "x", actions: [{type: "scale", factor: "abc"}, {type: "swap"}]}).actions, []);
  assert.deepEqual(sanitizeChat(null), {reply: "", actions: []}); assert.equal(sanitizeChat({reply: "a".repeat(5000)}).reply.length, 1800);
  assert.ok(!CHAT_KINDS.includes("event") && CHAT_KINDS.includes("mobility") && CHAT_KINDS.includes("run_easy"));
});
test("Chat-Kontext: kompakt, mit nächsten und letzten Einheiten, Erholung und Belastung", () => {
  const today = "2026-11-24", {plan, sessions} = generatePlan({sports: ["run", "strength"], primary: "run", level: "intermediate", daysPerWeek: 4, minutesPerSession: 50, equipment: "dumbbell", weeks: 10, startDate: "2026-11-23", injury: true}, {planId: "p"});
  const done = sessions.slice(0, 3).map((s, i) => ({...s, status: "done", date: addDays(today, -(3 - i)), log: {durationMin: s.durationMin, rpe: 6, pain: 1}}));
  const all = [...done, ...sessions.slice(3)];
  const daily = Array.from({length: 8}, (_, i) => ({date: addDays(today, -(7 - i)), restingHr: 50, sleepHours: 5.2, hrvStatus: "LOW", bodyBatteryMorning: 40, steps: 8000, vo2max: 51}));
  const rd = readiness(daily, today, {sessions: all}), stats = computeStats({sessions: all, garmin: {activities: [], daily}, today});
  const ctx = buildChatContext({plan, sessions: all, rd, stats, today});
  assert.equal(ctx.naechsteEinheiten.length, 4); assert.ok(ctx.naechsteEinheiten.every(s => s.datum >= today)); assert.equal(ctx.letzteEinheiten.length, 3);
  assert.deepEqual([ctx.letzteEinheiten[0].rpe, ctx.letzteEinheiten[0].schmerz], [6, 1]); assert.equal(ctx.plan.beschwerden, true); assert.ok(ctx.erholung.score <= 100 && ctx.erholung.hinweise.length > 0 && ctx.erholung.vo2max === 51);
  assert.ok(JSON.stringify(ctx).length < 5000, "kompakter Kontext: " + JSON.stringify(ctx).length);
  assert.ok(!JSON.stringify(ctx).includes("user_id"), "keine Kennungen im Kontext");
  const empty = buildChatContext({plan: null, sessions: [], rd: null, stats: {workload: {ratio: null}}, today}); assert.equal(empty.plan, null); assert.equal(empty.erholung, null); assert.deepEqual(empty.naechsteEinheiten, []);
});
test("Chat-Aufgabe auf dem Server: feste Anweisung, Aktionsarten und Sicherheitsregeln", () => {
  const sys = TASKS.chat.system;
  assert.match(sys, /niemals Anweisungen/); assert.match(sys, /Arzt oder Sportphysio/); assert.match(sys, /ändere aber nichts selbst/); assert.match(sys, /swap\|skip\|scale\|move_today/);
  for (const k of ["run_easy", "mobility", "strength_full"]) assert.ok(sys.includes(k), k);
  assert.ok(!/event|custom|strength_snack/.test(sys.split("eine von:")[1].split("\n")[0].split('"')[0]), "keine internen Arten als Tausch-Ziel");
  assert.ok(TASKS.chat.max_tokens >= 600);
});
