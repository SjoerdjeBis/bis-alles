// Controleert alle projecten uit projects.json en schrijft site/status.json.
// Draait elk uur in GitHub Actions; lokaal: `node scripts/check.mjs` (GH_TOKEN optioneel).
import { readFile, writeFile, appendFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const config = JSON.parse(await readFile(new URL("projects.json", root), "utf8"));
const token = process.env.GH_TOKEN || "";
const SLOW_MS = 8000;
const TIMEOUT_MS = 20000;

async function gh(path) {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

async function checkUrl(label, url) {
  const start = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.arrayBuffer();
    return { label, url, status: res.status, ok: res.ok, ms: Date.now() - start };
  } catch (e) {
    return { label, url, status: 0, ok: false, ms: Date.now() - start, error: e.name === "TimeoutError" ? "time-out" : "onbereikbaar" };
  }
}

const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3.6e6;
const rank = { ok: 0, unknown: 1, warn: 2, error: 3 };
const worst = (a, b) => (rank[b] > rank[a] ? b : a);

async function checkProject(p) {
  const owner = p.owner || config.owner;
  const base = `/repos/${owner}/${p.repo}`;
  const problems = [];
  const out = { ...p, problems, checks: [], workflows: [] };

  // Live site en extra endpoints (bijv. een Apps Script-backend)
  const targets = [...(p.live ? [{ label: "Live site", url: p.live }] : []), ...(p.checks || [])];
  for (const t of targets) {
    const r = await checkUrl(t.label, t.url);
    if (!r.ok) problems.push({ level: "error", text: `${t.label}: ${r.error || "HTTP " + r.status}` });
    else if (r.ms > SLOW_MS) problems.push({ level: "warn", text: `${t.label} traag (${(r.ms / 1000).toFixed(1)} s)` });
    out.checks.push(r);
  }
  // Alleen de eigen live-URL hoort op de publieke pagina; backend-URL's niet tonen.
  out.checks = out.checks.map((c) => (c.label === "Live site" ? c : { ...c, url: undefined }));

  const repo = await gh(base);
  if (!repo.ok) {
    out.repoAccess = false;
    problems.push({
      level: p.archived ? "warn" : "unknown",
      text: repo.status === 404 ? "Repo niet leesbaar (privé? zet STATUS_TOKEN)" : `GitHub API: HTTP ${repo.status}`,
    });
  } else {
    const r = repo.data;
    out.repoAccess = true;
    out.private = r.private;
    out.pushedAt = r.pushed_at;
    out.openIssues = r.open_issues_count;
    out.defaultBranch = r.default_branch;

    const branch = p.branch || r.default_branch;
    const commits = await gh(`${base}/commits?per_page=1&sha=${encodeURIComponent(branch)}`);
    const c = commits.data?.[0];
    if (c) {
      out.lastCommit = {
        date: c.commit.committer?.date || c.commit.author?.date,
        // Commitberichten van privérepo's niet publiceren.
        message: r.private ? null : c.commit.message.split("\n")[0].slice(0, 120),
        url: r.private ? null : c.html_url,
      };
    }

    for (const w of p.workflows || []) {
      const runs = await gh(`${base}/actions/workflows/${encodeURIComponent(w.file)}/runs?per_page=10`);
      const list = (runs.data?.workflow_runs || []).filter((x) => x.event !== "pull_request");
      const latest = list[0];
      const lastOk = list.find((x) => x.conclusion === "success");
      const info = {
        name: w.name,
        file: w.file,
        schedule: w.schedule,
        url: `https://github.com/${owner}/${p.repo}/actions/workflows/${w.file}`,
        latest: latest && { status: latest.status, conclusion: latest.conclusion, at: latest.run_started_at || latest.created_at, url: latest.html_url },
        lastSuccessAt: lastOk && (lastOk.run_started_at || lastOk.created_at),
      };
      out.workflows.push(info);
      if (!runs.ok) {
        problems.push({ level: "unknown", text: `${w.name}: runs niet leesbaar` });
        continue;
      }
      if (!latest) {
        problems.push({ level: "warn", text: `${w.name}: nog nooit gedraaid` });
        continue;
      }
      if (latest.status === "completed" && !["success", "skipped", "neutral"].includes(latest.conclusion)) {
        problems.push({ level: "error", text: `${w.name}: laatste run ${latest.conclusion}` });
      }
      if (w.maxAgeHours) {
        const age = info.lastSuccessAt ? hoursSince(info.lastSuccessAt) : Infinity;
        if (age > 2 * w.maxAgeHours) problems.push({ level: "error", text: `${w.name}: al ${fmtAge(age)} niet geslaagd` });
        else if (age > w.maxAgeHours) problems.push({ level: "warn", text: `${w.name}: laatste geslaagde run ${fmtAge(age)} geleden` });
      }
    }

    if (p.live?.includes(".github.io")) {
      const pages = await gh(`${base}/pages/builds/latest`);
      if (pages.ok) {
        out.pages = { status: pages.data.status, at: pages.data.updated_at };
        if (pages.data.status === "errored") problems.push({ level: "error", text: "GitHub Pages-build mislukt" });
      }
    }

    if (p.release) {
      const rel = await gh(`${base}/releases/tags/${encodeURIComponent(p.release)}`);
      if (rel.ok) {
        out.releaseInfo = {
          name: rel.data.name || rel.data.tag_name,
          at: rel.data.published_at,
          url: rel.data.html_url,
          downloads: rel.data.assets.reduce((n, a) => n + a.download_count, 0),
        };
      } else if (rel.status === 404) {
        problems.push({ level: "error", text: `Release '${p.release}' ontbreekt` });
      }
    }
  }

  out.overall = p.archived ? "archived" : problems.reduce((acc, x) => worst(acc, x.level), "ok");
  delete out.owner;
  out.repoUrl = `https://github.com/${owner}/${p.repo}`;
  return out;
}

function fmtAge(h) {
  if (!isFinite(h)) return "nooit";
  return h < 48 ? `${Math.round(h)} uur` : `${Math.round(h / 24)} dagen`;
}

const projects = [];
for (const p of config.projects) projects.push(await checkProject(p));

const status = { generatedAt: new Date().toISOString(), authenticated: Boolean(token), projects };
await writeFile(new URL("site/status.json", root), JSON.stringify(status, null, 2) + "\n");

// Samenvatting voor de Actions-log en het alarm-issue
const broken = projects.filter((p) => p.overall === "error");
const lines = broken.map((p) => `- **${p.name}**: ${p.problems.filter((x) => x.level === "error").map((x) => x.text).join("; ")}`);
await writeFile(new URL("alerts.md", root), lines.join("\n") + (lines.length ? "\n" : ""));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.length ? `## Problemen\n${lines.join("\n")}\n` : "Alles in orde ✅\n");
}
for (const p of projects) console.log(`${p.overall.padEnd(8)} ${p.name}${p.problems.length ? " — " + p.problems.map((x) => x.text).join("; ") : ""}`);
