import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnnouncer, defaultReadMs, type Speaker } from "../src/ui/announcer-model.ts";
import { createEventLog, EVENT_LOG_LIMIT } from "../src/ui/event-log-model.ts";
import { createGameEvents, defaultPriority, type GameEventInput } from "../src/ui/game-events.ts";
import { createNotificationCenter, PENDING_LIMIT, RELEVANT_TTL_MS, SUMMARY_KEY } from "../src/ui/notification-center-model.ts";
import { DEFAULT_PREFERENCES, parsePreferences, preferenceAttributes, serializePreferences } from "../src/ui/preferences-model.ts";
import { canAutoSwitch, rememberedTab, type ActivityState } from "../src/ui/tab-activity.ts";

// Modelos puros de la interfaz (G3b, P1): fuente de eventos, historial, notificaciones pendientes, anunciador, preferencias y
// regla de actividad. No usan el DOM.

let clock = 1_000_000;
const events = () => createGameEvents(() => clock);
const input = (over: Partial<GameEventInput> = {}): GameEventInput => ({ kind: "aporte", importance: "normal", text: "Aporte", ...over });

test("fuente de eventos: ids crecientes, hora, suscripción y prioridad por omisión (tabla de Q209)", () => {
  const bus = events();
  const seen: number[] = [];
  const off = bus.subscribe((e) => seen.push(e.id));
  const a = bus.emit(input());
  const b = bus.emit(input({ own: true }));
  assert.deepEqual([a.id, b.id, a.at], [1, 2, clock]);
  off();
  bus.emit(input());
  assert.deepEqual(seen, [1, 2], "tras cancelar la suscripción no recibe más");

  assert.equal(defaultPriority("error", "critica", true), 0);
  assert.equal(defaultPriority("conexion", "critica", false), 0);
  assert.equal(defaultPriority("oferta", "critica", true), 1, "una oferta pendiente se anuncia con educación, no interrumpe");
  assert.equal(defaultPriority("habilidad", "relevante", true), 1);
  assert.equal(defaultPriority("habilidad", "relevante", false), 2, "lo que no te concierne no se anuncia");
  assert.equal(defaultPriority("recoleccion", "normal", true), 2);
  assert.equal(bus.emit(input({ kind: "error", importance: "critica" })).priority, 0);
  assert.equal(bus.emit(input({ kind: "mision", importance: "relevante", own: true, priority: 2 })).priority, 2, "la prioridad explícita manda");
});

test("historial: orden cronológico, filtros, repetidos ×N, tope de 200 que expulsa lo más antiguo y contador de nuevas", () => {
  const bus = events();
  const log = createEventLog();
  bus.subscribe((e) => log.add(e));
  bus.emit(input({ kind: "aporte", text: "uno" }));
  bus.emit(input({ kind: "recoleccion", text: "dos" }));
  bus.emit(input({ kind: "error", importance: "critica", key: "error:x", text: "fallo" }));
  bus.emit(input({ kind: "error", importance: "critica", key: "error:x", text: "fallo" }));
  assert.deepEqual(log.list().map((e) => e.event.text), ["uno", "dos", "fallo"]);
  assert.equal(log.list().at(-1)!.repeats, 2, "el mismo evento con clave seguido se cuenta ×2");
  assert.deepEqual(log.list(new Set(["aporte"])).map((e) => e.event.text), ["uno"]);
  assert.equal(log.unread(), 4);
  log.markRead();
  assert.equal(log.unread(), 0);

  const big = createEventLog();
  const bus2 = events();
  bus2.subscribe((e) => big.add(e));
  for (let i = 1; i <= EVENT_LOG_LIMIT + 50; i++) bus2.emit(input({ text: `e${i}` }));
  assert.equal(big.size(), EVENT_LOG_LIMIT);
  assert.equal(big.list()[0]!.event.text, "e51", "se expulsa lo más antiguo");
  assert.equal(big.list().at(-1)!.event.text, `e${EVENT_LOG_LIMIT + 50}`);
  big.clear();
  assert.equal(big.size(), 0);
});

test("notificaciones: solo crítica y relevante; misma clave se fusiona ×N; los normales no crean aviso", () => {
  const bus = events();
  const center = createNotificationCenter();
  bus.subscribe((e) => center.add(e));
  assert.equal(center.add(bus.emit(input())), undefined);
  bus.emit(input({ kind: "oferta", importance: "critica", key: "oferta:1", text: "Ana te ofrece Molinero" }));
  bus.emit(input({ kind: "oferta", importance: "critica", key: "oferta:1", text: "Ana te ofrece Molinero" }));
  bus.emit(input({ kind: "habilidad", importance: "relevante", key: "nivel", text: "Subes" }));
  assert.equal(center.pending().length, 2);
  assert.equal(center.get("oferta:1")!.count, 2);
  assert.equal(center.pending()[0]!.key, "oferta:1", "las críticas van primero");
});

test("separación de almacenes: expulsar del historial no toca las pendientes, y los 200 eventos no borran una crítica", () => {
  const bus = events();
  const log = createEventLog();
  const center = createNotificationCenter();
  bus.subscribe((e) => log.add(e));
  bus.subscribe((e) => center.add(e));
  const critical = bus.emit(input({ kind: "oferta", importance: "critica", key: "oferta:77", text: "Oferta pendiente" }));
  for (let i = 0; i < EVENT_LOG_LIMIT * 2; i++) bus.emit(input({ text: `ruido ${i}` }));
  assert.ok(!log.list().some((e) => e.event.id === critical.id), "el historial ya expulsó la oferta");
  assert.equal(center.get("oferta:77")!.state, "pendiente", "la notificación sigue pendiente");
  assert.deepEqual(center.pending().map((n) => n.key), ["oferta:77"]);
});

test("tres acciones distintas: descartar solo oculta el aviso; resolver lo cierra por la operación; el historial no se toca", () => {
  const bus = events();
  const log = createEventLog();
  const center = createNotificationCenter();
  bus.subscribe((e) => log.add(e));
  bus.subscribe((e) => center.add(e));
  bus.emit(input({ kind: "oferta", importance: "critica", key: "oferta:9", text: "Oferta" }));
  assert.equal(center.dismiss("oferta:9"), true);
  assert.equal(center.get("oferta:9")!.state, "descartada");
  assert.deepEqual(center.pending(), [], "sale de Importantes");
  assert.equal(log.list().length, 1, "descartar no borra del historial");
  // La operación sigue viva: su resultado llega después y la RESUELVE (no la descarta).
  assert.equal(center.resolve("oferta:9"), true);
  assert.equal(center.get("oferta:9")!.state, "resuelta");
  assert.equal(center.resolve("oferta:9"), false, "resolver es idempotente");
  assert.equal(center.dismiss("oferta:9"), false, "lo ya cerrado no se puede descartar");
  assert.equal(center.dismiss("no-existe"), false);

  // Resolver una pendiente la saca de Importantes sin que nadie la haya descartado.
  bus.emit(input({ kind: "conexion", importance: "critica", key: "conexion", text: "Conexión perdida" }));
  assert.equal(center.pending().length, 1);
  center.resolve("conexion");
  assert.equal(center.pending().length, 0);
  assert.equal(log.list().length, 2);
});

test("relevantes caducan solas a los 10 s y pasan solo al historial; las críticas no caducan nunca", () => {
  const bus = events();
  const log = createEventLog();
  const center = createNotificationCenter();
  bus.subscribe((e) => log.add(e));
  bus.subscribe((e) => center.add(e));
  const t0 = clock;
  bus.emit(input({ kind: "habilidad", importance: "relevante", key: "nivel", text: "Subes" }));
  bus.emit(input({ kind: "error", importance: "critica", key: "error:y", text: "Error" }));
  assert.equal(center.tick(t0 + RELEVANT_TTL_MS - 1), 0);
  assert.equal(center.tick(t0 + RELEVANT_TTL_MS), 1);
  assert.equal(center.get("nivel")!.state, "expirada");
  assert.equal(center.tick(t0 + 10 * 60_000), 0);
  assert.deepEqual(center.pending().map((n) => n.key), ["error:y"], "la crítica sigue pendiente");
  assert.equal(log.list().length, 2, "ambas siguen en el historial");
  // Una relevante repetida renueva su plazo.
  const t1 = clock + 100_000;
  clock = t1;
  bus.emit(input({ kind: "mision", importance: "relevante", key: "m", text: "Misión" }));
  clock = t1 + 6000;
  bus.emit(input({ kind: "mision", importance: "relevante", key: "m", text: "Misión" }));
  assert.equal(center.tick(t1 + 12_000), 0, "se renovó a los 6 s: caduca a los 16 s");
  assert.equal(center.tick(t1 + 16_000), 1);
});

test("límite de seguridad: se agrupan las relevantes más antiguas y las críticas nunca se pierden ni se agrupan", () => {
  const bus = events();
  const center = createNotificationCenter();
  bus.subscribe((e) => center.add(e));
  for (let i = 0; i < 10; i++) bus.emit(input({ kind: "oferta", importance: "critica", key: `oferta:${i}`, text: `Oferta ${i}` }));
  for (let i = 0; i < PENDING_LIMIT + 20; i++) bus.emit(input({ kind: "habilidad", importance: "relevante", key: `r:${i}`, text: `Relevante ${i}` }));
  const pending = center.pending();
  assert.ok(pending.length <= PENDING_LIMIT, `pendientes ${pending.length}`);
  assert.equal(pending.filter((n) => n.event.importance === "critica").length, 10, "las 10 críticas siguen pendientes");
  const summary = center.get(SUMMARY_KEY)!;
  assert.ok(summary && summary.count > 1 && /agrupados/.test(summary.event.text));
  // Solo críticas: el límite no las toca aunque se supere.
  const only = createNotificationCenter({ limit: 5 });
  const bus2 = events();
  bus2.subscribe((e) => only.add(e));
  for (let i = 0; i < 12; i++) bus2.emit(input({ kind: "oferta", importance: "critica", key: `c:${i}`, text: `c${i}` }));
  assert.equal(only.pending().length, 12, "las críticas no se pierden nunca por el límite");
});

// ---- anunciador

function recorder() {
  const said: string[] = [];
  const speaker: Speaker = { alert: (t) => said.push(`ALERT ${t}`), polite: (t) => said.push(`POLITE ${t}`) };
  return { said, speaker };
}
const emit = (bus: ReturnType<typeof events>, a: ReturnType<typeof createAnnouncer>, e: GameEventInput, now = clock) => { const ev = bus.emit(e); a.push(ev, now); return ev; };

test("anunciador P0: inmediato y asertivo; el mismo mensaje no se repite en 5 s y sí después", () => {
  const { said, speaker } = recorder();
  const a = createAnnouncer({ speaker });
  const bus = events();
  emit(bus, a, input({ kind: "error", importance: "critica", key: "error:x", text: "No tienes permiso" }), 0);
  emit(bus, a, input({ kind: "error", importance: "critica", key: "error:x", text: "No tienes permiso" }), 4000);
  emit(bus, a, input({ kind: "error", importance: "critica", key: "error:otro", text: "Otro error" }), 4100);
  emit(bus, a, input({ kind: "error", importance: "critica", key: "error:x", text: "No tienes permiso" }), 5000);
  assert.deepEqual(said, ["ALERT No tienes permiso", "ALERT Otro error", "ALERT No tienes permiso"]);
  assert.equal(a.stats().deduplicated, 1);
});

test("anunciador P1: cola educada de uno en uno, dosificada por lectura y SIN descartar", () => {
  const { said, speaker } = recorder();
  const a = createAnnouncer({ speaker });
  const bus = events();
  emit(bus, a, input({ kind: "habilidad", importance: "relevante", own: true, text: "Subes a Oficial" }), 0);
  emit(bus, a, input({ kind: "mision", importance: "relevante", own: true, text: "Misión completada" }), 0);
  a.tick(0);
  assert.deepEqual(said, ["POLITE Subes a Oficial"]);
  a.tick(500);
  assert.equal(said.length, 1, "se espera al tiempo de lectura antes del siguiente");
  a.tick(defaultReadMs("Subes a Oficial"));
  assert.deepEqual(said, ["POLITE Subes a Oficial", "POLITE Misión completada"]);
  assert.equal(a.queueLength(), 0);
});

test("anunciador P1: agrupa solo eventos iguales y seguidos", () => {
  const { said, speaker } = recorder();
  const a = createAnnouncer({ speaker });
  const bus = events();
  const wood = (n: number) => input({ kind: "recoleccion", importance: "relevante", own: true, text: `Has recogido ${n} de madera`, group: { key: "recoleccion:madera", amount: n, text: (t) => `Has recogido ${t} de madera` } });
  emit(bus, a, wood(1), 0); emit(bus, a, wood(1), 100); emit(bus, a, wood(1), 200);
  emit(bus, a, input({ kind: "habilidad", importance: "relevante", own: true, text: "Subes" }), 300);
  emit(bus, a, wood(2), 400);
  let now = 0;
  for (let i = 0; i < 6; i++) { a.tick(now); now += 5000; }
  assert.deepEqual(said, ["POLITE Has recogido 3 de madera", "POLITE Subes", "POLITE Has recogido 2 de madera"], "no se agrupa a través de otro evento");
});

test("anunciador P1: con más de 4 en cola se anuncia un resumen y no se pierde ninguno (cada uno queda en pantalla)", () => {
  const { said, speaker } = recorder();
  const a = createAnnouncer({ speaker });
  const bus = events();
  const log = createEventLog();
  const center = createNotificationCenter();
  bus.subscribe((e) => { log.add(e); center.add(e); });
  const all: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const text = `Novedad ${i}`;
    all.push(text);
    const ev = bus.emit(input({ kind: "habilidad", importance: "relevante", own: true, key: `n${i}`, text }));
    a.push(ev, 0);
  }
  a.tick(0);
  assert.equal(said.length, 1);
  assert.match(said[0]!, /^POLITE Tienes 7 novedades importantes: Novedad 1; Novedad 2; Novedad 3 y 4 más\. Están en Importantes\.$/);
  assert.equal(a.queueLength(), 0, "la cola se vacía entera");
  // Información no perdida: todas siguen visibles en Importantes y en el historial.
  assert.deepEqual(center.pending().map((n) => n.event.text).sort(), [...all].sort());
  assert.deepEqual(log.list().map((e) => e.event.text), all);
  // Hasta 4 no se resume: salen una a una.
  const second = recorder();
  const b = createAnnouncer({ speaker: second.speaker });
  const bus2 = events();
  for (let i = 1; i <= 4; i++) emit(bus2, b, input({ kind: "habilidad", importance: "relevante", own: true, text: `N${i}` }), 0);
  let now = 0;
  for (let i = 0; i < 8; i++) { b.tick(now); now += 5000; }
  assert.deepEqual(second.said, ["POLITE N1", "POLITE N2", "POLITE N3", "POLITE N4"]);
});

test("anunciador P2: mudo por omisión; «completos» da un resumen periódico, nunca línea a línea; «mínimos» solo P0", () => {
  const { said, speaker } = recorder();
  const a = createAnnouncer({ speaker });
  const bus = events();
  const aporte = () => input({ kind: "aporte", importance: "normal", text: "Bea aportó" });
  for (let i = 0; i < 5; i++) emit(bus, a, aporte(), i * 100);
  a.tick(60_000);
  assert.deepEqual(said, [], "normales: P2 sin anuncio automático");
  assert.equal(a.stats().silenced, 5);

  const full = recorder();
  const c = createAnnouncer({ speaker: full.speaker, verbosity: "completos" });
  const bus2 = events();
  emit(bus2, c, aporte(), 0); emit(bus2, c, aporte(), 100); emit(bus2, c, input({ kind: "fabricacion", importance: "normal", text: "Fabricó" }), 200);
  c.tick(9000);
  assert.deepEqual(full.said, [], "antes de 10 s no se resume");
  c.tick(10_000);
  assert.deepEqual(full.said, ["POLITE Mientras tanto: 2 aportes, 1 fabricación."]);
  c.tick(40_000);
  assert.equal(full.said.length, 1, "no se repite sin nuevos eventos");

  const min = recorder();
  const m = createAnnouncer({ speaker: min.speaker, verbosity: "minimos" });
  const bus3 = events();
  emit(bus3, m, input({ kind: "habilidad", importance: "relevante", own: true, text: "Subes" }), 0);
  emit(bus3, m, input({ kind: "error", importance: "critica", key: "e", text: "Fallo" }), 0);
  m.tick(0);
  assert.deepEqual(min.said, ["ALERT Fallo"], "mínimos: solo P0");
});

test("anunciador: nada se anuncia dos veces y cambiar la verbosidad en marcha se respeta", () => {
  const { said, speaker } = recorder();
  const a = createAnnouncer({ speaker });
  const bus = events();
  const ev = bus.emit(input({ kind: "error", importance: "critica", key: "e", text: "Fallo" }));
  a.push(ev, 0);
  a.push(ev, 10_000);
  assert.equal(said.length, 1, "el mismo evento no se vuelve a anunciar");
  a.setVerbosity("minimos");
  assert.equal(a.verbosity(), "minimos");
  emit(bus, a, input({ kind: "habilidad", importance: "relevante", own: true, text: "Subes" }), 0);
  a.tick(0);
  assert.equal(said.length, 1);
});

// ---- preferencias y actividad

test("preferencias: valores por omisión, válidas, datos corruptos y desconocidos vuelven a la omisión", () => {
  assert.deepEqual(parsePreferences(undefined), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences("{no es json"), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences("[1,2]"), DEFAULT_PREFERENCES);
  const custom = { textSize: 150, highContrast: true, motion: "reducido", announcements: "completos", autoTabs: true, console: "plegada", mapLabels: "edificios" } as const;
  assert.deepEqual(parsePreferences(serializePreferences(custom)), custom);
  assert.deepEqual(parsePreferences(custom), custom, "también acepta un objeto");
  const mixed = parsePreferences({ textSize: 175, highContrast: "sí", motion: "mucho", announcements: "todo", autoTabs: 1, console: "?", mapLabels: "algunas" });
  assert.deepEqual(mixed, DEFAULT_PREFERENCES, "cada campo inválido vuelve a su omisión");
  assert.deepEqual(parsePreferences({ textSize: 200, autoTabs: true }), { ...DEFAULT_PREFERENCES, textSize: 200, autoTabs: true }, "los campos válidos se conservan");
  assert.equal(DEFAULT_PREFERENCES.autoTabs, false, "las pestañas no cambian solas por omisión (Q210)");
  assert.equal(DEFAULT_PREFERENCES.announcements, "normales");
});

test("preferencias: atributos del documento (movimiento sigue al sistema salvo que se elija)", () => {
  assert.deepEqual(preferenceAttributes(DEFAULT_PREFERENCES, false), { "data-tamano": "100", "data-contraste": "normal", "data-movimiento": "normal" });
  assert.equal(preferenceAttributes(DEFAULT_PREFERENCES, true)["data-movimiento"], "reducido", "«sistema» obedece a prefers-reduced-motion");
  assert.equal(preferenceAttributes({ ...DEFAULT_PREFERENCES, motion: "normal" }, true)["data-movimiento"], "normal");
  assert.equal(preferenceAttributes({ ...DEFAULT_PREFERENCES, motion: "reducido" }, false)["data-movimiento"], "reducido");
  assert.deepEqual(preferenceAttributes({ ...DEFAULT_PREFERENCES, textSize: 200, highContrast: true }, false), { "data-tamano": "200", "data-contraste": "alto", "data-movimiento": "normal" });
});

test("regla de actividad: nunca cambia de pestaña si la persona está actuando", () => {
  const base: ActivityState = { autoTabs: true, focusInsidePanel: false, lastManualAt: null, now: 100_000, dialogOpen: false, moving: false };
  assert.deepEqual(canAutoSwitch(base), { allowed: true });
  assert.deepEqual(canAutoSwitch({ ...base, autoTabs: false }), { allowed: false, reason: "preferencia-desactivada" });
  assert.deepEqual(canAutoSwitch({ ...base, focusInsidePanel: true }), { allowed: false, reason: "foco-en-el-panel" });
  assert.deepEqual(canAutoSwitch({ ...base, dialogOpen: true }), { allowed: false, reason: "dialogo-abierto" });
  assert.deepEqual(canAutoSwitch({ ...base, moving: true }), { allowed: false, reason: "personaje-en-movimiento" });
  assert.deepEqual(canAutoSwitch({ ...base, lastManualAt: 80_000 }), { allowed: false, reason: "eleccion-reciente" }, "eligió una pestaña hace 20 s");
  assert.deepEqual(canAutoSwitch({ ...base, lastManualAt: 70_000 }), { allowed: true }, "hace 30 s ya no cuenta");
  assert.deepEqual(canAutoSwitch({ ...base, autoTabs: false, focusInsidePanel: true }), { allowed: false, reason: "preferencia-desactivada" });
});

test("pestaña recordada: solo si es válida", () => {
  const valid = ["proyecto", "taller", "habilidades", "cadenas", "comunidad"];
  assert.equal(rememberedTab("taller", valid, "proyecto"), "taller");
  assert.equal(rememberedTab("otra", valid, "proyecto"), "proyecto");
  assert.equal(rememberedTab(null, valid, "proyecto"), "proyecto");
  assert.equal(rememberedTab(42, valid, "proyecto"), "proyecto");
});
