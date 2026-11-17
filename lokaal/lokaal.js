const TOKEN = document.querySelector('meta[name="bis-token"]').content;
const STATUS_URL = "https://sjoerdjebis.github.io/bis-alles/status.json";
const LABEL = { ok: "In orde", warn: "Let op", error: "Probleem", unknown: "Onbekend", local: "Lokaal" };
let state = { projects: [], status: new Map(), statusAt: null, filter: "alles", query: "", sort: "gewijzigd", dir: 1, statusFilter: null, open: new Set(), cats: [] };

const rtf = new Intl.RelativeTimeFormat("nl", { numeric: "auto" });
function ago(iso) {
  const s = (new Date(iso) - Date.now()) / 1000;
  for (const [u, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]])
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "zojuist";
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children.filter((c) => c != null));
  return e;
}

function logo(p) {
  const box = el("span", { class: "logo" });
  box.style.background = p.color || "#2E3A59";
  const letter = () => box.replaceChildren(p.name.replace(/^Bis\s+/, "").charAt(0).toUpperCase());
  if (p.logo) {
    const img = el("img", { src: p.logo, alt: "", loading: "lazy" });
    img.onerror = letter;
    box.append(img);
  } else letter();
  return box;
}

let toastTimer;
function toast(text, error = false) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.className = `toast${error ? " error" : ""}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}

async function run(p, kind, target, label) {
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token": TOKEN },
      body: JSON.stringify({ folder: p.folder, kind, target }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    toast(`${label} gestart`);
  } catch (e) {
    toast(`Lukt niet: ${e.message}. Draait Bis Alles nog?`, true);
  }
}

function overall(p) {
  const s = state.status.get(p.id);
  if (s && s.overall !== "local") return s.overall;
  return p.repo || p.live ? "unknown" : "local";
}

const dirty = (p) => p.git.some((g) => g.changes || g.ahead);
const time = (d) => (d ? new Date(d).getTime() : NaN);
// Lokale datums aangevuld met wat de online controle weet (voor projecten zonder map).
function modified(p) {
  const s = state.status.get(p.id);
  const ts = [p.modified, s?.lastCommit?.date, s?.pushedAt].map(time).filter((t) => !isNaN(t));
  return ts.length ? Math.max(...ts) : NaN;
}
function created(p) {
  const ts = [p.created, state.status.get(p.id)?.createdAt].map(time).filter((t) => !isNaN(t));
  return ts.length ? Math.min(...ts) : NaN;
}

const SEVERITY = { error: 0, warn: 1, unknown: 2, ok: 3, local: 4 };
const SORTS = {
  naam: (a, b) => a.name.localeCompare(b.name, "nl"),
  categorie: (a, b) => catIndex(a.category) - catIndex(b.category) || a.name.localeCompare(b.name, "nl"),
  status: (a, b) => SEVERITY[overall(a)] - SEVERITY[overall(b)] || (dirty(b) - dirty(a)),
  gewijzigd: (a, b) => modified(b) - modified(a),
  gemaakt: (a, b) => created(a) - created(b),
};
// Projecten zonder datum staan altijd onderaan, in welke richting je ook sorteert.
const NO_DATE = { gewijzigd: (p) => isNaN(modified(p)), gemaakt: (p) => isNaN(created(p)) };
function compare(a, b) {
  const missing = NO_DATE[state.sort];
  if (missing && missing(a) !== missing(b)) return missing(a) ? 1 : -1;
  if (missing && missing(a)) return a.name.localeCompare(b.name, "nl");
  return state.dir * SORTS[state.sort](a, b) || a.name.localeCompare(b.name, "nl");
}
// Volgorde van categorieën uit projecten-lokaal.json; onbekende achteraan.
const catIndex = (c) => { const i = state.cats.indexOf(c); return i < 0 ? 999 : i; };

function actionButton(p, pr, cls) {
  const what = pr.kind === "live" ? pr.target : pr.kind === "npm" ? `npm run ${pr.target.split("::")[1]}` : pr.kind === "finder" ? `map ${p.folder}` : pr.target;
  return pr.kind === "live"
    ? el("a", { class: cls, href: pr.target, target: "_blank", title: what }, `${pr.label} ↗`)
    : el("button", { class: cls, type: "button", title: what, onclick: () => run(p, pr.kind, pr.target, pr.label) }, `▶ ${pr.label}`);
}
function primaryButtons(p) {
  return el("span", { class: "acts" },
    p.primary ? actionButton(p, p.primary, "go") : el("span", { class: "go-none" }, "—"),
    p.secondary ? actionButton(p, p.secondary, "go2") : null);
}

function details(p) {
  const s = state.status.get(p.id);
  const o = overall(p);
  const box = el("div", { class: "detail" });
  if (p.description) box.append(el("p", { class: "desc" }, p.description));
  if (s && o !== "ok" && s.problems?.length) {
    box.append(el("ul", { class: "problems" }, ...s.problems.map((x) => el("li", { class: x.level }, x.text))));
  }

  const pr = p.primary;
  const same = (a) => [p.primary, p.secondary].some((x) => x && a.kind === x.kind && a.target === x.target);
  const rest = [
    ...p.actions.filter((a) => !same(a)).map((a) => el("button", { class: "run", type: "button", title: a.target, onclick: () => run(p, a.kind, a.target, a.label) }, a.label)),
    ...(p.live && pr?.kind !== "live" ? [el("a", { href: p.live, target: "_blank" }, "Online ↗")] : []),
    ...(p.links || []).filter((l) => !(pr?.kind === "live" && pr.target === l.url)).map((l) => el("a", { href: l.url, target: "_blank" }, l.label)),
    ...p.html.filter((h) => !same(h)).map((h) => el("button", { type: "button", title: h.target, onclick: () => run(p, h.kind, h.target, h.label) }, h.label)),
  ];
  if (rest.length) box.append(el("div", { class: "btns compact" }, ...rest));

  const tools = [];
  if (p.folder) {
    tools.push(el("button", { class: "quiet", type: "button", onclick: () => run(p, "finder", null, "Finder") }, "Map"));
    tools.push(el("button", { class: "quiet", type: "button", onclick: () => run(p, "terminal", null, "Terminal") }, "Terminal"));
  }
  const repo = p.repo || p.git.find((g) => g.repo)?.repo;
  if (repo) tools.push(el("a", { class: "quiet", href: `https://github.com/SjoerdjeBis/${repo}`, target: "_blank" }, "GitHub"));
  if (p.workflows?.length && repo) tools.push(el("a", { class: "quiet", href: `https://github.com/SjoerdjeBis/${repo}/actions`, target: "_blank" }, "Runs"));
  if (tools.length) box.append(el("div", { class: "btns compact" }, ...tools));

  for (const g of p.git) {
    const bits = [];
    if (g.changes) bits.push(el("span", { class: "warn" }, `${g.changes} wijziging${g.changes > 1 ? "en" : ""} niet gecommit`));
    if (g.ahead) bits.push(el("span", { class: "warn" }, `${g.ahead} commit${g.ahead > 1 ? "s" : ""} niet gepusht`));
    if (!bits.length && g.lastCommit) bits.push(`laatste commit ${ago(g.lastCommit)}`);
    const where = g.path !== "." ? `${g.path} · ` : "";
    box.append(el("div", { class: "gitline" }, `git ${where}${g.branch || "?"}: `, ...bits.flatMap((b, i) => (i ? [" · ", b] : [b]))));
  }
  const dates = [];
  if (!isNaN(created(p))) dates.push(`gemaakt ${new Date(created(p)).toLocaleDateString("nl-NL", { dateStyle: "medium" })}`);
  if (p.folder) dates.push(`map ${p.folder}`);
  else dates.push("geen map op het bureaublad, alleen online");
  box.append(el("div", { class: "gitline" }, dates.join(" · ")));
  return box;
}

// Kort, zodat het in de kolom past: "13 min", "3 dagen", "5 mnd".
function short(t) {
  const m = (Date.now() - t) / 60000;
  if (m < 1) return "zojuist";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.round(m / 60)} uur`;
  const d = m / 1440;
  if (d < 14) return `${Math.round(d)} ${Math.round(d) === 1 ? "dag" : "dagen"}`;
  if (d < 60) return `${Math.round(d / 7)} wk`;
  if (d < 365) return `${Math.round(d / 30.4)} mnd`;
  return `${Math.round(d / 365)} jr`;
}
const monthYear = (t) => new Date(t).toLocaleDateString("nl-NL", { month: "short", year: "numeric" });

function rows(p) {
  const s = state.status.get(p.id);
  const o = overall(p);
  const open = state.open.has(p.id);
  const toggle = () => { open ? state.open.delete(p.id) : state.open.add(p.id); render(); };

  // Belangrijkste status: het eerste probleem, anders een git-waarschuwing. Altijd op één regel.
  const problem = o !== "ok" && s?.problems?.find((x) => x.level === "error") || s?.problems?.find((x) => x.level === "warn");
  const g = p.git.find((x) => x.changes || x.ahead);
  const noteText = problem ? problem.text : g ? (g.ahead ? "niet gepusht" : "niet gecommit") : "";
  const noteLevel = problem ? problem.level : "warn";
  const m = modified(p), c = created(p);

  const tr = el("tr", { class: `prow${open ? " open" : ""}`, "data-status": o },
    el("td", {}, el("button", { class: "row-main", type: "button", "aria-expanded": String(open), onclick: toggle, title: p.description || p.name },
      logo(p), el("span", { class: "name" }, p.name))),
    el("td", { class: "cat" }, p.category),
    el("td", { class: "status", title: noteText || LABEL[o] },
      el("span", { class: `pill ${o}` }, LABEL[o] || o),
      noteText ? el("span", { class: `note ${noteLevel}` }, noteText) : null),
    el("td", { class: "when", title: isNaN(m) ? null : new Date(m).toLocaleString("nl-NL") }, isNaN(m) ? "–" : short(m)),
    el("td", { class: "when", title: isNaN(c) ? null : new Date(c).toLocaleDateString("nl-NL") }, isNaN(c) ? "–" : monthYear(c)),
    el("td", {}, primaryButtons(p)),
    el("td", {}, el("button", { class: "chev", type: "button", "aria-label": open ? "Inklappen" : "Meer tonen", "aria-expanded": String(open), onclick: toggle }, open ? "▾" : "⋯")));
  return open ? [tr, el("tr", { class: "drow" }, el("td", { colspan: "7" }, details(p)))] : [tr];
}

function header() {
  const col = (key, label) => {
    const active = state.sort === key;
    return el("th", { "aria-sort": active ? (state.dir === 1 ? "ascending" : "descending") : null },
      key ? el("button", { type: "button", class: active ? "on" : null, onclick: () => {
        state.dir = active ? -state.dir : 1;
        state.sort = key;
        save("bis-lokaal-sort", `${key}:${state.dir}`);
        render();
      } }, label, active ? (state.dir === 1 ? " ↓" : " ↑") : null) : label);
  };
  return el("thead", {}, el("tr", {}, col("naam", "Project"), col("categorie", "Categorie"), col("status", "Status"),
    col("gewijzigd", "Gewijzigd"), col("gemaakt", "Gemaakt"), col(null, "Acties"), el("th", {})));
}

function render() {
  const { projects, filter, query, statusFilter } = state;
  const counts = {};
  for (const p of projects) counts[overall(p)] = (counts[overall(p)] || 0) + 1;
  const nDirty = projects.filter(dirty).length;
  const chip = (key, n, label, dotClass) => el("button", {
    type: "button", class: "count", "aria-pressed": String(statusFilter === key),
    onclick: () => { state.statusFilter = statusFilter === key ? null : key; render(); },
  }, el("span", { class: `dot ${dotClass}` }), el("b", {}, String(n)), ` ${label}`);
  document.getElementById("summary").replaceChildren(
    ...["error", "warn", "unknown", "ok", "local"].filter((k) => counts[k]).map((k) => chip(k, counts[k], LABEL[k].toLowerCase(), k)),
    ...(nDirty ? [chip("dirty", nDirty, "niet opgeslagen", "warn")] : []));

  const cats = ["alles", ...[...new Set(projects.map((p) => p.category))].sort((a, b) => catIndex(a) - catIndex(b))];
  document.getElementById("filters").replaceChildren(...cats.map((c) =>
    el("button", { type: "button", "aria-pressed": String(c === filter), onclick: () => { state.filter = c; save("bis-lokaal-filter", c); render(); } },
      c.charAt(0).toUpperCase() + c.slice(1))));

  const q = query.trim().toLowerCase();
  const shown = projects.filter((p) =>
    (filter === "alles" || p.category === filter) &&
    (!statusFilter || (statusFilter === "dirty" ? dirty(p) : overall(p) === statusFilter)) &&
    (!q || [p.name, p.description, p.folder, p.category].join(" ").toLowerCase().includes(q)))
    .sort(compare);
  document.getElementById("list").replaceChildren(shown.length
    ? el("table", { class: "tbl" },
        el("colgroup", {}, ...["c-proj", "c-cat", "c-status", "c-when", "c-made", "c-acts", "c-more"].map((c) => el("col", { class: c }))),
        header(), el("tbody", {}, ...shown.flatMap(rows)))
    : el("p", { class: "empty" }, "Niets gevonden."));
  document.getElementById("checked").textContent = state.statusAt ? `Online status van ${ago(state.statusAt)}` : "Online status niet beschikbaar";
}

function save(key, value) { try { localStorage.setItem(key, value); } catch {} }

async function load() {
  let res;
  try { res = await fetch("/api/projects", { cache: "no-store" }); }
  catch { throw new Error("Kan de lokale server niet bereiken. Draait Bis Alles nog?"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`De server gaf een fout: ${data.error || res.status}. Details staan in het Terminal-venster van Bis Alles.`);
  state.projects = data.projects;
  state.cats = data.categorieen || [];
  document.getElementById("root").textContent = data.root;
  render();
}

async function loadStatus() {
  try {
    const data = await (await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: "no-store" })).json();
    state.status = new Map(data.projects.map((p) => [p.id, p]));
    state.statusAt = data.generatedAt;
  } catch {}
  render();
}

async function checkUpdate() {
  try {
    const { behind } = await (await fetch("/api/update-check", { cache: "no-store" })).json();
    const b = document.getElementById("update");
    b.classList.toggle("new", behind > 0);
    b.textContent = behind > 0 ? `Bijwerken (${behind} nieuw)` : "Bijwerken";
  } catch {}
}

async function update() {
  const b = document.getElementById("update");
  b.disabled = true;
  b.textContent = "Bijwerken…";
  try {
    const res = await fetch("/api/update", { method: "POST", headers: { "X-Token": TOKEN } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (!data.updated) {
      toast("Al de nieuwste versie");
      b.disabled = false;
      return checkUpdate();
    }
    toast("Bijgewerkt, herstarten…");
    // Wachten tot de herstarte server weer antwoordt, dan herladen (nieuw token, nieuwe code).
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { if ((await fetch("/api/projects", { cache: "no-store" })).ok) return location.reload(); } catch {}
    }
    toast("Herstarten lukt niet; start Bis Alles opnieuw.", true);
  } catch (e) {
    toast(`Bijwerken mislukt: ${e.message}`, true);
    b.disabled = false;
    b.textContent = "Bijwerken";
  }
}

document.getElementById("update").onclick = update;
try {
  state.filter = localStorage.getItem("bis-lokaal-filter") || "alles";
  if (state.filter === "problemen") state.filter = "alles";
  const [k, d] = (localStorage.getItem("bis-lokaal-sort") || "").split(":");
  if (SORTS[k]) { state.sort = k; state.dir = d === "-1" ? -1 : 1; }
} catch {}
document.getElementById("search").oninput = (e) => { state.query = e.target.value; render(); };
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); document.getElementById("search").focus(); }
});
// Bij terugkomen naar het tabblad opnieuw inlezen (nieuwe mappen, git-status).
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
checkUpdate();
load().then(loadStatus).catch((e) => {
  console.error(e);
  const msg = e.message.startsWith("De server") || e.message.startsWith("Kan de") ? e.message : `Fout in de pagina: ${e.message}`;
  document.getElementById("summary").textContent = msg;
});
