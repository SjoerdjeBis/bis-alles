const LABEL = { ok: "In orde", warn: "Let op", error: "Probleem", unknown: "Onbekend", archived: "Archief", local: "Lokaal" };
const STALE_HOURS = 3;
let state = { data: null, filter: "alles" };

const rtf = new Intl.RelativeTimeFormat("nl", { numeric: "auto" });
function ago(iso) {
  if (!iso) return "–";
  const s = (new Date(iso) - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "zojuist";
}
const fullDate = (iso) => new Date(iso).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children.filter((c) => c != null));
  return e;
}
const timeEl = (iso) => (iso ? el("time", { datetime: iso, title: fullDate(iso) }, ago(iso)) : "–");

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

function workflowState(w) {
  const l = w.latest;
  if (!l) return "unknown";
  if (l.status !== "completed") return "warn";
  return ["success", "skipped", "neutral"].includes(l.conclusion) ? "ok" : "error";
}

function card(p) {
  const node = document.getElementById("card").content.firstElementChild.cloneNode(true);
  node.dataset.status = p.overall;
  node.querySelector(".logo").replaceWith(logo(p));
  const h2 = node.querySelector("h2");
  h2.append(p.live ? el("a", { href: p.live }, p.name) : p.name);
  node.querySelector(".meta").textContent = [p.category, p.platform, p.private ? "privé" : null].filter(Boolean).join(" · ");
  const pill = node.querySelector(".pill");
  pill.className = `pill ${p.overall}`;
  pill.textContent = LABEL[p.overall] || p.overall;
  node.querySelector(".desc").textContent = p.description || "";

  const problems = node.querySelector(".problems");
  if (!p.archived) for (const x of p.problems) problems.append(el("li", { class: x.level }, x.text));

  const facts = node.querySelector(".facts");
  const add = (label, ...value) => facts.append(el("dt", {}, label), el("dd", {}, ...value));

  for (const c of p.checks || []) {
    const s = c.ok ? (c.ms > 8000 ? "warn" : "ok") : "error";
    add(c.label === "Live site" ? "Live" : c.label, el("span", { class: `dot ${s}` }), c.ok ? `online · ${c.ms} ms` : c.error || `HTTP ${c.status}`);
  }
  for (const w of p.workflows || []) {
    const s = workflowState(w);
    const l = w.latest;
    const text = !l ? "nog niet gedraaid" : l.status !== "completed" ? "draait nu" : s === "ok" ? "geslaagd " : `${l.conclusion} `;
    add(w.name, el("span", { class: `dot ${s}` }), l ? el("a", { href: l.url }, text, l.status === "completed" ? timeEl(l.at) : "") : text,
      w.schedule ? el("span", { class: "msg" }, ` · ${w.schedule}`) : null);
  }
  if (p.releaseInfo) {
    add("Release", el("a", { href: p.releaseInfo.url }, timeEl(p.releaseInfo.at)), el("span", { class: "msg" }, ` · ${p.releaseInfo.downloads}× gedownload`));
  }
  if (p.lastCommit) {
    const msg = p.lastCommit.message ? el("span", { class: "msg" }, ` · ${p.lastCommit.message}`) : null;
    add("Laatste update", p.lastCommit.url ? el("a", { href: p.lastCommit.url }, timeEl(p.lastCommit.date)) : timeEl(p.lastCommit.date), msg);
  }
  if (p.overall === "local") add("Status", "niet automatisch te controleren (staat niet op GitHub)");
  if (p.openIssues) add("Open issues", el("a", { href: `${p.repoUrl}/issues` }, String(p.openIssues)));

  const links = node.querySelector(".links");
  if (p.live) links.append(el("a", { class: "primary", href: p.live }, "Open ↗"));
  for (const l of p.links || []) links.append(el("a", { href: l.url }, l.label));
  if (p.repoUrl) links.append(el("a", { href: p.repoUrl }, "Repo"));
  if (p.workflows?.length) links.append(el("a", { href: `${p.repoUrl}/actions` }, "Actions"));
  return node;
}

function categories(projects) {
  return ["alles", "problemen", ...new Set(projects.filter((p) => !p.archived).map((p) => p.category))];
}

function render() {
  const { data, filter } = state;
  const active = data.projects.filter((p) => !p.archived);
  const archived = data.projects.filter((p) => p.archived);

  const counts = { ok: 0, warn: 0, error: 0, unknown: 0, local: 0 };
  for (const p of active) counts[p.overall] = (counts[p.overall] || 0) + 1;
  const summary = document.getElementById("summary");
  summary.replaceChildren(
    ...["ok", "warn", "error", "unknown", "local"].filter((k) => counts[k]).map((k) =>
      el("span", { class: "count" }, el("span", { class: `dot ${k}` }), el("b", {}, String(counts[k])), ` ${LABEL[k].toLowerCase()}`))
  );

  const filters = document.getElementById("filters");
  filters.replaceChildren(...categories(data.projects).map((c) => {
    const b = el("button", { type: "button", "aria-pressed": String(c === filter) }, c.charAt(0).toUpperCase() + c.slice(1));
    b.onclick = () => { state.filter = c; try { localStorage.setItem("bis-filter", c); } catch {} render(); };
    return b;
  }));

  const order = { error: 0, warn: 1, unknown: 2, ok: 3, local: 4 };
  const shown = active
    .filter((p) => filter === "alles" || (filter === "problemen" ? ["error", "warn", "unknown"].includes(p.overall) : p.category === filter))
    .sort((a, b) => order[a.overall] - order[b.overall]);
  const grid = document.getElementById("grid");
  grid.replaceChildren(...(shown.length ? shown.map(card) : [el("p", { class: "empty" }, filter === "problemen" ? "Geen problemen 🎉" : "Niets gevonden.")]));

  const archive = document.getElementById("archive");
  archive.hidden = !archived.length;
  document.getElementById("archive-grid").replaceChildren(...archived.map(card));

  document.getElementById("checked").replaceChildren("Laatst gecontroleerd ", timeEl(data.generatedAt));
  const staleH = (Date.now() - new Date(data.generatedAt)) / 3.6e6;
  const stale = document.getElementById("stale");
  stale.hidden = staleH < STALE_HOURS;
  stale.textContent = `Let op: de laatste controle is ${ago(data.generatedAt)}. De statuscontrole zelf draait mogelijk niet meer.`;
}

async function load() {
  try {
    const res = await fetch(`status.json?t=${Date.now()}`, { cache: "no-store" });
    state.data = await res.json();
    render();
  } catch (e) {
    document.getElementById("summary").textContent = "Status kon niet geladen worden.";
  }
}

try { state.filter = localStorage.getItem("bis-filter") || "alles"; } catch {}
load();
setInterval(load, 5 * 60 * 1000);
