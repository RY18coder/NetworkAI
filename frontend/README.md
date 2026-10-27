# Telecom AI NOC — Frontend

React 19 + TypeScript + Vite + Tailwind CSS v4 dashboard for the **Telecom AI NOC**,
a 3GPP Release 18 base-station energy optimization product.

## Features

- **Real-Time Sector Map** — live geospatial view of cell towers (OpenStreetMap
  via react-leaflet) with search + state filters and a grid table fallback.
- **Power & Load Analytics** — baseline vs. AI-optimized power area chart, operating
  state distribution pie, top-sector power bar chart (recharts).
- **What-If Stress Simulator** — traffic surge, QoS headroom and static power (P0)
  sliders driving the AI energy engine.
- **3GPP EARTH Tuning** — hardware spec reference for Macro Cell, Micro-Sleep (ASM)
  and Deep Sleep modes.

## Getting Started

```bash
npm install
npm run dev
```

The dev server proxies `/api/*` to the local backend (see `vite.config.ts`), so the
frontend expects the Express gateway running on `http://localhost:5000`.

## Build

```bash
npm run build
```

## Design System

Implements the ink (`#171717`) on canvas (`#fafafa`) design language defined in
`DESIGN.md` (Geist typography, hairline borders, tight radii, pill CTAs).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Backend API Gateway base URL (proxied in dev, absolute in prod) |
| `VITE_OSM_TILE_URL` | OpenStreetMap | Base map tile URL |
| `VITE_OSM_ATTRIBUTION` | OSM attribution | Map attribution |
| `VITE_MAPBOX_TOKEN` | — | Optional Mapbox token |
| `VITE_DEFAULT_SAFETY_HEADROOM_PCT` | `20` | Default safety headroom |
| `VITE_DEFAULT_BASE_STATION_P0_WATTS` | `250` | Default static power P0 |
| `VITE_DEFAULT_BASE_STATION_DELTA_P` | `4.2` | Default slope delta_p |
| `VITE_DEFAULT_BASE_STATION_PMAX_WATTS` | `40` | Default Pmax |
