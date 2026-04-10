# Coach MVP backed by knowledge

Questo MVP non genera la scheda con logiche finte nel frontend.

La UI e' solo il layer operativo sopra il repository `knowledge`:

1. il coach carica nuove fonti
2. i file vengono salvati in `raw/sources/`
3. il feedback del coach diventa una nuova fonte grezza
4. il backend lancia `codex exec` nel repository
5. Codex segue `AGENTS.md` e aggiorna il wiki reale
6. viene creato anche un file share JSON per la vista atleta mobile

## Cosa aggiorna davvero

Durante una run riuscita, il workflow aggiorna il repository principale:

- `raw/sources/` con le nuove fonti caricate
- `wiki/sources/`
- `wiki/meta/athlete-profile.md`
- `wiki/analyses/`
- `wiki/programs/`
- `wiki/index.md`
- `wiki/log.md`

## Stack

- frontend: React + Vite
- backend locale: Express
- motore: `codex exec` lanciato localmente
- storage: file system locale del repository

## Avvio sviluppo

```bash
npm install
npm run dev
```

Questo avvia:

- frontend Vite
- backend locale su `http://localhost:8787`

## Build

```bash
npm run build
```

Per avviare solo il backend:

```bash
npm run start
```

## Endpoint principali

- `GET /api/status`
- `POST /api/generate`
- `GET /api/share/:shareId`

## Note MVP

- serve `codex` CLI disponibile e funzionante in locale
- il backend usa il repository vero come memoria e superficie di scrittura
- la vista atleta legge un artefatto JSON derivato dal programma generato
- i file in `coach-mvp/data/shares/` e `coach-mvp/data/runs/` sono artefatti locali e non fanno parte del wiki canonico
- di default le run UI usano `gpt-5.4-mini`; puoi cambiare modello con `COACH_MVP_CODEX_MODEL`

## Limiti attuali

- una run alla volta
- nessuna autenticazione
- nessun multi-athlete strutturato lato UI
- la robustezza del risultato dipende dalla qualita' delle fonti caricate e dallo stato corrente del wiki
