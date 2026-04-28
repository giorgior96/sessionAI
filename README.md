# SessionAI

Trainer workspace for generating athlete programs from Google Drive sheets, coach feedback, and a Codex-maintained local wiki.

## Flow

1. The trainer logs in with Google Drive.
2. The app imports an athletes folder.
3. Each athlete folder exposes previous sheets and sheet previews.
4. Google Sheets are converted into UI tables, including cell notes and available Drive comments.
5. The trainer adds free-form goals and feedback.
6. The backend saves sources in `raw/sources/` and runs `codex exec`.
7. Codex updates the internal wiki and writes a mobile share JSON for the athlete view.

## Stack

- React + Vite frontend
- Express backend
- Google Drive / Sheets APIs
- Codex CLI for generation
- File-system wiki in `wiki/`

## Development

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

Backend: `http://localhost:8787`

## Environment

Create `.env`:

```bash
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

On Vercel, leave `VITE_API_BASE_URL` unset so `vercel.json` can proxy `/api` to the VPS backend.

Optional backend model override:

```bash
COACH_MVP_CODEX_MODEL=gpt-5.4-mini
```

## Build

```bash
npm run build
npm run start
```

## API

- `GET /api/status`
- `POST /api/generate`
- `GET /api/share/:shareId`

## Generated Data

Private/generated athlete data is intentionally ignored:

- `raw/sources/`
- `data/runs/*.json`
- `data/shares/*.json`
- athlete-specific wiki output under `wiki/athletes/`, `wiki/sources/`, `wiki/programs/`, and `wiki/analyses/`

The backend creates missing wiki structure on startup.
