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
    import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1";
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
      { name: "Full Power", value: full, color: "#ef4444" },
      { name: "Micro-Sleep", value: micro, color: "#f59e0b" },
      { name: "Deep Sleep", value: deep, color: "#10b981" },
    ];
  }, [towers]);

  const selectedTower = useMemo(() => {
    return towers.find((t) => t.tower_id === selectedTowerId);
  }, [towers, selectedTowerId]);

  const getMarkerColor = (state: string) => {
    switch (state) {
      case "Full Power":
        return "#ef4444"; // Red
      case "Micro-Sleep (ASM)":
        return "#f59e0b"; // Amber
      case "Deep Sleep":
        return "#10b981"; // Green
      default:
        return "#3b82f6";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-200 font-mono text-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Connecting to Real-Time Telecom Telemetry Engine...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-red-400 p-6 font-sans">
        <h2 className="text-2xl font-bold mb-2">
          Node.js Express Gateway Disconnected
        </h2>
        <p className="text-slate-400 mb-4 text-center max-w-md">{error}</p>
        <button
          onClick={loadInitialData}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-500 font-semibold text-sm transition-all"
        >
          Retry Express Server Connection
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden selection:bg-blue-500 selection:text-white">
      {/* ------------------------------------------------------------------ */}
      {/* LEFT NAVIGATION SIDEBAR                                             */}
      {/* ------------------------------------------------------------------ */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo Branding */}
          <div className="p-5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-emerald-500 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-blue-500/20">
                ⚡
              </div>
              <div>
                <h1 className="font-bold text-sm text-white leading-tight">
                  Telecom AI NOC
                </h1>
                <p className="text-[10px] text-slate-400 font-mono">
                  3GPP Release 18 Energy Engine
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab("telemetry")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === "telemetry"
                  ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span>🌐</span> Real-Time Sector Map
            </button>

            <button
              onClick={() => setActiveTab("analytics")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === "analytics"
                  ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span>📊</span> Power & Load Analytics
            </button>

            <button
              onClick={() => setActiveTab("simulation")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === "simulation"
                  ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span>🎛️</span> What-If Stress Simulator
            </button>

            <button
              onClick={() => setActiveTab("hardware")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === "hardware"
                  ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span>🔧</span> 3GPP EARTH Tuning
            </button>

            <button
              onClick={() => setActiveTab("logs")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                activeTab === "logs"
                  ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span>📋</span> System Audit Trail
            </button>
          </nav>
        </div>

        {/* Real-time Ticker & Auto-Pilot Footer */}
        <div className="p-4 border-t border-slate-800 text-xs font-mono space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${isPlaying ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
              ></span>
              <strong className="text-white">
                {isPlaying ? "LIVE STREAM" : "PAUSED"}
              </strong>
            </span>
            <span className="text-[10px] text-slate-500">
              Tick #{tickCount}
            </span>
          </div>

          <div className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800">
            <span className="text-slate-400 text-[11px]">AI Auto-Pilot:</span>
            <button
              onClick={() => {
                setAutoPilot(!autoPilot);
                addLog(
                  "INFO",
                  0,
                  `Auto-Pilot set to ${!autoPilot ? "ENABLED" : "DISABLED"}`,
                );
              }}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                autoPilot
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {autoPilot ? "ACTIVE" : "OFF"}
            </button>
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-sans text-[11px] font-semibold transition-all"
            >
              {isPlaying ? "⏸ Pause" : "▶ Play"}
            </button>
            <button
              onClick={() => executeSystemTick()}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg font-sans text-[11px] font-semibold transition-all"
              title="Step forward 1 tick"
            >
              ⏭ Step
            </button>
            <select
              value={simSpeed}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
              className="bg-slate-800 text-white px-2 py-1.5 rounded-lg text-[11px] font-sans focus:outline-none"
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={5}>5x</option>
            </select>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* MAIN WORKSPACE VIEW                                                 */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex-grow flex flex-col overflow-hidden">
        {/* TOP METRICS & KPI HEADER */}
        <header className="h-16 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                Active Sectors
              </span>
              <div className="text-sm font-bold text-white">
                {summary?.active_towers} / {summary?.total_towers} Nodes
              </div>
            </div>
            <div className="h-8 w-px bg-slate-800"></div>
            <div>
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                Avg Network PRB Load
              </span>
              <div className="text-sm font-bold text-blue-400">
                {summary?.average_prb_load}% Utilization
              </div>
            </div>
            <div className="h-8 w-px bg-slate-800"></div>
            <div>
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                Continuous Baseline
              </span>
              <div className="text-sm font-bold text-slate-300">
                {summary?.total_baseline_kwh} kWh
              </div>
            </div>
            <div className="h-8 w-px bg-slate-800"></div>
            <div>
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                AI Optimized Power
              </span>
              <div className="text-sm font-bold text-emerald-400">
                {summary?.total_optimized_kwh} kWh (
                {summary?.savings_percentage}% Saved)
              </div>
            </div>
          </div>

          {/* Quick Bulk Action Buttons */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500 uppercase mr-1">
              Bulk Override:
            </span>
            <button
              onClick={() => handleBulkStateChange("Deep Sleep")}
              className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-[10px] font-mono font-bold transition-all"
            >
              🌙 Deep Sleep
            </button>
            <button
              onClick={() => handleBulkStateChange("Micro-Sleep (ASM)")}
              className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-[10px] font-mono font-bold transition-all"
            >
              ⚡ ASM Sleep
            </button>
            <button
              onClick={() => handleBulkStateChange("Full Power")}
              className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-[10px] font-mono font-bold transition-all"
            >
              🔥 Full Power
            </button>
          </div>
        </header>

        {/* WORKSPACE CONTENT AREA */}
        <div className="flex-grow p-6 overflow-y-auto">
          {/* ------------------------------------------------------------------ */}
          {/* TAB 1: REAL-TIME SECTOR MAP & LIVE TELEMETRY DRAWER               */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === "telemetry" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full min-h-[580px]">
              {/* Sector Telemetry Map / Grid View */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                      Geospatial Delhi NCR OpenStreetMap
                    </h2>
                    <div className="flex items-center bg-slate-950 rounded-lg p-0.5 border border-slate-800 text-xs">
                      <button
                        onClick={() => setViewMode("map")}
                        className={`px-3 py-1 rounded-md font-medium transition-all ${viewMode === "map" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
                      >
                        Map View
                      </button>
                      <button
                        onClick={() => setViewMode("table")}
                        className={`px-3 py-1 rounded-md font-medium transition-all ${viewMode === "table" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
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
                      className="bg-slate-950 border border-slate-800 text-xs text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500 w-36"
                    />
                    <select
                      value={stateFilter}
                      onChange={(e) => setStateFilter(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-xs text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500"
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
                  <div className="w-full flex-grow rounded-xl overflow-hidden border border-slate-800 relative min-h-[440px]">
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
                                  ? "#ffffff"
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
                              <div className="text-slate-900 font-sans text-xs">
                                <strong>Sector Node #{tower.tower_id}</strong>
                                <br />
                                PRB Load: {tower.current_prb_load}%<br />
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
                  <div className="w-full flex-grow overflow-y-auto rounded-xl border border-slate-800 bg-slate-950">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-mono uppercase">
                          <th className="p-3">Sector ID</th>
                          <th className="p-3">Radio Stack</th>
                          <th className="p-3">PRB Load</th>
                          <th className="p-3">Power (W)</th>
                          <th className="p-3">PA Temp</th>
                          <th className="p-3">Operating State</th>
                          <th className="p-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {filteredTowers.map((t) => (
                          <tr
                            key={t.tower_id}
                            className={`hover:bg-slate-900/60 transition-colors ${selectedTowerId === t.tower_id ? "bg-blue-950/30" : ""}`}
                          >
                            <td className="p-3 font-bold text-blue-400">
                              #{t.tower_id}
                            </td>
                            <td className="p-3 text-slate-400">
                              {t.radio_type}
                            </td>
                            <td className="p-3 text-white font-bold">
                              {t.current_prb_load}%
                            </td>
                            <td className="p-3 text-emerald-400 font-bold">
                              {t.optimized_power_w} W
                            </td>
                            <td className="p-3 text-slate-300">
                              {t.pa_temperature_c} °C
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  t.current_state === "Deep Sleep"
                                    ? "bg-emerald-500/20 text-emerald-400"
                                    : t.current_state === "Micro-Sleep (ASM)"
                                      ? "bg-amber-500/20 text-amber-400"
                                      : "bg-red-500/20 text-red-400"
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
                                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-sans font-semibold"
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
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
                    AI Operational Recommendation Queue
                  </h2>

                  {selectedTower ? (
                    <div className="space-y-4">
                      {/* Node Header */}
                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex justify-between items-center">
                        <div>
                          <span className="text-[10px] text-slate-500 font-mono uppercase">
                            Selected Base Station
                          </span>
                          <div className="text-xl font-bold text-blue-400">
                            Sector #{selectedTower.tower_id}
                          </div>
                          <span className="text-xs text-slate-400 font-mono">
                            {selectedTower.radio_type}
                          </span>
                        </div>
                        {selectedTower.manual_override ? (
                          <span className="px-2 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded text-[10px] font-mono font-bold">
                            MANUAL OVERRIDE
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded text-[10px] font-mono font-bold">
                            AI AUTO-PILOT
                          </span>
                        )}
                      </div>

                      {/* Live Load & Hardware Gauges */}
                      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                          <span className="text-slate-400 text-[10px] block uppercase">
                            PRB Load Demand
                          </span>
                          <span className="font-bold text-white text-base">
                            {selectedTower.current_prb_load}%
                          </span>
                        </div>
                        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                          <span className="text-slate-400 text-[10px] block uppercase">
                            PA Thermal Reading
                          </span>
                          <span className="font-bold text-slate-200 text-base">
                            {selectedTower.pa_temperature_c} °C
                          </span>
                        </div>
                      </div>

                      {/* Power State Controls */}
                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                        <span className="text-slate-400 text-[10px] font-mono uppercase block mb-1">
                          Operating Power State
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold text-center ${
                              selectedTower.current_state === "Deep Sleep"
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : selectedTower.current_state ===
                                    "Micro-Sleep (ASM)"
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                                  : "bg-red-500/20 text-red-400 border border-red-500/40"
                            }`}
                          >
                            {selectedTower.current_state}
                          </span>
                        </div>

                        {/* Manual Operator Switch Buttons */}
                        <div className="pt-2 flex items-center gap-1.5 font-mono text-[10px]">
                          <button
                            onClick={() =>
                              handleManualTowerState(
                                selectedTower.tower_id,
                                "Deep Sleep",
                              )
                            }
                            className="flex-1 py-1 bg-slate-800 hover:bg-emerald-950 text-slate-300 hover:text-emerald-400 rounded transition-all"
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
                            className="flex-1 py-1 bg-slate-800 hover:bg-amber-950 text-slate-300 hover:text-amber-400 rounded transition-all"
                          >
                            Set ASM Sleep
                          </button>
                          {selectedTower.manual_override && (
                            <button
                              onClick={() =>
                                handleReleaseOverride(selectedTower.tower_id)
                              }
                              className="px-2 py-1 bg-blue-900/50 hover:bg-blue-800 text-blue-300 rounded"
                              title="Release manual override back to AI Auto-Pilot"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Real-time Dynamic Line Chart */}
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                        <span className="text-[10px] font-mono text-slate-400 uppercase block mb-2">
                          Real-Time PRB Load Stream
                        </span>
                        <div className="h-28 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={timeSeriesData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#1e293b"
                              />
                              <XAxis
                                dataKey="time"
                                stroke="#64748b"
                                tick={{ fontSize: 9 }}
                              />
                              <YAxis
                                domain={[0, 100]}
                                stroke="#64748b"
                                tick={{ fontSize: 9 }}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "#0f172a",
                                  borderColor: "#334155",
                                  fontSize: "11px",
                                }}
                              />
                              <Line
                                type="monotone"
                                dataKey="actual_prb"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                dot={false}
                                name="Actual PRB (%)"
                              />
                              <Line
                                type="monotone"
                                dataKey="predicted_prb"
                                stroke="#10b981"
                                strokeWidth={2}
                                strokeDasharray="4 4"
                                dot={false}
                                name="Forecast (%)"
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="bg-blue-950/40 border border-blue-800/50 p-3.5 rounded-xl text-xs text-blue-200 leading-relaxed">
                        💡 <strong>Action Rationale:</strong> Base station
                        consumes {selectedTower.optimized_power_w}W (saving{" "}
                        {418.4 - selectedTower.optimized_power_w}W baseline
                        power).
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate-500 text-xs">
                      Select a sector node on the map to inspect telemetry.
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-800 text-xs font-mono">
                  SLA Capacity Protection:{" "}
                  <span className="text-emerald-400 font-bold">
                    ✅ 100% Guaranteed (20% Headroom)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* TAB 2: POWER & LOAD ANALYTICS HUB                                   */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === "analytics" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Chart 1: Continuous Baseline vs AI Power Stream */}
                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">
                    Continuous Baseline vs. AI Power Stream (Watts)
                  </h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis
                          dataKey="time"
                          stroke="#64748b"
                          tick={{ fontSize: 10 }}
                        />
                        <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#0f172a",
                            borderColor: "#334155",
                          }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="baseline_w"
                          stackId="1"
                          stroke="#ef4444"
                          fill="#ef4444"
                          fillOpacity={0.2}
                          name="Baseline 100% Power (W)"
                        />
                        <Area
                          type="monotone"
                          dataKey="optimized_w"
                          stackId="2"
                          stroke="#10b981"
                          fill="#10b981"
                          fillOpacity={0.4}
                          name="AI Optimized Power (W)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 2: Operating State Distribution Pie Chart */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 self-start">
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
                            backgroundColor: "#0f172a",
                            borderColor: "#334155",
                          }}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Chart 3: Sector Power Comparison Bar Chart */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">
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
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="id"
                        stroke="#64748b"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          borderColor: "#334155",
                        }}
                      />
                      <Bar
                        dataKey="power"
                        fill="#3b82f6"
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Simulation Controls Sidebar */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-6">
                <div>
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
                    What-If Control Parameters
                  </h2>
                  <p className="text-xs text-slate-400">
                    Simulate stadium crowds, traffic surges, or custom safety
                    headroom settings live.
                  </p>
                </div>

                <div className="space-y-4 text-xs font-mono">
                  <div>
                    <label className="flex justify-between text-slate-300 font-semibold mb-1">
                      <span>Traffic Surge Scale:</span>
                      <span className="text-blue-400">
                        {trafficMultiplier}x
                      </span>
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
                      className="w-full accent-blue-500"
                    />
                  </div>

                  <div>
                    <label className="flex justify-between text-slate-300 font-semibold mb-1">
                      <span>QoS Headroom Buffer:</span>
                      <span className="text-blue-400">+{safetyHeadroom}%</span>
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
                      className="w-full accent-blue-500"
                    />
                  </div>

                  <div>
                    <label className="flex justify-between text-slate-300 font-semibold mb-1">
                      <span>Base Power (P0):</span>
                      <span className="text-blue-400">{staticPowerP0} W</span>
                    </label>
                    <input
                      type="range"
                      min="150"
                      max="400"
                      step="10"
                      value={staticPowerP0}
                      onChange={(e) =>
                        setStaticPowerP0(parseInt(e.target.value))
                      }
                      className="w-full accent-blue-500"
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    setTrafficMultiplier(1.0);
                    setSafetyHeadroom(20);
                    setStaticPowerP0(250);
                  }}
                  className="w-full py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-semibold transition-all"
                >
                  Reset Default Controls
                </button>
              </div>

              {/* Simulation Outcome Panel */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
                    Simulated Power & SLA Outcome
                  </h2>

                  {selectedTowerOpt && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                          <span className="text-slate-400 text-[10px] uppercase block font-mono">
                            Simulated PRB Load
                          </span>
                          <span className="text-xl font-bold text-white">
                            {(
                              selectedTowerOpt.predicted_prb * trafficMultiplier
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                          <span className="text-slate-400 text-[10px] uppercase block font-mono">
                            Allocated Capacity
                          </span>
                          <span className="text-xl font-bold text-blue-400">
                            {(
                              selectedTowerOpt.predicted_prb *
                              trafficMultiplier *
                              (1 + safetyHeadroom / 100)
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                          <span className="text-slate-400 text-[10px] uppercase block font-mono">
                            Estimated Savings
                          </span>
                          <span className="text-xl font-bold text-emerald-400">
                            {(
                              418.4 - selectedTowerOpt.optimized_power_w
                            ).toFixed(1)}{" "}
                            W
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                        <h3 className="text-xs font-bold text-white uppercase mb-2">
                          Simulation State Evaluation
                        </h3>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Under a{" "}
                          <strong className="text-white">
                            {trafficMultiplier}x traffic surge
                          </strong>{" "}
                          with a{" "}
                          <strong className="text-white">
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
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* TAB 4: 3GPP HARDWARE TUNING                                         */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === "hardware" && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div>
                <h2 className="text-base font-bold text-white mb-1">
                  3GPP Release 18 EARTH Base Station Hardware Specifications
                </h2>
                <p className="text-xs text-slate-400 font-mono">
                  Non-linear power equations applied across active sector
                  transceivers.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <h3 className="font-bold text-blue-400 mb-2">
                    Macro Cell (3GPP)
                  </h3>
                  <p className="text-slate-400">P0 (Static Idle): 250.0 W</p>
                  <p className="text-slate-400">Delta_p (Slope): 4.2</p>
                  <p className="text-slate-400">Pmax (RF Output): 40.0 W</p>
                  <p className="text-slate-200 mt-2 font-bold">
                    Max Power: 418.4 W
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <h3 className="font-bold text-emerald-400 mb-2">
                    Micro-Sleep (ASM) Mode
                  </h3>
                  <p className="text-slate-400">Symbol gap amplifier gating</p>
                  <p className="text-slate-400">
                    Disables PA during zero traffic
                  </p>
                  <p className="text-slate-400">Transition Latency: 35 µs</p>
                  <p className="text-slate-200 mt-2 font-bold">
                    Power Reduction: ~40%
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <h3 className="font-bold text-amber-400 mb-2">
                    Deep Sleep Mode
                  </h3>
                  <p className="text-slate-400">
                    Deactivates secondary carriers
                  </p>
                  <p className="text-slate-400">BBU static power reduction</p>
                  <p className="text-slate-400">Transition Latency: 15 ms</p>
                  <p className="text-slate-200 mt-2 font-bold">
                    Power Reduction: ~80%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* TAB 5: SYSTEM AUDIT TRAIL LOGS                                     */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === "logs" && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-bold text-white">
                  System Operations & Audit Trail Log
                </h2>
                <span className="text-xs font-mono text-slate-500">
                  {systemLogs.length} Events Captured
                </span>
              </div>

              <div className="space-y-2 font-mono text-xs max-h-[500px] overflow-y-auto pr-2">
                {systemLogs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500">{log.timestamp}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.level === "ACTION"
                            ? "bg-blue-500/20 text-blue-400"
                            : log.level === "WARN"
                              ? "bg-amber-500/20 text-amber-400"
                              : log.level === "CRITICAL"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {log.level}
                      </span>
                      <span className="text-slate-300">{log.message}</span>
                    </div>
                    {log.tower_id > 0 && (
                      <span className="text-slate-500 font-bold">
                        Sector #{log.tower_id}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
