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

## Design

The UI follows the design system documented in the repository-root `DESIGN.md` (Vercel-style ink & canvas language): near-white canvas (`#fafafa`), near-black ink (`#171717`), Geist / Geist Mono typography, hairline borders, tight functional radii (6px) and pill CTAs.
