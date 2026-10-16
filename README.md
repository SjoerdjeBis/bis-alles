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
- Projecten zonder repo en zonder live URL (`local`) staan erop als "Lokaal": die kunnen niet
  automatisch gecontroleerd worden.

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

## Eenmalig instellen

1. **Settings → Pages → Source: GitHub Actions.**
2. GitHub Pages op een privérepo vraagt een betaald account. Zet deze repo dus op publiek, of
   neem GitHub Pro. Commitberichten van privérepo's worden nooit gepubliceerd.
3. Optioneel, voor privérepo's (voetbalagenda) en de Pages-buildstatus: maak een
   *fine-grained token* met toegang tot alle repo's en alleen-lezen rechten op **Actions**,
   **Contents**, **Metadata** en **Pages**, met een vervaldatum. Zet hem als secret
   `STATUS_TOKEN` (*Settings → Secrets and variables → Actions*).

Lokaal testen: `node scripts/check.mjs` en daarna `python3 -m http.server -d site`.
