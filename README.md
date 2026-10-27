# Bis Overzicht

Overzicht van al mijn sites, apps en automatiseringen, met status per project.

**Live:** https://sjoerdjebis.github.io/bis-alles/

## Hoe het werkt

- `projects.json` is de lijst met projecten. Nieuw project of app? Voeg hier een blok toe.
- `scripts/check.mjs` controleert elk project: is de live site bereikbaar (en hoe snel), is de
  laatste workflow-run geslaagd en niet te oud (`maxAgeHours`), is de GitHub Pages-build gelukt,
  bestaat de release (bij apps), en wat was de laatste commit. Het resultaat is `site/status.json`.
- `.github/workflows/status.yml` draait dagelijks om 06:50 en 07:50 UTC (en bij elke push naar
  `main`) en publiceert `site/` op GitHub Pages. Heeft een project bij **twee controles op rij**
  een probleem, dan opent hij een issue **⚠️ Statusalarm** (GitHub mailt je dan); is alles weer
  groen, dan sluit hij het issue zelf. De vorige uitslag leest hij van de live `status.json`.
- Lokale projecten (zonder repo of live URL) staan hier niet, maar alleen in het lokale
  dashboard hieronder.

### Velden in `projects.json`

| Veld | Betekenis |
|---|---|
| `name`, `description`, `category` | Wat je op de kaart ziet; `category` wordt ook een filterknop |
| `type` | `site`, `app`, `extensie` of `automatisering` |
| `repo`, `branch` | GitHub-repo (en branch als het niet de standaard is) |
| `live` | URL van de live versie, of `null` |
| `logo`, `color` | Logo-URL of pad in `site/`; zonder logo een letter op `color` |
| `workflows` | `file`, `name`, `schedule` (tekst) en `maxAgeHours` (te oud = waarschuwing, 2× = probleem) |
| `checks` | Extra URL's om te controleren, bijv. een backend (de URL wordt niet getoond) |
| `release` | Tag van een GitHub-release die moet bestaan (apps) |
| `links` | Extra knoppen, bijv. een store-pagina |
| `platform`, `archived` | Bijv. `Google TV`; `archived: true` zet het project onder Archief |

## Lokaal dashboard

`lokaal/` is een dashboard voor op je eigen Mac, met alles uit `~/Desktop/claude`: per project
knoppen om de juiste commands te starten en de sites te openen (lokaal of online), plus de online
status van hierboven en de git-status (niet gecommit of niet gepusht).

- **Starten:** dubbelklik `lokaal/Bis Alles.command`. Het dashboard opent op http://localhost:8787.
  Het Terminal-venster moet openblijven zolang je het gebruikt. Alleen `python3` is nodig.
- **Wat hij zelf vindt:** per map de `.command`-bestanden, Python-scripts, `npm run`-scripts en
  HTML-bestanden (ook één map dieper), plus de git-repo. Een nieuwe map verschijnt dus vanzelf.
  Een `.command` of HTML opent met `open`; Python en npm draaien in een nieuw Terminal-venster.
- **Naam, beschrijving en categorie** komen uit `projects.json` en uit
  `lokaal/projecten-lokaal.json`. Dat laatste bestand staat alleen op je Mac (het staat in
  `.gitignore`) en bevat de lokale projecten, in hetzelfde formaat als `projects.json` plus een
  veld `folder` (de mapnaam in `~/Desktop/claude`). Een blok met een `id` uit `projects.json`
  vult dat project aan, bijvoorbeeld `{"id": "tourpoule", "folder": "Tourpoule"}`. Mappen met een
  GitHub-repo worden vanzelf gekoppeld. Een map zonder blok staat onder "Overig". Mappen die je
  niet wilt zien, zet je in `negeren`.
- **Beveiliging:** de server luistert alleen op localhost en voert alleen acties uit die hij zelf
  in de map gevonden heeft, met een token dat andere websites niet kunnen lezen.

## Eenmalig instellen

1. **Settings → Pages → Source: GitHub Actions.**
2. GitHub Pages op een privérepo vraagt een betaald account. Zet deze repo dus op publiek, of
   neem GitHub Pro. Commitberichten van privérepo's worden nooit gepubliceerd.
3. Optioneel, voor privérepo's (voetbalagenda) en de Pages-buildstatus: maak een
   *fine-grained token* met toegang tot alle repo's en alleen-lezen rechten op **Actions**,
   **Contents**, **Metadata** en **Pages**, met een vervaldatum. Zet hem als secret
   `STATUS_TOKEN` (*Settings → Secrets and variables → Actions*).

Lokaal testen: `node scripts/check.mjs` en daarna `python3 -m http.server -d site`.
