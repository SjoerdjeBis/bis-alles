const TOKEN = document.querySelector('meta[name="bis-token"]').content;
const STATUS_URL = "https://sjoerdjebis.github.io/bis-alles/status.json";
const LABEL = { ok: "In orde", warn: "Let op", error: "Probleem", unknown: "Onbekend", local: "Lokaal" };
let state = { projects: [], status: new Map(), statusAt: null, filter: "alles", query: "", sort: "gewijzigd", statusFilter: null, open: new Set(), cats: [] };

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

const SORTS = {
  gewijzigd: { label: "Laatst gewijzigd", cmp: (a, b) => (modified(b) || 0) - (modified(a) || 0) },
  gemaakt: { label: "Eerst gemaakt", cmp: (a, b) => (created(a) || Infinity) - (created(b) || Infinity) },
  naam: { label: "A–Z", cmp: (a, b) => a.name.localeCompare(b.name, "nl") },
  categorie: { label: "Categorie", cmp: (a, b) => catIndex(a.category) - catIndex(b.category) || a.name.localeCompare(b.name, "nl") },
};
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
    p.secondary ? actionButton(p, p.secondary, "go2") : null,
    p.primary ? actionButton(p, p.primary, "go") : el("span", { class: "go-none" }, "—"));
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

function row(p) {
  const s = state.status.get(p.id);
  const o = overall(p);
  const open = state.open.has(p.id);
  const node = el("article", { class: `row${open ? " open" : ""}`, "data-status": o });
  const toggle = () => { open ? state.open.delete(p.id) : state.open.add(p.id); render(); };

  // Belangrijkste status: het eerste probleem, anders een git-waarschuwing.
  const problem = o !== "ok" && s?.problems?.find((x) => x.level === "error") || s?.problems?.find((x) => x.level === "warn");
  const g = p.git.find((x) => x.changes || x.ahead);
  const note = problem ? el("span", { class: `note ${problem.level}` }, problem.text)
    : g ? el("span", { class: "note warn" }, g.ahead ? "niet gepusht" : "niet gecommit") : null;
  const meta = [...new Set([p.category, p.platform].filter(Boolean))].join(" · ");
  const sortKey = state.sort === "gemaakt" ? created(p) : modified(p);
  const date = isNaN(sortKey) ? "–" : ago(new Date(sortKey).toISOString());

  node.append(
    el("button", { class: "row-main", type: "button", "aria-expanded": String(open), onclick: toggle },
      logo(p),
      el("span", { class: "title" }, el("span", { class: "name" }, p.name), el("span", { class: "meta" }, meta, note ? " · " : null, note))),
    el("span", { class: `pill ${o}` }, LABEL[o] || o),
    el("span", { class: "when", title: state.sort === "gemaakt" ? "gemaakt" : "laatst gewijzigd" }, date),
    primaryButtons(p),
    el("button", { class: "chev", type: "button", "aria-label": open ? "Inklappen" : "Uitklappen", "aria-expanded": String(open), onclick: toggle }, open ? "▾" : "▸"),
  );
  if (open) node.append(details(p));
  return node;
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
  document.getElementById("sort").replaceChildren(...Object.entries(SORTS).map(([k, v]) =>
    el("button", { type: "button", "aria-pressed": String(k === state.sort), onclick: () => { state.sort = k; save("bis-lokaal-sort", k); render(); } }, v.label)));

  const q = query.trim().toLowerCase();
  const shown = projects.filter((p) =>
    (filter === "alles" || p.category === filter) &&
    (!statusFilter || (statusFilter === "dirty" ? dirty(p) : overall(p) === statusFilter)) &&
    (!q || [p.name, p.description, p.folder, p.category].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => SORTS[state.sort].cmp(a, b) || a.name.localeCompare(b.name, "nl"));
  document.getElementById("list").replaceChildren(...(shown.length ? shown.map(row) : [el("p", { class: "empty" }, "Niets gevonden.")]));
  document.getElementById("checked").textContent = state.statusAt ? `Online status van ${ago(state.statusAt)}` : "Online status niet beschikbaar";
}

function save(key, value) { try { localStorage.setItem(key, value); } catch {} }

async function load() {
  const res = await fetch("/api/projects", { cache: "no-store" });
  const data = await res.json();
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
  if (SORTS[localStorage.getItem("bis-lokaal-sort")]) state.sort = localStorage.getItem("bis-lokaal-sort");
} catch {}
document.getElementById("search").oninput = (e) => { state.query = e.target.value; render(); };
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); document.getElementById("search").focus(); }
});
// Bij terugkomen naar het tabblad opnieuw inlezen (nieuwe mappen, git-status).
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
checkUpdate();
load().then(loadStatus).catch(() => (document.getElementById("summary").textContent = "Kan de lokale server niet bereiken."));
