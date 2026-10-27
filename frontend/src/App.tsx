import { useCallback, useEffect, useState, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import "leaflet/dist/leaflet.css";

// ------------------------------------------------------------------
// 1. PRODUCTION TYPES & SCHEMAS
// ------------------------------------------------------------------
interface Tower {
  tower_id: number;
  grid_id: number;
  latitude: number;
  longitude: number;
  current_prb_load: number;
  current_state: "Full Power" | "Micro-Sleep (ASM)" | "Deep Sleep";
  radio_type: string;
  baseline_power_w: number;
  optimized_power_w: number;
  pa_temperature_c: number;
  manual_override: boolean;
}

interface OptimizationDetails {
  tower_id: number;
  timestamp: string;
  predicted_prb: number;
  qos_allocated_prb: number;
  baseline_power_w: number;
  optimized_power_w: number;
  energy_saved_w: number;
  recommended_state: "Full Power" | "Micro-Sleep (ASM)" | "Deep Sleep";
  sla_violation_risk: boolean;
}

interface SystemSummary {
  total_towers: number;
  active_towers: number;
  average_prb_load: number;
  total_baseline_kwh: number;
  total_optimized_kwh: number;
  total_energy_saved_kwh: number;
  savings_percentage: number;
}

interface TimeSeriesPoint {
  time: string;
  actual_prb: number;
  predicted_prb: number;
  baseline_w: number;
  optimized_w: number;
}

interface SystemLog {
  id: string;
  timestamp: string;
  level: "INFO" | "WARN" | "ACTION" | "CRITICAL";
  tower_id: number;
  message: string;
}

type TowerApiRecord = Pick<
  Tower,
  "tower_id" | "grid_id" | "latitude" | "longitude" | "current_prb_load" | "current_state"
>;

// Map Centering Utility
function ChangeMapView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

export default function App() {
  // Navigation & View Mode
  const [activeTab, setActiveTab] = useState<
    "telemetry" | "analytics" | "simulation" | "hardware" | "logs"
  >("telemetry");
  const [viewMode, setViewMode] = useState<"map" | "table">("map");

  // Real-time Live Engine Controls
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [tickCount, setTickCount] = useState<number>(0);
  const [autoPilot, setAutoPilot] = useState<boolean>(true);

  // Telemetry Data State
  const [towers, setTowers] = useState<Tower[]>([]);
  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [selectedTowerId, setSelectedTowerId] = useState<number | null>(null);
  const [selectedTowerOpt, setSelectedTowerOpt] =
    useState<OptimizationDetails | null>(null);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesPoint[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);

  // UI Loading & Errors
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<string>("ALL");

  // Interactive What-If Simulation Parameters
  const [trafficMultiplier, setTrafficMultiplier] = useState<number>(1.0);
  const [safetyHeadroom, setSafetyHeadroom] = useState<number>(20);
  const [staticPowerP0, setStaticPowerP0] = useState<number>(250);

  const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "/api/v1";
  const OSM_TILE_URL =
    import.meta.env.VITE_OSM_TILE_URL ||
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const fetchTowerDetails = useCallback(async (towerId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/optimize/${towerId}`);
      if (!res.ok) throw new Error(`Tower ${towerId} telemetry unavailable.`);
      const details: OptimizationDetails = await res.json();
      setSelectedTowerOpt(details);

      const now = new Date();
      const initialPoints: TimeSeriesPoint[] = Array.from({ length: 12 }).map(
        (_, i) => {
          const t = new Date(now.getTime() - (12 - i) * 3000);
          return {
            time: `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}`,
            actual_prb: Math.min(
              100,
              Math.max(5, details.predicted_prb + (Math.random() - 0.5) * 6),
            ),
            predicted_prb: details.predicted_prb,
            baseline_w: details.baseline_power_w,
            optimized_w: details.optimized_power_w,
          };
        },
      );
      setTimeSeriesData(initialPoints);
    } catch (err) {
      console.error(err);
    }
  }, [API_BASE_URL]);

  const addLog = useCallback(
    (
      level: "INFO" | "WARN" | "ACTION" | "CRITICAL",
      towerId: number,
      message: string,
    ) => {
      const now = new Date();
      const timeStr = now.toTimeString().split(" ")[0];
      const newLog: SystemLog = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: timeStr,
        level,
        tower_id: towerId,
        message,
      };
      setSystemLogs((prev) => [newLog, ...prev.slice(0, 49)]);
    },
    [],
  );

  // ------------------------------------------------------------------
  // 2. REAL-TIME TELEMETRY STREAMING & STATE MACHINE
  // ------------------------------------------------------------------
  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [towersRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/towers`),
        fetch(`${API_BASE_URL}/analytics/summary`),
      ]);

      if (!towersRes.ok || !summaryRes.ok)
        throw new Error("Express Gateway disconnected on port 5000");

      const towersRaw: TowerApiRecord[] = await towersRes.json();
      const summaryData: SystemSummary = await summaryRes.json();

      // Transform raw towers into full production schemas
      const towersData: Tower[] = towersRaw.map((t) => ({
        tower_id: t.tower_id,
        grid_id: t.grid_id,
        latitude: t.latitude,
        longitude: t.longitude,
        current_prb_load: t.current_prb_load,
        current_state: t.current_state,
        radio_type:
          t.tower_id % 3 === 0 ? "5G NR (Massive MIMO)" : "4G LTE Advanced",
        baseline_power_w: 418.4,
        optimized_power_w:
          t.current_state === "Deep Sleep"
            ? 50.0
            : t.current_state === "Micro-Sleep (ASM)"
              ? 180.0
              : 418.4,
        pa_temperature_c: parseFloat((42.0 + Math.random() * 12.0).toFixed(1)),
        manual_override: false,
      }));

      setTowers(towersData);
      setSummary(summaryData);

      if (towersData.length > 0) {
        const firstId = towersData[0].tower_id;
        setSelectedTowerId(firstId);
        fetchTowerDetails(firstId);
      }

      addLog(
        "INFO",
        0,
        "Initial Node.js Gateway connection established. Telemetry initialized.",
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Connection lost to Node.js server on http://localhost:5000";

      setError(message || "Connection lost to Node.js server on http://localhost:5000");
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL, addLog, fetchTowerDetails]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInitialData();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadInitialData]);

  const executeSystemTick = useCallback(() => {
    setTickCount((prev) => prev + 1);

    setTowers((prevTowers) => {
      const updated = prevTowers.map((tower) => {
        if (tower.manual_override) return tower; // Respect manual operator overrides

        const noise = (Math.random() - 0.5) * 5.0;
        const newLoad = Math.min(
          98,
          Math.max(
            4,
            parseFloat(
              (tower.current_prb_load * trafficMultiplier + noise).toFixed(1),
            ),
          ),
        );

        let newState = tower.current_state;
        if (autoPilot) {
          if (newLoad < 15.0) newState = "Deep Sleep";
          else if (newLoad < 40.0) newState = "Micro-Sleep (ASM)";
          else newState = "Full Power";
        }

        // Calculate power based on 3GPP EARTH parameters
        const delta_p = 4.2;
        const Pmax = 40.0;
        const baseline = staticPowerP0 + delta_p * Pmax;
        let optPower: number;

        if (newState === "Deep Sleep") {
          optPower = staticPowerP0 * 0.2;
        } else if (newState === "Micro-Sleep (ASM)") {
          optPower = staticPowerP0 * 0.6 + delta_p * (Pmax * (newLoad / 100.0));
        } else {
          optPower = staticPowerP0 + delta_p * (Pmax * (newLoad / 100.0));
        }

        const newTemp = parseFloat(
          (38.0 + (optPower / 418.4) * 20.0 + Math.random() * 2.0).toFixed(1),
        );

        return {
          ...tower,
          current_prb_load: newLoad,
          current_state: newState,
          baseline_power_w: parseFloat(baseline.toFixed(1)),
          optimized_power_w: parseFloat(optPower.toFixed(1)),
          pa_temperature_c: newTemp,
        };
      });

      // Recalculate System Summary KPI live
      const totalBaselineW = updated.reduce(
        (s, t) => s + t.baseline_power_w,
        0,
      );
      const totalOptW = updated.reduce((s, t) => s + t.optimized_power_w, 0);
      const baselineKwh = (totalBaselineW * 1) / 1000.0;
      const optKwh = (totalOptW * 1) / 1000.0;
      const savedKwh = baselineKwh - optKwh;
      const savingPct =
        baselineKwh > 0 ? (savedKwh / baselineKwh) * 100.0 : 0.0;
      const avgLoad =
        updated.reduce((s, t) => s + t.current_prb_load, 0) / updated.length;

      setSummary({
        total_towers: updated.length,
        active_towers: updated.filter((t) => t.current_prb_load > 15.0).length,
        average_prb_load: parseFloat(avgLoad.toFixed(2)),
        total_baseline_kwh: parseFloat(baselineKwh.toFixed(2)),
        total_optimized_kwh: parseFloat(optKwh.toFixed(2)),
        total_energy_saved_kwh: parseFloat(savedKwh.toFixed(2)),
        savings_percentage: parseFloat(savingPct.toFixed(2)),
      });

      return updated;
    });

    // Append to live time-series buffer
    if (selectedTowerOpt) {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      const currentSelected = towers.find(
        (t) => t.tower_id === selectedTowerId,
      );
      const load = currentSelected
        ? currentSelected.current_prb_load
        : selectedTowerOpt.predicted_prb;
      const optW = currentSelected
        ? currentSelected.optimized_power_w
        : selectedTowerOpt.optimized_power_w;

      const newPoint: TimeSeriesPoint = {
        time: timeStr,
        actual_prb: load,
        predicted_prb: selectedTowerOpt.predicted_prb,
        baseline_w: selectedTowerOpt.baseline_power_w,
        optimized_w: optW,
      };

      setTimeSeriesData((prev) => [...prev.slice(-18), newPoint]);
    }
  }, [autoPilot, selectedTowerId, selectedTowerOpt, staticPowerP0, towers, trafficMultiplier]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isPlaying) {
      interval = setInterval(() => {
        executeSystemTick();
      }, 3000 / simSpeed);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [executeSystemTick, isPlaying, simSpeed]);

  // ------------------------------------------------------------------
  // 3. INTERACTIVE OPERATOR CONTROLS & BULK ACTIONS
  // ------------------------------------------------------------------
  function handleBulkStateChange(
    targetState: "Full Power" | "Micro-Sleep (ASM)" | "Deep Sleep",
  ) {
    setAutoPilot(false);
    setTowers((prev) =>
      prev.map((t) => ({
        ...t,
        current_state: targetState,
        manual_override: true,
      })),
    );
    addLog(
      "ACTION",
      0,
      `GLOBAL OVERRIDE: Dispatched all cell sector nodes to '${targetState}'. Auto-Pilot suspended.`,
    );
  };

  function handleManualTowerState(
    towerId: number,
    newState: "Full Power" | "Micro-Sleep (ASM)" | "Deep Sleep",
  ) {
    setTowers((prev) =>
      prev.map((t) =>
        t.tower_id === towerId
          ? { ...t, current_state: newState, manual_override: true }
          : t,
      ),
    );
    addLog(
      "ACTION",
      towerId,
      `Sector #${towerId} manual override applied: Switched state to ${newState}.`,
    );
  };

  function handleReleaseOverride(towerId: number) {
    setTowers((prev) =>
      prev.map((t) =>
        t.tower_id === towerId ? { ...t, manual_override: false } : t,
      ),
    );
    addLog(
      "INFO",
      towerId,
      `Sector #${towerId} manual override released. Reverted control to Auto-Pilot.`,
    );
  };

  // ------------------------------------------------------------------
  // 4. FILTERED DATA COMPUTATION & MEMOIZATION
  // ------------------------------------------------------------------
  const filteredTowers = useMemo(() => {
    return towers.filter((t) => {
      const matchesSearch =
        t.tower_id.toString().includes(searchQuery) ||
        t.grid_id.toString().includes(searchQuery);
      const matchesState =
        stateFilter === "ALL" || t.current_state === stateFilter;
      return matchesSearch && matchesState;
    });
  }, [towers, searchQuery, stateFilter]);

  const stateDistribution = useMemo(() => {
    const full = towers.filter((t) => t.current_state === "Full Power").length;
    const micro = towers.filter(
      (t) => t.current_state === "Micro-Sleep (ASM)",
    ).length;
    const deep = towers.filter((t) => t.current_state === "Deep Sleep").length;
    return [
      { name: "Full Power", value: full, color: "#ee0000" },
      { name: "Micro-Sleep", value: micro, color: "#f5a623" },
      { name: "Deep Sleep", value: deep, color: "#10b981" },
    ];
  }, [towers]);

  const selectedTower = useMemo(() => {
    return towers.find((t) => t.tower_id === selectedTowerId);
  }, [towers, selectedTowerId]);

  const getMarkerColor = (state: string) => {
    switch (state) {
      case "Full Power":
        return "#ee0000"; // Red
      case "Micro-Sleep (ASM)":
        return "#f5a623"; // Amber
      case "Deep Sleep":
        return "#10b981"; // Green
      default:
        return "#0070f3"; // Brand link blue
    }
  };

  // ------------------------------------------------------------------
  // 5. RENDER: LOADING / ERROR / MAIN APPLICATION SHELL
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-4">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-hairline border-t-ink" />
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-mute">
            Connecting to Telecom AI NOC Engine…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md rounded-lg border border-hairline bg-elevated p-8 text-center">
          <p className="mb-3 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-error">
            Gateway Disconnected
          </p>
          <h2 className="mb-2 text-[20px] font-semibold tracking-[-0.4px] text-ink">
            Unable to reach the Node.js API
          </h2>
          <p className="mb-6 text-sm leading-6 text-body">{error}</p>
          <button
            onClick={() => void loadInitialData()}
            className="rounded-sm bg-ink px-5 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-ink/90"
          >
            Retry Express Server Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas font-sans text-ink">
      {/* ------------------------------------------------------------------ */}
      {/* LEFT NAVIGATION SIDEBAR                                             */}
      {/* ------------------------------------------------------------------ */}
      <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-hairline bg-elevated">
        <div>
          {/* Logo Branding */}
          <div className="border-b border-hairline p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-ink text-[15px] font-bold text-white">
                ⚡
              </div>
              <div>
                <h1 className="text-[15px] font-semibold leading-tight tracking-[-0.2px] text-ink">
                  Telecom AI NOC
                </h1>
                <p className="mt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                  3GPP Release 18 Energy Engine
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1 p-3">
            <button
              onClick={() => setActiveTab("telemetry")}
              className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] transition-colors ${
                activeTab === "telemetry"
                  ? "bg-ink font-medium text-white"
                  : "font-normal text-body hover:bg-hairline-soft hover:text-ink"
              }`}
            >
              <span>🌐</span> Real-Time Sector Map
            </button>

            <button
              onClick={() => setActiveTab("analytics")}
              className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] transition-colors ${
                activeTab === "analytics"
                  ? "bg-ink font-medium text-white"
                  : "font-normal text-body hover:bg-hairline-soft hover:text-ink"
              }`}
            >
              <span>📊</span> Power &amp; Load Analytics
            </button>

            <button
              onClick={() => setActiveTab("simulation")}
              className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] transition-colors ${
                activeTab === "simulation"
                  ? "bg-ink font-medium text-white"
                  : "font-normal text-body hover:bg-hairline-soft hover:text-ink"
              }`}
            >
              <span>🎛️</span> What-If Stress Simulator
            </button>

            <button
              onClick={() => setActiveTab("hardware")}
              className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] transition-colors ${
                activeTab === "hardware"
                  ? "bg-ink font-medium text-white"
                  : "font-normal text-body hover:bg-hairline-soft hover:text-ink"
              }`}
            >
              <span>🔧</span> 3GPP EARTH Tuning
            </button>

            <button
              onClick={() => setActiveTab("logs")}
              className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] transition-colors ${
                activeTab === "logs"
                  ? "bg-ink font-medium text-white"
                  : "font-normal text-body hover:bg-hairline-soft hover:text-ink"
              }`}
            >
              <span>📋</span> System Audit Trail
            </button>
          </nav>
        </div>

        {/* Real-time Ticker & Auto-Pilot Footer */}
        <div className="border-t border-hairline p-4">
          <div className="rounded-md border border-hairline bg-canvas p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-mono text-[11px] text-body">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isPlaying ? "bg-link animate-pulse" : "bg-warning"
                  }`}
                />
                {isPlaying ? "Live Stream" : "Paused"}
              </span>
              <span className="font-mono text-[10px] text-mute">
                Tick #{tickCount}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-md border border-hairline bg-elevated px-3 py-2">
              <span className="font-mono text-[11px] text-body">
                AI Auto-Pilot:
              </span>
              <button
                onClick={() => {
                  setAutoPilot(!autoPilot);
                  addLog(
                    "INFO",
                    0,
                    `Auto-Pilot set to ${!autoPilot ? "ENABLED" : "DISABLED"}`,
                  );
                }}
                className={`rounded-sm px-2.5 py-0.5 text-[10px] font-bold transition-colors ${
                  autoPilot
                    ? "border border-link/40 bg-link/10 text-link"
                    : "border border-hairline bg-elevated text-mute"
                }`}
              >
                {autoPilot ? "ACTIVE" : "OFF"}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="flex flex-1 items-center justify-center rounded-sm bg-elevated py-1.5 text-[11px] font-semibold text-ink border border-hairline transition-colors hover:bg-hairline-soft"
              >
                {isPlaying ? "⏸ Pause" : "▶ Play"}
              </button>
              <button
                onClick={() => executeSystemTick()}
                className="rounded-sm bg-elevated px-2.5 py-1.5 text-[11px] font-semibold text-body border border-hairline transition-colors hover:bg-hairline-soft hover:text-ink"
                title="Step forward 1 tick"
              >
                ⏭ Step
              </button>
              <select
                value={simSpeed}
                onChange={(e) => setSimSpeed(Number(e.target.value))}
                className="rounded-sm border border-hairline bg-elevated px-2 py-1.5 font-mono text-[11px] text-ink focus:outline-none"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={5}>5x</option>
              </select>
            </div>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* MAIN WORKSPACE VIEW                                                 */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* TOP METRICS & KPI HEADER */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-hairline bg-canvas px-6">
          <div className="flex items-center gap-4">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
              Telecom AI NOC
            </p>
            <div className="h-6 w-px bg-hairline" />
            <h2 className="text-[15px] font-semibold tracking-[-0.2px] text-ink">
              Live Network Operations
            </h2>
          </div>

          {/* Quick Bulk Action Buttons */}
          <div className="flex items-center gap-2">
            <span className="mr-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
              Bulk Override:
            </span>
            <button
              onClick={() => handleBulkStateChange("Deep Sleep")}
              className="rounded-sm bg-ink px-2.5 py-1 text-[10px] font-bold text-white transition-colors hover:bg-ink/90"
            >
              🌙 Deep Sleep
            </button>
            <button
              onClick={() => handleBulkStateChange("Micro-Sleep (ASM)")}
              className="rounded-sm border border-hairline bg-elevated px-2.5 py-1 text-[10px] font-bold text-body transition-colors hover:bg-hairline-soft hover:text-ink"
            >
              ⚡ ASM Sleep
            </button>
            <button
              onClick={() => handleBulkStateChange("Full Power")}
              className="rounded-sm border border-hairline bg-elevated px-2.5 py-1 text-[10px] font-bold text-body transition-colors hover:bg-hairline-soft hover:text-ink"
            >
              🔥 Full Power
            </button>
          </div>
        </header>

        {/* WORKSPACE CONTENT AREA */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* KPI STAT ROW */}
            {summary && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border border-hairline bg-elevated p-5">
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
                    Active Sectors
                  </span>
                  <p className="mt-2 text-[20px] font-semibold tracking-[-0.4px] text-ink">
                    {summary.active_towers}{" "}
                    <span className="text-sm font-normal text-body">
                      / {summary.total_towers} Nodes
                    </span>
                  </p>
                </div>
                <div className="rounded-md border border-hairline bg-elevated p-5">
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
                    Avg Network PRB Load
                  </span>
                  <p className="mt-2 text-[20px] font-semibold tracking-[-0.4px] text-ink">
                    {summary.average_prb_load}
                    <span className="text-sm font-normal text-body">% Utilization</span>
                  </p>
                </div>
                <div className="rounded-md border border-hairline bg-elevated p-5">
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
                    Continuous Baseline
                  </span>
                  <p className="mt-2 text-[20px] font-semibold tracking-[-0.4px] text-ink">
                    {summary.total_baseline_kwh}{" "}
                    <span className="text-sm font-normal text-body">kWh</span>
                  </p>
                </div>
                <div className="rounded-md border border-hairline bg-elevated p-5">
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
                    AI Optimized Power
                  </span>
                  <p className="mt-2 text-[20px] font-semibold tracking-[-0.4px] text-ink">
                    {summary.total_optimized_kwh}{" "}
                    <span className="text-sm font-normal text-body">
                      kWh ({summary.savings_percentage}% Saved)
                    </span>
                  </p>
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------------ */}
            {/* TAB 1: REAL-TIME SECTOR MAP & LIVE TELEMETRY DRAWER               */}
            {/* ------------------------------------------------------------------ */}
            {activeTab === "telemetry" && (
              <div className="grid min-h-[580px] grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Sector Telemetry Map / Grid View */}
                <div className="flex flex-col rounded-md border border-hairline bg-elevated lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline p-4">
                    <div className="flex items-center gap-3">
                      <h2 className="text-[15px] font-semibold tracking-[-0.2px] text-ink uppercase">
                        Geospatial Delhi NCR OpenStreetMap
                      </h2>
                      <div className="flex items-center rounded-sm border border-hairline bg-elevated p-0.5 text-xs">
                        <button
                          onClick={() => setViewMode("map")}
                          className={`rounded-sm px-3 py-1 text-[12px] font-medium transition-colors ${
                            viewMode === "map"
                              ? "bg-ink text-white"
                              : "text-body hover:text-ink"
                          }`}
                        >
                          Map View
                        </button>
                        <button
                          onClick={() => setViewMode("table")}
                          className={`rounded-sm px-3 py-1 text-[12px] font-medium transition-colors ${
                            viewMode === "table"
                              ? "bg-ink text-white"
                              : "text-body hover:text-ink"
                          }`}
                        >
                          Grid Table
                        </button>
                      </div>
                    </div>

                    {/* Filter & Search Bar */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search Sector ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-36 rounded-sm border border-hairline bg-elevated px-3 py-1.5 font-mono text-[12px] text-ink placeholder:text-faint focus:outline-none focus:border-ink"
                      />
                      <select
                        value={stateFilter}
                        onChange={(e) => setStateFilter(e.target.value)}
                        className="rounded-sm border border-hairline bg-elevated px-3 py-1.5 font-mono text-[12px] text-ink focus:outline-none"
                      >
                        <option value="ALL">All States</option>
                        <option value="Full Power">Full Power</option>
                        <option value="Micro-Sleep (ASM)">Micro-Sleep</option>
                        <option value="Deep Sleep">Deep Sleep</option>
                      </select>
                    </div>
                  </div>

                  {/* OpenStreetMap Component */}
                  {viewMode === "map" ? (
                    <div className="relative min-h-[440px] flex-1 overflow-hidden rounded-b-md border-t border-hairline">
                      {towers.length > 0 && (
                        <MapContainer
                          center={[
                            towers.find((t) => t.tower_id === selectedTowerId)
                              ?.latitude || towers[0].latitude,
                            towers.find((t) => t.tower_id === selectedTowerId)
                              ?.longitude || towers[0].longitude,
                          ]}
                          zoom={12}
                          style={{ height: "100%", width: "100%" }}
                        >
                          <ChangeMapView
                            center={[
                              towers.find((t) => t.tower_id === selectedTowerId)
                                ?.latitude || towers[0].latitude,
                              towers.find((t) => t.tower_id === selectedTowerId)
                                ?.longitude || towers[0].longitude,
                            ]}
                          />
                          <TileLayer url={OSM_TILE_URL} />
                          {filteredTowers.map((tower) => (
                            <CircleMarker
                              key={tower.tower_id}
                              center={[tower.latitude, tower.longitude]}
                              radius={selectedTowerId === tower.tower_id ? 11 : 7}
                              pathOptions={{
                                color:
                                  selectedTowerId === tower.tower_id
                                    ? "#171717"
                                    : getMarkerColor(tower.current_state),
                                fillColor: getMarkerColor(tower.current_state),
                                fillOpacity: 0.85,
                                weight:
                                  selectedTowerId === tower.tower_id ? 3 : 1,
                              }}
                              eventHandlers={{
                                click: () => {
                                  setSelectedTowerId(tower.tower_id);
                                  fetchTowerDetails(tower.tower_id);
                                },
                              }}
                            >
                              <Popup>
                                <div className="rounded-md border border-hairline bg-elevated px-3 py-2 font-sans text-[12px] text-ink">
                                  <strong>Sector Node #{tower.tower_id}</strong>
                                  <br />
                                  PRB Load: {tower.current_prb_load}%
                                  <br />
                                  State: <em>{tower.current_state}</em>
                                </div>
                              </Popup>
                            </CircleMarker>
                          ))}
                        </MapContainer>
                      )}
                    </div>
                  ) : (
                    /* Telemetry Grid Table */
                    <div className="flex-1 overflow-y-auto rounded-b-md border-t border-hairline bg-canvas">
                      <table className="w-full border-collapse text-left font-mono text-xs">
                        <thead>
                          <tr className="border-b border-hairline bg-canvas text-[11px] uppercase text-mute">
                            <th className="p-3">Sector ID</th>
                            <th className="p-3">Radio Stack</th>
                            <th className="p-3">PRB Load</th>
                            <th className="p-3">Power (W)</th>
                            <th className="p-3">PA Temp</th>
                            <th className="p-3">Operating State</th>
                            <th className="p-3">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline font-mono">
                          {filteredTowers.map((t) => (
                            <tr
                              key={t.tower_id}
                              className={`transition-colors hover:bg-hairline-soft ${
                                selectedTowerId === t.tower_id ? "bg-hairline-soft" : ""
                              }`}
                            >
                              <td className="p-3 font-bold text-link">
                                #{t.tower_id}
                              </td>
                              <td className="p-3 text-body">{t.radio_type}</td>
                              <td className="p-3 font-bold text-ink">
                                {t.current_prb_load}%
                              </td>
                              <td className="p-3 font-bold text-ink">
                                {t.optimized_power_w} W
                              </td>
                              <td className="p-3 text-body">
                                {t.pa_temperature_c} °C
                              </td>
                              <td className="p-3">
                                <span
                                  className={`rounded-sm px-2 py-0.5 text-[10px] font-bold ${
                                    t.current_state === "Deep Sleep"
                                      ? "bg-emerald-500/10 text-emerald-600"
                                      : t.current_state === "Micro-Sleep (ASM)"
                                        ? "bg-amber-500/10 text-amber-600"
                                        : "bg-red-500/10 text-red-600"
                                  }`}
                                >
                                  {t.current_state}
                                </span>
                              </td>
                              <td className="p-3">
                                <button
                                  onClick={() => {
                                    setSelectedTowerId(t.tower_id);
                                    fetchTowerDetails(t.tower_id);
                                  }}
                                  className="rounded-sm bg-ink px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-ink/90"
                                >
                                  Inspect Node
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Dynamic Live Telemetry Inspector Drawer */}
                <div className="flex flex-col rounded-md border border-hairline bg-elevated p-5">
                  <h2 className="mb-4 text-[15px] font-semibold tracking-[-0.2px] text-ink uppercase">
                    AI Operational Recommendation Queue
                  </h2>

                  {selectedTower ? (
                    <div className="flex flex-1 flex-col justify-between gap-4">
                      {/* Node Header */}
                      <div className="flex items-center justify-between rounded-md border border-hairline bg-canvas p-4">
                        <div>
                          <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                            Selected Base Station
                          </span>
                          <div className="mt-0.5 text-[20px] font-semibold tracking-[-0.4px] text-link">
                            Sector #{selectedTower.tower_id}
                          </div>
                          <span className="mt-0.5 font-mono text-[11px] text-body">
                            {selectedTower.radio_type}
                          </span>
                        </div>
                        {selectedTower.manual_override ? (
                          <span className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[10px] font-bold text-amber-600">
                            MANUAL OVERRIDE
                          </span>
                        ) : (
                          <span className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] font-bold text-emerald-600">
                            AI AUTO-PILOT
                          </span>
                        )}
                      </div>

                      {/* Live Load & Hardware Gauges */}
                      <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                        <div className="rounded-md border border-hairline bg-canvas p-3.5">
                          <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                            PRB Load Demand
                          </span>
                          <span className="mt-1 block text-[15px] font-bold text-ink">
                            {selectedTower.current_prb_load}%
                          </span>
                        </div>
                        <div className="rounded-md border border-hairline bg-canvas p-3.5">
                          <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                            PA Thermal Reading
                          </span>
                          <span className="mt-1 block text-[15px] font-bold text-ink">
                            {selectedTower.pa_temperature_c} °C
                          </span>
                        </div>
                      </div>

                      {/* Power State Controls */}
                      <div className="space-y-2 rounded-md border border-hairline bg-canvas p-4">
                        <span className="mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                          Operating Power State
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex-1 rounded-lg border px-3 py-1.5 text-center text-xs font-bold ${
                              selectedTower.current_state === "Deep Sleep"
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                                : selectedTower.current_state === "Micro-Sleep (ASM)"
                                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                                  : "border-red-500/40 bg-red-500/10 text-red-600"
                            }`}
                          >
                            {selectedTower.current_state}
                          </span>
                        </div>

                        {/* Manual Operator Switch Buttons */}
                        <div className="flex items-center gap-1.5 pt-2 font-mono text-[10px]">
                          <button
                            onClick={() =>
                              handleManualTowerState(
                                selectedTower.tower_id,
                                "Deep Sleep",
                              )
                            }
                            className="flex-1 rounded-md border border-hairline bg-elevated py-1 text-ink transition-colors hover:bg-hairline-soft"
                          >
                            Set Deep Sleep
                          </button>
                          <button
                            onClick={() =>
                              handleManualTowerState(
                                selectedTower.tower_id,
                                "Micro-Sleep (ASM)",
                              )
                            }
                            className="flex-1 rounded-md border border-hairline bg-elevated py-1 text-ink transition-colors hover:bg-hairline-soft"
                          >
                            Set ASM Sleep
                          </button>
                          {selectedTower.manual_override && (
                            <button
                              onClick={() =>
                                handleReleaseOverride(selectedTower.tower_id)
                              }
                              className="rounded-md bg-link px-2 py-1 font-semibold text-white"
                              title="Release manual override back to AI Auto-Pilot"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Real-time Dynamic Line Chart */}
                      <div className="flex-1 rounded-md border border-hairline bg-canvas p-3">
                        <span className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                          Real-Time PRB Load Stream
                        </span>
                        <div className="h-28 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={timeSeriesData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#ebebeb"
                              />
                              <XAxis
                                dataKey="time"
                                stroke="#ebebeb"
                                tick={{ fontSize: 10, fill: "#8f8f8f" }}
                                tickLine={false}
                              />
                              <YAxis
                                domain={[0, 100]}
                                stroke="#ebebeb"
                                tick={{ fontSize: 10, fill: "#8f8f8f" }}
                                tickLine={false}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "#ffffff",
                                  border: "1px solid #ebebeb",
                                  borderRadius: "12px",
                                  fontSize: "11px",
                                }}
                              />
                              <Line
                                type="monotone"
                                dataKey="actual_prb"
                                stroke="#171717"
                                strokeWidth={2}
                                dot={false}
                                name="Actual PRB (%)"
                              />
                              <Line
                                type="monotone"
                                dataKey="predicted_prb"
                                stroke="#0070f3"
                                strokeWidth={2}
                                strokeDasharray="4 4"
                                dot={false}
                                name="Forecast (%)"
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="rounded-md border border-link-soft bg-link-soft p-3.5 text-[12px] leading-relaxed text-body">
                        💡 <strong className="font-semibold text-ink">Action Rationale:</strong>{" "}
                        Base station consumes {selectedTower.optimized_power_w}W (saving{" "}
                        {418.4 - selectedTower.optimized_power_w}W baseline power).
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 text-sm text-mute">
                      Select a sector node on the map to inspect telemetry.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------------ */}
            {/* TAB 2: POWER & LOAD ANALYTICS HUB                                   */}
            {/* ------------------------------------------------------------------ */}
            {activeTab === "analytics" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  {/* Chart 1: Continuous Baseline vs AI Power Stream */}
                  <div className="rounded-md border border-hairline bg-elevated p-5 lg:col-span-2">
                    <h3 className="mb-3 text-[15px] font-semibold tracking-[-0.2px] text-ink uppercase">
                      Continuous Baseline vs. AI Power Stream (Watts)
                    </h3>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={timeSeriesData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ebebeb" />
                          <XAxis
                            dataKey="time"
                            stroke="#ebebeb"
                            tick={{ fontSize: 10, fill: "#8f8f8f" }}
                            tickLine={false}
                          />
                          <YAxis stroke="#ebebeb" tick={{ fontSize: 10, fill: "#8f8f8f" }} tickLine={false} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #ebebeb",
                              borderRadius: "12px",
                              fontSize: "11px",
                            }}
                          />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="baseline_w"
                            stackId="1"
                            stroke="#ee0000"
                            fill="#ee0000"
                            fillOpacity={0.12}
                            name="Baseline 100% Power (W)"
                          />
                          <Area
                            type="monotone"
                            dataKey="optimized_w"
                            stackId="2"
                            stroke="#0070f3"
                            fill="#0070f3"
                            fillOpacity={0.12}
                            name="AI Optimized Power (W)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Chart 2: Operating State Distribution Pie Chart */}
                  <div className="flex flex-col items-center justify-center rounded-md border border-hairline bg-elevated p-5">
                    <h3 className="mb-3 self-start text-[15px] font-semibold tracking-[-0.2px] text-ink uppercase">
                      Active Operating State Ratio
                    </h3>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={stateDistribution}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {stateDistribution.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #ebebeb",
                              borderRadius: "12px",
                              fontSize: "11px",
                            }}
                          />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Chart 3: Sector Power Comparison Bar Chart */}
                <div className="rounded-md border border-hairline bg-elevated p-5">
                  <h3 className="mb-3 text-[15px] font-semibold tracking-[-0.2px] text-ink uppercase">
                    Power Consumption Across Top Sector Nodes
                  </h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={towers.slice(0, 10).map((t) => ({
                          id: `Tower #${t.tower_id}`,
                          load: t.current_prb_load,
                          power: t.optimized_power_w,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#ebebeb" />
                        <XAxis
                          dataKey="id"
                          stroke="#ebebeb"
                          tick={{ fontSize: 10, fill: "#8f8f8f" }}
                          tickLine={false}
                        />
                        <YAxis stroke="#ebebeb" tick={{ fontSize: 10, fill: "#8f8f8f" }} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#ffffff",
                            border: "1px solid #ebebeb",
                            borderRadius: "12px",
                            fontSize: "11px",
                          }}
                        />
                        <Bar
                          dataKey="power"
                          fill="#171717"
                          radius={[4, 4, 0, 0]}
                          name="Optimized Power (W)"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------------ */}
            {/* TAB 3: WHAT-IF STRESS SIMULATOR ENGINE                              */}
            {/* ------------------------------------------------------------------ */}
            {activeTab === "simulation" && (
              <div className="grid min-h-[420px] grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Simulation Controls Sidebar */}
                <div className="flex flex-col rounded-md border border-hairline bg-elevated p-5">
                  <h2 className="mb-1 text-[15px] font-semibold tracking-[-0.2px] text-ink uppercase">
                    What-If Control Parameters
                  </h2>
                  <p className="mb-6 text-xs text-body">
                    Simulate stadium crowds, traffic surges, or custom safety
                    headroom settings live.
                  </p>

                  <div className="flex flex-1 flex-col justify-center gap-6 text-xs font-mono">
                    <div>
                      <label className="mb-1 flex justify-between font-semibold text-ink">
                        <span>Traffic Surge Scale:</span>
                        <span className="text-link">{trafficMultiplier}x</span>
                      </label>
                      <input
                        type="range"
                        min="0.5"
                        max="2.5"
                        step="0.1"
                        value={trafficMultiplier}
                        onChange={(e) =>
                          setTrafficMultiplier(parseFloat(e.target.value))
                        }
                        className="w-full accent-ink"
                      />
                    </div>

                    <div>
                      <label className="mb-1 flex justify-between font-semibold text-ink">
                        <span>QoS Headroom Buffer:</span>
                        <span className="text-link">+{safetyHeadroom}%</span>
                      </label>
                      <input
                        type="range"
                        min="5"
                        max="50"
                        step="5"
                        value={safetyHeadroom}
                        onChange={(e) =>
                          setSafetyHeadroom(parseInt(e.target.value))
                        }
                        className="w-full accent-ink"
                      />
                    </div>

                    <div>
                      <label className="mb-1 flex justify-between font-semibold text-ink">
                        <span>Base Power (P0):</span>
                        <span className="text-link">{staticPowerP0} W</span>
                      </label>
                      <input
                        type="range"
                        min="150"
                        max="400"
                        step="10"
                        value={staticPowerP0}
                        onChange={(e) => setStaticPowerP0(parseInt(e.target.value))}
                        className="w-full accent-ink"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setTrafficMultiplier(1.0);
                      setSafetyHeadroom(20);
                      setStaticPowerP0(250);
                    }}
                    className="mt-6 w-full rounded-md border border-hairline bg-elevated py-2 text-[12px] font-semibold text-ink transition-colors hover:bg-hairline-soft"
                  >
                    Reset Default Controls
                  </button>
                </div>

                {/* Simulation Outcome Panel */}
                <div className="flex flex-col justify-between rounded-md border border-hairline bg-elevated p-5 lg:col-span-2">
                  <h2 className="mb-4 text-[15px] font-semibold tracking-[-0.2px] text-ink uppercase">
                    Simulated Power &amp; SLA Outcome
                  </h2>

                  {selectedTowerOpt && (
                    <div className="flex flex-col gap-6">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="rounded-md border border-hairline bg-canvas p-4">
                          <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                            Simulated PRB Load
                          </span>
                          <span className="mt-1 block text-[20px] font-semibold tracking-[-0.4px] text-ink">
                            {(
                              selectedTowerOpt.predicted_prb * trafficMultiplier
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                        <div className="rounded-md border border-hairline bg-canvas p-4">
                          <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                            Allocated Capacity
                          </span>
                          <span className="mt-1 block text-[20px] font-semibold tracking-[-0.4px] text-link">
                            {(
                              selectedTowerOpt.predicted_prb *
                              trafficMultiplier *
                              (1 + safetyHeadroom / 100)
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                        <div className="rounded-md border border-hairline bg-canvas p-4">
                          <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-mute">
                            Estimated Savings
                          </span>
                          <span className="mt-1 block text-[20px] font-semibold tracking-[-0.4px] text-ink">
                            {(
                              418.4 - selectedTowerOpt.optimized_power_w
                            ).toFixed(1)}{" "}
                            W
                          </span>
                        </div>
                      </div>

                      <div className="rounded-md border border-hairline bg-canvas p-4">
                        <h3 className="mb-2 text-[11px] font-semibold text-ink uppercase">
                          Simulation State Evaluation
                        </h3>
                        <p className="text-xs leading-relaxed text-body">
                          Under a{" "}
                          <strong className="font-semibold text-ink">
                            {trafficMultiplier}x traffic surge
                          </strong>{" "}
                          with a{" "}
                          <strong className="font-semibold text-ink">
                            +{safetyHeadroom}% headroom buffer
                          </strong>
                          , base station static power scales dynamically to
                          maintain SLA compliance.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------------ */}
            {/* TAB 4: 3GPP HARDWARE TUNING                                         */}
            {/* ------------------------------------------------------------------ */}
            {activeTab === "hardware" && (
              <div className="rounded-md border border-hairline bg-elevated p-6">
                <h2 className="mb-1 text-[20px] font-semibold tracking-[-0.4px] text-ink">
                  3GPP Release 18 EARTH Base Station Hardware Specifications
                </h2>
                <p className="mb-6 font-mono text-[12px] text-body">
                  Non-linear power equations applied across active sector
                  transceivers.
                </p>

                <div className="grid grid-cols-1 gap-6 font-mono text-xs md:grid-cols-3">
                  <div className="rounded-md border border-hairline bg-canvas p-4">
                    <h3 className="mb-2 font-bold text-ink">Macro Cell (3GPP)</h3>
                    <p className="text-body">P0 (Static Idle): 250.0 W</p>
                    <p className="text-body">Delta_p (Slope): 4.2</p>
                    <p className="text-body">Pmax (RF Output): 40.0 W</p>
                    <p className="mt-2 font-bold text-ink">Max Power: 418.4 W</p>
                  </div>

                  <div className="rounded-md border border-hairline bg-canvas p-4">
                    <h3 className="mb-2 font-bold text-ink">Micro-Sleep (ASM) Mode</h3>
                    <p className="text-body">Symbol gap amplifier gating</p>
                    <p className="text-body">Disables PA during zero traffic</p>
                    <p className="text-body">Transition Latency: 35 µs</p>
                    <p className="mt-2 font-bold text-ink">Power Reduction: ~40%</p>
                  </div>

                  <div className="rounded-md border border-hairline bg-canvas p-4">
                    <h3 className="mb-2 font-bold text-ink">Deep Sleep Mode</h3>
                    <p className="text-body">Deactivates secondary carriers</p>
                    <p className="text-body">BBU static power reduction</p>
                    <p className="text-body">Transition Latency: 15 ms</p>
                    <p className="mt-2 font-bold text-ink">Power Reduction: ~80%</p>
                  </div>
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------------ */}
            {/* TAB 5: SYSTEM AUDIT TRAIL LOGS                                     */}
            {/* ------------------------------------------------------------------ */}
            {activeTab === "logs" && (
              <div className="rounded-md border border-hairline bg-elevated p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[20px] font-semibold tracking-[-0.4px] text-ink">
                    System Operations &amp; Audit Trail Log
                  </h2>
                  <span className="font-mono text-[12px] text-mute">
                    {systemLogs.length} Events Captured
                  </span>
                </div>

                <div className="max-h-[500px] space-y-2 overflow-y-auto pr-2 font-mono text-xs">
                  {systemLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between rounded-md border border-hairline bg-canvas p-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-mute">{log.timestamp}</span>
                        <span
                          className={`rounded-sm px-2 py-0.5 text-[10px] font-bold ${
                            log.level === "ACTION"
                              ? "bg-link/10 text-link"
                              : log.level === "WARN"
                                ? "bg-amber-500/10 text-amber-600"
                                : log.level === "CRITICAL"
                                  ? "bg-red-500/10 text-red-600"
                                  : "bg-canvas border border-hairline text-body"
                          }`}
                        >
                          {log.level}
                        </span>
                        <span className="text-body">{log.message}</span>
                      </div>
                      {log.tower_id > 0 && (
                        <span className="font-bold text-ink">
                          Sector #{log.tower_id}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
