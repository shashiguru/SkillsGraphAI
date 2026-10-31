# SkillGraph AI

Career navigation that connects three real services. Nothing in the pipeline is mocked.

| Layer | Service | Job |
|---|---|---|
| Knowledge graph | **Neo4j Aura** | Skills, roles, courses, certifications and the relationships between them. Every fact (gaps, prerequisites, courses) comes from Cypher. |
| Reasoning | **Nosana** (OpenAI-compatible inference) | Explains the graph facts in plain language. Output is validated with Zod and checked against the graph, so it cannot invent skills or courses. |
| Computation | **Daytona** | Runs a trusted Python script in a fresh sandbox to compute match %, priority scores, prerequisite-safe ordering and a weekly schedule. The sandbox is deleted afterwards. |

Stack: Express + TypeScript (`backend/`), Vite + React 19 + TypeScript + Tailwind (`frontend/`), TanStack Query, Cytoscape, Recharts.

## Prerequisites

- Node.js 20 or newer
- A Neo4j Aura instance (free tier works)
- A Nosana inference API key (`nos_...`)
- A Daytona API key (`dtn_...`)

## Setup (Windows PowerShell)

```powershell
cd D:\SkillsGraphAI
npm install

# Create backend\.env from the template, then fill in the values
Copy-Item .env.example backend\.env
notepad backend\.env
```

`backend\.env` keys:

| Key | Notes |
|---|---|
| `NEO4J_URI` | `neo4j+s://<id>.databases.neo4j.io` |
| `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | Shown once when the Aura instance is created. On newer instances the username and database are the instance id, not `neo4j`. |
| `NOSANA_API_KEY` | Starts with `nos_` |
| `NOSANA_MODEL` | Optional. Empty means auto-select a chat model from `GET /v1/models` |
| `DAYTONA_API_KEY` | Starts with `dtn_` |

`.env` files are git-ignored. Never commit real keys.

## Seed the graph

The dataset in `dataset\` (40 skills, 12 roles, 20 courses, 10 certifications) is loaded with an idempotent `MERGE` script, so it is safe to run repeatedly.

```powershell
npm run seed            # load the graph into Aura
npm run seed:validate   # compare graph counts with the CSV files
```

## Run

```powershell
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3000/api (health: http://localhost:3000/api/health)

## Test

```powershell
npm test                  # backend + frontend unit/component tests (no network needed)
npm run build             # type-check and production build
npm run test:integrations # LIVE end-to-end run against Neo4j, Nosana and Daytona (needs the dev server running)
```

`test:integrations` saves the Alex persona, runs the full pipeline, verifies prerequisite ordering, the Daytona result, that the sandbox was cleaned up, and a roadmap recalculation. It takes about a minute, mostly waiting on Nosana.

A few backend tests are skipped automatically when their precondition is not met (for example, local Python is not installed, or Neo4j is configured so the no-Neo4j error test does not apply).

## Pages

1. **Dashboard** - one-click "Analyze My Career" with a live event timeline.
2. **My Profile** - skills, experience, target role, weekly hours (Alex persona prefilled).
3. **Career Explorer** - roles ranked by match, with missing skills.
4. **Skill Gap Analysis** - match chart, category gaps, graph facts and the Nosana explanation.
5. **Knowledge Graph** - interactive Cytoscape view of the subgraph Neo4j returned.
6. **Learning Roadmap** - prerequisite-ordered phases and a weekly schedule; changing hours/week re-runs the schedule in Daytona.
7. **Integration Monitor** - live health, graph counts, active model and last inference/sandbox run.

## How an analysis runs

1. Neo4j: gap analysis, prerequisite closure, adjacent roles, courses and certifications.
2. In parallel: Nosana explains the facts; Daytona computes the schedule.
3. The two results are composed, validated and saved back to Neo4j.

Each step is recorded as an event and shown in the dashboard timeline. If Nosana or Daytona fails, the step is shown as failed with the reason; graph facts are still available.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Backend unreachable` in the sidebar | Check `npm run dev` output; confirm port 3000 is free. |
| Port already in use | `Get-NetTCPConnection -LocalPort 3000,5173 \| Select OwningProcess` then `Stop-Process -Id <pid>` |
| Changed `.env` but nothing changed | `.env` is read at startup. Stop and restart `npm run dev`. |
| Neo4j `Unauthorized` / cannot connect | Aura needs a few minutes after creation. Check the instance is Running at https://console.neo4j.io and that the username and database match the credentials file. |
| Nosana `max_tokens must be a positive integer` | An embedding model was selected. Leave `NOSANA_MODEL` empty or set a chat model. |
| Nosana step is slow | Reasoning models can think for minutes. The advisor requests non-thinking mode (typically 30-60 s). |
| Daytona `401` | The API key is stale or revoked; create a new one in the Daytona dashboard. |
| Frontend cannot reach the API | Set `VITE_API_BASE_URL` in `frontend\.env` and `FRONTEND_URL` in `backend\.env` (CORS). |
