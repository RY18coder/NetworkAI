# Telecom AI NOC — Frontend

Real-time 3GPP Release 18 cell tower energy optimization dashboard (React 19 + TypeScript + Vite + Tailwind CSS v4 + Recharts + Leaflet).

## Features

- **Real-Time Sector Map** — live geospatial view of the Delhi NCR cell grid (OpenStreetMap via Leaflet) with color-coded state markers and a searchable / filterable grid table.
- **Power & Load Analytics** — baseline vs. AI-optimized power streams (area chart), operating state distribution (pie chart), sector power comparison (bar chart).
- **What-If Stress Simulator** — traffic surge scaling, QoS headroom buffer and base-station power (P0) sliders with simulated SLA outcomes.
- **3GPP EARTH Tuning** — hardware parameter reference (Macro cell, Micro-Sleep ASM, Deep Sleep).
- **System Audit Trail** — live operations / audit log of auto-pilot and manual overrides.

## Getting Started

```bash
npm install
npm run dev
```

The dev server runs on http://localhost:5173 and proxies `/api/*` to the local backend gateway (see `vite.config.ts`).

## Environment Variables

Copy the example and adjust as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | Base URL of the Node.js Express telemetry gateway. Use `/api/v1` with the Vite dev proxy, or your deployed backend URL in production. |
| `VITE_OSM_TILE_URL` | OpenStreetMap tiles | Tile server used by the Leaflet map. |
| `VITE_OSM_ATTRIBUTION` | OpenStreetMap attribution | Map attribution. |
| `VITE_MAPBOX_TOKEN` | – | Optional Mapbox token (dark-mode tiles). |
| `VITE_DEFAULT_SAFETY_HEADROOM_PCT` | `20` | Default safety headroom (%) used by the simulator. |
| `VITE_DEFAULT_BASE_STATION_P0_WATTS` | `250` | Default static idle power P0 (W). |
| `VITE_DEFAULT_BASE_STATION_DELTA_P` | `4.2` | Default slope delta_p. |
| `VITE_DEFAULT_BASE_STATION_PMAX_WATTS` | `40` | Default max power Pmax (W). |

## Build & Preview

```bash
npm run build    # tsc -b && vite build
npm run preview  # preview the production build
npm run lint     # eslint
```

## Deploying on Vercel

The frontend and Express API can be deployed as two Vercel projects from the
same GitHub repository:

1. Import the repository at [vercel.com/new](https://vercel.com/new) and set
   the project's **Root Directory** to `backend`. Deploy it as the API project.
   The backend Vercel configuration includes the telemetry CSV and routes
   `/api/v1/*` requests to Express.
2. Import the same repository again as a second Vercel project and set its
   **Root Directory** to `frontend`. Vercel should detect Vite; use
   `npm run build` as the build command and `dist` as the output directory.
3. In the frontend project's environment variables, set
   `VITE_API_BASE_URL` to
   `https://<your-backend-domain>/api/v1` (no trailing slash), then redeploy.
   Vite embeds this value at build time.
4. In the backend project's environment variables, set `CORS_ORIGIN` to the
   exact frontend origin, such as `https://<your-frontend-domain>`. For
   multiple allowed origins, separate them with commas and no spaces.
5. Verify the backend at `/health` and `/api/v1/analytics/summary`, then open
   the frontend deployment and confirm its telemetry loads.

The frontend's default `/api/v1` URL is intended for local development through
the Vite proxy. A separately deployed frontend must use the backend's full
URL. Vercel Functions are suitable for this Express API; use a persistent
Node.js host instead if you later need long-running background jobs or
in-memory state shared reliably between requests.

## Design

The UI uses a Vercel-style ink-and-canvas theme: near-white canvas (`#fafafa`), near-black ink (`#171717`), Geist / Geist Mono typography, hairline borders, tight functional radii, and pill CTAs.
