const TOKEN = document.querySelector('meta[name="bis-token"]').content;
const STATUS_URL = "https://sjoerdjebis.github.io/bis-alles/status.json";
const LABEL = { ok: "In orde", warn: "Let op", error: "Probleem", unknown: "Onbekend", local: "Lokaal" };
let state = { projects: [], status: new Map(), statusAt: null, filter: "alles", query: "" };

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

function card(p) {
  const s = state.status.get(p.id);
  const o = overall(p);
  const node = el("article", { class: "card", "data-status": o });

  const name = p.live ? el("a", { href: p.live, target: "_blank" }, p.name) : p.name;
  const meta = [p.category, p.platform, p.folder && p.folder !== p.name ? p.folder : null].filter(Boolean).join(" · ");
  node.append(el("div", { class: "head" }, logo(p),
    el("div", { class: "title" }, el("h2", {}, name), el("span", { class: "meta" }, meta)),
    el("span", { class: `pill ${o}` }, LABEL[o] || o)));
  if (p.description) node.append(el("p", { class: "desc" }, p.description));

  if (s && o !== "ok") {
    const ul = el("ul", { class: "problems" });
    for (const x of s.problems || []) ul.append(el("li", { class: x.level }, x.text));
    node.append(ul);
  }

  const group = (title, ...buttons) => buttons.length && node.append(el("div", { class: "group" }, el("h3", {}, title), el("div", { class: "btns" }, ...buttons)));

  group("Starten", ...p.actions.map((a) => el("button", { class: "run", type: "button", title: a.target, onclick: () => run(p, a.kind, a.target, a.label) }, a.label)));

  const open = [];
  if (p.live) open.push(el("a", { class: "primary", href: p.live, target: "_blank" }, "Online ↗"));
  for (const l of p.links || []) open.push(el("a", { href: l.url, target: "_blank" }, l.label));
  for (const h of p.html) open.push(el("button", { type: "button", title: h.target, onclick: () => run(p, h.kind, h.target, h.label) }, h.label));
  group("Openen", ...open);

  const tools = [];
  if (p.folder) {
    tools.push(el("button", { class: "quiet", type: "button", onclick: () => run(p, "finder", null, "Finder") }, "Map"));
    tools.push(el("button", { class: "quiet", type: "button", onclick: () => run(p, "terminal", null, "Terminal") }, "Terminal"));
  }
  const repo = p.repo || p.git.find((g) => g.repo)?.repo;
  if (repo) tools.push(el("a", { class: "quiet", href: `https://github.com/SjoerdjeBis/${repo}`, target: "_blank" }, "GitHub"));
  if (p.workflows?.length && repo) tools.push(el("a", { class: "quiet", href: `https://github.com/SjoerdjeBis/${repo}/actions`, target: "_blank" }, "Runs"));
  if (tools.length) node.append(el("div", { class: "btns" }, ...tools));

  for (const g of p.git) {
    const bits = [];
    if (g.changes) bits.push(el("span", { class: "warn" }, `${g.changes} wijziging${g.changes > 1 ? "en" : ""} niet gecommit`));
    if (g.ahead) bits.push(el("span", { class: "warn" }, `${g.ahead} commit${g.ahead > 1 ? "s" : ""} niet gepusht`));
    if (!bits.length && g.lastCommit) bits.push(`laatste commit ${ago(g.lastCommit)}`);
    const where = g.path !== "." ? `${g.path} · ` : "";
    node.append(el("div", { class: "gitline" }, `git ${where}${g.branch || "?"}: `, ...bits.flatMap((b, i) => (i ? [" · ", b] : [b]))));
  }
  if (!p.folder) node.append(el("div", { class: "gitline" }, "Geen map op het bureaublad, alleen online."));
  return node;
}

function render() {
  const { projects, filter, query } = state;
  const counts = {};
  for (const p of projects) counts[overall(p)] = (counts[overall(p)] || 0) + 1;
  document.getElementById("summary").replaceChildren(
    ...["error", "warn", "unknown", "ok", "local"].filter((k) => counts[k]).map((k) =>
      el("span", { class: "count" }, el("span", { class: `dot ${k}` }), el("b", {}, String(counts[k])), ` ${LABEL[k].toLowerCase()}`)));

  const cats = ["alles", "problemen", ...new Set(projects.map((p) => p.category))];
  document.getElementById("filters").replaceChildren(...cats.map((c) =>
    el("button", { type: "button", "aria-pressed": String(c === filter), onclick: () => { state.filter = c; try { localStorage.setItem("bis-lokaal-filter", c); } catch {} render(); } },
      c.charAt(0).toUpperCase() + c.slice(1))));

  const q = query.trim().toLowerCase();
  const shown = projects.filter((p) =>
    (filter === "alles" || (filter === "problemen" ? ["error", "warn"].includes(overall(p)) || p.git.some((g) => g.changes || g.ahead) : p.category === filter)) &&
    (!q || [p.name, p.description, p.folder, p.category].join(" ").toLowerCase().includes(q)));
  document.getElementById("grid").replaceChildren(...(shown.length ? shown.map(card) : [el("p", { class: "empty" }, "Niets gevonden.")]));
  document.getElementById("checked").textContent = state.statusAt ? `Online status van ${ago(state.statusAt)}` : "Online status niet beschikbaar";
}

async function load() {
  const res = await fetch("/api/projects", { cache: "no-store" });
  const data = await res.json();
  state.projects = data.projects;
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

try { state.filter = localStorage.getItem("bis-lokaal-filter") || "alles"; } catch {}
document.getElementById("search").oninput = (e) => { state.query = e.target.value; render(); };
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); document.getElementById("search").focus(); }
});
// Bij terugkomen naar het tabblad opnieuw inlezen (nieuwe mappen, git-status).
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
load().then(loadStatus).catch(() => (document.getElementById("summary").textContent = "Kan de lokale server niet bereiken."));
