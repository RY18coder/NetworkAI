import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  fetchSystemSummary,
  fetchTowers,
  fetchTowerOptimization,
} from "./services/api";
import type {
  OptimizationDetails,
  SystemLog,
  SystemSummary,
  TimeSeriesPoint,
  Tower,
} from "./types";

// ------------------------------------------------------------------
// 2. DESIGN TOKENS & 3GPP EARTH HARDWARE PHYSICS CONSTANTS
// ------------------------------------------------------------------
const STATIC_POWER_P0 = parseFloat(
  import.meta.env.VITE_DEFAULT_BASE_STATION_P0_WATTS || "250",
) || 250;
const DELTA_P = parseFloat(
  import.meta.env.VITE_DEFAULT_BASE_STATION_DELTA_P || "4.2",
) || 4.2;
const PMAX = parseFloat(
  import.meta.env.VITE_DEFAULT_BASE_STATION_PMAX_WATTS || "40",
) || 40;

// Map Centering Utility
function ChangeMapView({ center }: { center: [number, number] }) {
  const map = useMap();
  const lat = center[0];
  const lng = center[1];
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export default function App() {
  // Theme Mode: "light" | "dark"
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("telecom_theme");
      if (saved === "dark" || saved === "light") return saved;
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("telecom_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  // Standalone / Simulated Demo Mode
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

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
  const [staticPowerP0, setStaticPowerP0] = useState<number>(STATIC_POWER_P0);

  const OSM_TILE_URL =
    import.meta.env.VITE_OSM_TILE_URL ||
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const generateSimulatedTowers = useCallback((): Tower[] => {
    const baseLat = 28.6139;
    const baseLon = 77.209;
    return Array.from({ length: 36 }).map((_, i) => {
      const towerId = 1001 + i;
      const lat = parseFloat((baseLat + Math.sin(i * 0.7) * 0.08).toFixed(5));
      const lon = parseFloat((baseLon + Math.cos(i * 0.7) * 0.08).toFixed(5));
      const load = parseFloat((14 + ((i * 17) % 76)).toFixed(1));
      const state: "Full Power" | "Micro-Sleep (ASM)" | "Deep Sleep" =
        load < 20 ? "Deep Sleep" : load < 45 ? "Micro-Sleep (ASM)" : "Full Power";
      const baselineW = STATIC_POWER_P0 + DELTA_P * PMAX;
      const optPower =
        state === "Deep Sleep"
          ? STATIC_POWER_P0 * 0.2
          : state === "Micro-Sleep (ASM)"
            ? STATIC_POWER_P0 * 0.6 + DELTA_P * (PMAX * (load / 100))
            : STATIC_POWER_P0 + DELTA_P * (PMAX * (load / 100));

      return {
        tower_id: towerId,
        grid_id: towerId,
        latitude: lat,
        longitude: lon,
        current_prb_load: load,
        current_state: state,
        radio_type: i % 3 === 0 ? "5G NR (Massive MIMO)" : "4G LTE Advanced",
        baseline_power_w: baselineW,
        optimized_power_w: parseFloat(optPower.toFixed(1)),
        pa_temperature_c: parseFloat((40 + Math.random() * 12).toFixed(1)),
        manual_override: false,
      };
    });
  }, []);

  const generateSimulatedSummary = useCallback((tList: Tower[]): SystemSummary => {
    const total = tList.length;
    const active = tList.filter((t) => t.current_prb_load > 15).length;
    const avgLoad =
      tList.reduce((s, t) => s + t.current_prb_load, 0) / (total || 1);
    const totalBaseW = tList.reduce((s, t) => s + t.baseline_power_w, 0);
    const totalOptW = tList.reduce((s, t) => s + t.optimized_power_w, 0);
    const baseKwh = (totalBaseW * 1) / 1000;
    const optKwh = (totalOptW * 1) / 1000;
    const savedKwh = baseKwh - optKwh;
    const savingPct = baseKwh > 0 ? (savedKwh / baseKwh) * 100 : 0;
    return {
      total_towers: total,
      active_towers: active,
      average_prb_load: parseFloat(avgLoad.toFixed(2)),
      total_baseline_kwh: parseFloat(baseKwh.toFixed(2)),
      total_optimized_kwh: parseFloat(optKwh.toFixed(2)),
      total_energy_saved_kwh: parseFloat(savedKwh.toFixed(2)),
      savings_percentage: parseFloat(savingPct.toFixed(2)),
    };
  }, []);

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

  const enableDemoMode = useCallback(() => {
    setIsDemoMode(true);
    setError(null);
    const mockTowers = generateSimulatedTowers();
    setTowers(mockTowers);
    setSummary(generateSimulatedSummary(mockTowers));
    if (mockTowers.length > 0) {
      const firstId = mockTowers[0].tower_id;
      setSelectedTowerId(firstId);
      const mockOpt: OptimizationDetails = {
        tower_id: firstId,
        timestamp: new Date().toISOString(),
        predicted_prb: parseFloat(
          (mockTowers[0].current_prb_load * 0.95).toFixed(1),
        ),
        qos_allocated_prb: parseFloat(
          (mockTowers[0].current_prb_load * 1.15).toFixed(1),
        ),
        baseline_power_w: mockTowers[0].baseline_power_w,
        optimized_power_w: mockTowers[0].optimized_power_w,
        energy_saved_w: parseFloat(
          (
            mockTowers[0].baseline_power_w - mockTowers[0].optimized_power_w
          ).toFixed(1),
        ),
        recommended_state: mockTowers[0].current_state,
        sla_violation_risk: false,
      };
      setSelectedTowerOpt(mockOpt);
      const now = new Date();
      const pts: TimeSeriesPoint[] = Array.from({ length: 12 }).map((_, i) => {
        const t = new Date(now.getTime() - (12 - i) * 3000);
        return {
          time: `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}`,
          actual_prb: Math.min(
            100,
            Math.max(5, mockOpt.predicted_prb + (Math.random() - 0.5) * 6),
          ),
          predicted_prb: mockOpt.predicted_prb,
          baseline_w: mockOpt.baseline_power_w,
          optimized_w: mockOpt.optimized_power_w,
        };
      });
      setTimeSeriesData(pts);
    }
    addLog(
      "INFO",
      0,
      "Simulated 3GPP telemetry engine started in standalone mode.",
    );
  }, [addLog, generateSimulatedSummary, generateSimulatedTowers]);

  const towersRef = useRef<Tower[]>([]);
  useEffect(() => {
    towersRef.current = towers;
  }, [towers]);

  const fetchTowerDetails = useCallback(
    async (towerId: number) => {
      try {
        let details: OptimizationDetails;
        if (isDemoMode) {
          const tMatch = towersRef.current.find((t) => t.tower_id === towerId);
          const prb = tMatch ? tMatch.current_prb_load : 35;
          const baseline = tMatch
            ? tMatch.baseline_power_w
            : STATIC_POWER_P0 + DELTA_P * PMAX;
          const opt = tMatch ? tMatch.optimized_power_w : STATIC_POWER_P0 * 0.6;
          details = {
            tower_id: towerId,
            timestamp: new Date().toISOString(),
            predicted_prb: parseFloat((prb * 0.95).toFixed(1)),
            qos_allocated_prb: parseFloat((prb * 1.15).toFixed(1)),
            baseline_power_w: baseline,
            optimized_power_w: opt,
            energy_saved_w: parseFloat((baseline - opt).toFixed(1)),
            recommended_state: tMatch ? tMatch.current_state : "Micro-Sleep (ASM)",
            sla_violation_risk: false,
          };
        } else {
          details = await fetchTowerOptimization(towerId);
        }
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
    },
    [isDemoMode],
  );

  // ------------------------------------------------------------------
  // 2. REAL-TIME TELEMETRY STREAMING & STATE MACHINE
  // ------------------------------------------------------------------
  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [towersData, summaryData] = await Promise.all([
        fetchTowers(),
        fetchSystemSummary(),
      ]);

      const towersList: Tower[] = towersData.map((t) => ({
        tower_id: t.tower_id,
        grid_id: t.grid_id,
        latitude: t.latitude,
        longitude: t.longitude,
        current_prb_load: t.current_prb_load,
        current_state: t.current_state,
        radio_type:
          t.tower_id % 3 === 0 ? "5G NR (Massive MIMO)" : "4G LTE Advanced",
        baseline_power_w: STATIC_POWER_P0 + DELTA_P * PMAX,
        optimized_power_w:
          t.current_state === "Deep Sleep"
            ? STATIC_POWER_P0 * 0.2
            : t.current_state === "Micro-Sleep (ASM)"
              ? STATIC_POWER_P0 * 0.6 + DELTA_P * (PMAX * (t.current_prb_load / 100.0))
              : STATIC_POWER_P0 + DELTA_P * (PMAX * (t.current_prb_load / 100.0)),
        pa_temperature_c: parseFloat((42.0 + Math.random() * 12.0).toFixed(1)),
        manual_override: false,
      }));

      setTowers(towersList);
      setSummary(summaryData);

      if (towersList.length > 0) {
        const firstId = towersList[0].tower_id;
        setSelectedTowerId(firstId);
        void fetchTowerDetails(firstId);
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

      setError(message);
    } finally {
      setLoading(false);
    }
  }, [addLog, fetchTowerDetails]);

  // Initial data load on mount with cancellation guard
  useEffect(() => {
    let ignore = false;

    const init = async () => {
      try {
        const [towersData, summaryData] = await Promise.all([
          fetchTowers(),
          fetchSystemSummary(),
        ]);

        if (ignore) return;

        const towersList: Tower[] = towersData.map((t) => ({
          tower_id: t.tower_id,
          grid_id: t.grid_id,
          latitude: t.latitude,
          longitude: t.longitude,
          current_prb_load: t.current_prb_load,
          current_state: t.current_state,
          radio_type:
            t.tower_id % 3 === 0 ? "5G NR (Massive MIMO)" : "4G LTE Advanced",
          baseline_power_w: STATIC_POWER_P0 + DELTA_P * PMAX,
          optimized_power_w:
            t.current_state === "Deep Sleep"
              ? STATIC_POWER_P0 * 0.2
              : t.current_state === "Micro-Sleep (ASM)"
                ? STATIC_POWER_P0 * 0.6 + DELTA_P * (PMAX * (t.current_prb_load / 100.0))
                : STATIC_POWER_P0 + DELTA_P * (PMAX * (t.current_prb_load / 100.0)),
          pa_temperature_c: parseFloat((42.0 + Math.random() * 12.0).toFixed(1)),
          manual_override: false,
        }));

        setTowers(towersList);
        setSummary(summaryData);

        if (towersList.length > 0) {
          const firstId = towersList[0].tower_id;
          setSelectedTowerId(firstId);
          void fetchTowerDetails(firstId);
        }

        addLog(
          "INFO",
          0,
          "Initial Node.js Gateway connection established. Telemetry initialized.",
        );
      } catch (err: unknown) {
        if (ignore) return;
        const message =
          err instanceof Error
            ? err.message
            : "Connection lost to Node.js server on http://localhost:5000";
        setError(message);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    void init();

    return () => {
      ignore = true;
    };
  }, [addLog, fetchTowerDetails]);

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
        const delta_p = DELTA_P;
        const Pmax = PMAX;
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

  // Keep a ref to the latest tick so the interval never resets mid-flight
  const executeSystemTickRef = useRef(executeSystemTick);
  useEffect(() => {
    executeSystemTickRef.current = executeSystemTick;
  }, [executeSystemTick]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const interval = setInterval(() => {
      executeSystemTickRef.current();
    }, 3000 / simSpeed);

    return () => {
      clearInterval(interval);
    };
  }, [isPlaying, simSpeed]);

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
  }

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
  }

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
  }

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
      {
        name: "Full Power",
        value: full,
        color: theme === "dark" ? "#60a5fa" : "#171717",
      },
      { name: "Micro-Sleep", value: micro, color: "#f5a623" },
      { name: "Deep Sleep", value: deep, color: "#50e3c2" },
    ];
  }, [towers, theme]);

  const selectedTower = useMemo(() => {
    return towers.find((t) => t.tower_id === selectedTowerId);
  }, [towers, selectedTowerId]);

  const getMarkerColor = (state: string) => {
    switch (state) {
      case "Full Power":
        return theme === "dark" ? "#60a5fa" : "#171717";
      case "Micro-Sleep (ASM)":
        return "#f5a623";
      case "Deep Sleep":
        return "#50e3c2";
      default:
        return "#0070f3";
    }
  };

  const chartGridStroke = theme === "dark" ? "#27272a" : "#ebebeb";
  const chartTextStroke = theme === "dark" ? "#a1a1aa" : "#8f8f8f";
  const chartTooltipStyle = useMemo(
    () => ({
      backgroundColor: theme === "dark" ? "#121215" : "#ffffff",
      borderColor: theme === "dark" ? "#27272a" : "#ebebeb",
      borderRadius: "8px",
      fontSize: "11px",
      color: theme === "dark" ? "#f4f4f5" : "#171717",
      boxShadow:
        theme === "dark"
          ? "0 8px 24px rgba(0, 0, 0, 0.6)"
          : "0 4px 12px rgba(0, 0, 0, 0.08)",
    }),
    [theme],
  );

  const getStateBadgeClass = (state: string) => {
    switch (state) {
      case "Deep Sleep":
        return "bg-cyan-soft text-ink";
      case "Micro-Sleep (ASM)":
        return "bg-warning-soft text-warning-deep";
      default:
        return "bg-canvas border border-hairline text-ink";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-canvas font-mono text-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-4 border-hairline border-t-primary rounded-full animate-spin"></div>
          <span className="text-body">Connecting to Real-Time Telecom Telemetry Engine...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-canvas text-ink p-6 font-sans">
        <div className="w-12 h-12 rounded-full bg-warning-soft text-warning-deep border border-warning/30 flex items-center justify-center text-xl mb-4 font-bold">
          ⚡
        </div>
        <h2 className="text-xl font-bold mb-2">Telemetry Gateway Offline</h2>
        <p className="text-body mb-6 text-center max-w-md text-xs leading-relaxed">
          {error}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={enableDemoMode}
            className="px-5 py-2.5 bg-primary text-on-primary rounded-sm hover:opacity-90 font-semibold text-xs transition-all shadow-xs"
          >
            🚀 Launch Simulated Demo Mode
          </button>
          <button
            onClick={loadInitialData}
            className="px-4 py-2.5 bg-canvas-elevated border border-hairline text-ink hover:bg-hairline rounded-sm font-semibold text-xs transition-all"
          >
            🔄 Retry Gateway Connection
          </button>
          <button
            onClick={toggleTheme}
            className="px-3 py-2.5 bg-canvas border border-hairline text-ink hover:bg-hairline rounded-sm font-mono text-xs transition-all"
            title="Toggle Light / Dark Mode"
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-canvas text-ink font-sans overflow-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* LEFT NAVIGATION SIDEBAR                                             */}
      {/* ------------------------------------------------------------------ */}
      <aside className="w-64 bg-canvas-elevated border-r border-hairline flex flex-col justify-between shrink-0">
        <div>
          {/* Logo Branding */}
          <div className="p-5 border-b border-hairline">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-lg">
                ⚡
              </div>
              <div>
                <h1 className="font-bold text-sm text-ink leading-tight">
                  Telecom AI NOC
                </h1>
                <p className="text-[10px] text-mute font-mono">
                  3GPP Release 18 Energy Engine
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab("telemetry")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-xs font-medium transition-all ${
                activeTab === "telemetry"
                  ? "bg-primary text-on-primary"
                  : "text-body hover:bg-canvas hover:text-ink"
              }`}
            >
              <span>🌐</span> Real-Time Sector Map
            </button>

            <button
              onClick={() => setActiveTab("analytics")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-xs font-medium transition-all ${
                activeTab === "analytics"
                  ? "bg-primary text-on-primary"
                  : "text-body hover:bg-canvas hover:text-ink"
              }`}
            >
              <span>📊</span> Power & Load Analytics
            </button>

            <button
              onClick={() => setActiveTab("simulation")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-xs font-medium transition-all ${
                activeTab === "simulation"
                  ? "bg-primary text-on-primary"
                  : "text-body hover:bg-canvas hover:text-ink"
              }`}
            >
              <span>🎛️</span> What-If Stress Simulator
            </button>

            <button
              onClick={() => setActiveTab("hardware")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-xs font-medium transition-all ${
                activeTab === "hardware"
                  ? "bg-primary text-on-primary"
                  : "text-body hover:bg-canvas hover:text-ink"
              }`}
            >
              <span>🔧</span> 3GPP EARTH Tuning
            </button>

            <button
              onClick={() => setActiveTab("logs")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-xs font-medium transition-all ${
                activeTab === "logs"
                  ? "bg-primary text-on-primary"
                  : "text-body hover:bg-canvas hover:text-ink"
              }`}
            >
              <span>📋</span> System Audit Trail
            </button>
          </nav>
        </div>

        {/* Real-time Ticker & Auto-Pilot Footer */}
        <div className="p-4 border-t border-hairline text-xs font-mono space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${isPlaying ? "bg-cyan animate-pulse" : "bg-warning"}`}
              ></span>
              <strong className="text-ink">
                {isPlaying ? "LIVE STREAM" : "PAUSED"}
              </strong>
            </span>
            <span className="text-[10px] text-mute">Tick #{tickCount}</span>
          </div>

          <div className="flex items-center justify-between bg-canvas p-2 rounded-sm border border-hairline">
            <span className="text-body text-[11px]">AI Auto-Pilot:</span>
            <button
              onClick={() => {
                setAutoPilot(!autoPilot);
                addLog(
                  "INFO",
                  0,
                  `Auto-Pilot set to ${!autoPilot ? "ENABLED" : "DISABLED"}`,
                );
              }}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                autoPilot
                  ? "bg-link-soft text-link-deep border border-link/40"
                  : "bg-canvas border border-hairline text-body"
              }`}
            >
              {autoPilot ? "ACTIVE" : "OFF"}
            </button>
          </div>

          <div className="flex items-center justify-between bg-canvas p-2 rounded-sm border border-hairline">
            <span className="text-body text-[11px]">Theme Mode:</span>
            <button
              onClick={toggleTheme}
              className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-canvas-elevated border border-hairline text-ink hover:border-ink/40 transition-all flex items-center gap-1 cursor-pointer"
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex-1 py-1.5 bg-canvas-elevated hover:bg-hairline text-ink border border-hairline rounded-sm font-sans text-[11px] font-semibold transition-all"
            >
              {isPlaying ? "⏸ Pause" : "▶ Play"}
            </button>
            <button
              onClick={() => executeSystemTick()}
              className="px-2.5 py-1.5 bg-canvas-elevated hover:bg-hairline text-ink border border-hairline rounded-sm font-sans text-[11px] font-semibold transition-all"
              title="Step forward 1 tick"
            >
              ⏭ Step
            </button>
            <select
              value={simSpeed}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
              className="bg-canvas-elevated text-ink px-2 py-1.5 rounded-sm text-[11px] font-sans focus:outline-none"
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
        <header className="h-16 bg-canvas-elevated border-b border-hairline px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-[10px] text-mute font-mono uppercase tracking-wider">
                Active Sectors
              </span>
              <div className="text-sm font-bold text-ink">
                {summary?.active_towers} / {summary?.total_towers} Nodes
              </div>
            </div>
            <div className="h-8 w-px bg-hairline"></div>
            <div>
              <span className="text-[10px] text-mute font-mono uppercase tracking-wider">
                Avg Network PRB Load
              </span>
              <div className="text-sm font-bold text-ink">
                {summary?.average_prb_load}% Utilization
              </div>
            </div>
            <div className="h-8 w-px bg-hairline"></div>
            <div>
              <span className="text-[10px] text-mute font-mono uppercase tracking-wider">
                Continuous Baseline
              </span>
              <div className="text-sm font-bold text-ink">
                {summary?.total_baseline_kwh} kWh
              </div>
            </div>
            <div className="h-8 w-px bg-hairline"></div>
            <div>
              <span className="text-[10px] text-mute font-mono uppercase tracking-wider">
                AI Optimized Power
              </span>
              <div className="text-sm font-bold text-ink">
                {summary?.total_optimized_kwh} kWh (
                {summary?.savings_percentage}% Saved)
              </div>
            </div>
          </div>

          {/* Quick Bulk Action Buttons & Dark Mode Toggle */}
          <div className="flex items-center gap-2">
            {isDemoMode ? (
              <button
                onClick={loadInitialData}
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-violet-soft text-violet text-[10px] font-mono font-semibold border border-violet/30 hover:opacity-85 transition-all cursor-pointer mr-1"
                title="Running simulated 3GPP telemetry. Click to reconnect to live gateway."
              >
                <span className="w-1.5 h-1.5 rounded-full bg-violet animate-pulse"></span>
                Simulated Demo
              </button>
            ) : (
              <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-cyan-soft text-ink text-[10px] font-mono font-semibold border border-cyan/30 mr-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan"></span>
                Live Gateway
              </span>
            )}

            <span className="text-[10px] font-mono text-mute uppercase mr-1 hidden lg:inline">
              Bulk Override:
            </span>
            <button
              onClick={() => handleBulkStateChange("Deep Sleep")}
              className="px-2.5 py-1 bg-cyan-soft text-ink border border-hairline rounded-sm text-[10px] font-mono font-bold transition-all"
            >
              🌙 Deep Sleep
            </button>
            <button
              onClick={() => handleBulkStateChange("Micro-Sleep (ASM)")}
              className="px-2.5 py-1 bg-warning-soft text-warning-deep border border-hairline rounded-sm text-[10px] font-mono font-bold transition-all"
            >
              ⚡ ASM Sleep
            </button>
            <button
              onClick={() => handleBulkStateChange("Full Power")}
              className="px-2.5 py-1 bg-canvas-elevated text-ink border border-hairline rounded-sm text-[10px] font-mono font-bold transition-all"
            >
              🔥 Full Power
            </button>

            {/* Dark Mode Toggle Button */}
            <button
              id="theme-toggle-btn"
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-canvas border border-hairline hover:border-ink/40 text-ink rounded-pill text-xs font-mono font-medium transition-all shadow-xs cursor-pointer ml-2"
              title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
              aria-label="Toggle Light / Dark Mode"
            >
              {theme === "dark" ? (
                <>
                  <span className="text-warning text-sm">☀️</span>
                  <span className="font-sans text-[11px] font-semibold">Light</span>
                </>
              ) : (
                <>
                  <span className="text-violet text-sm">🌙</span>
                  <span className="font-sans text-[11px] font-semibold">Dark</span>
                </>
              )}
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
              <div className="lg:col-span-2 bg-canvas-elevated border border-hairline rounded-md p-4 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
                      Geospatial Delhi NCR OpenStreetMap
                    </h2>
                    <div className="flex items-center bg-canvas border border-hairline rounded-sm p-0.5 text-xs">
                      <button
                        onClick={() => setViewMode("map")}
                        className={`px-3 py-1 rounded-sm font-medium transition-all ${
                          viewMode === "map"
                            ? "bg-primary text-on-primary"
                            : "text-body hover:text-ink"
                        }`}
                      >
                        Map View
                      </button>
                      <button
                        onClick={() => setViewMode("table")}
                        className={`px-3 py-1 rounded-sm font-medium transition-all ${
                          viewMode === "table"
                            ? "bg-primary text-on-primary"
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
                      className="bg-canvas border border-hairline text-xs text-ink px-3 py-1.5 rounded-sm focus:outline-none focus:border-ink w-36 placeholder:text-mute"
                    />
                    <select
                      value={stateFilter}
                      onChange={(e) => setStateFilter(e.target.value)}
                      className="bg-canvas border border-hairline text-xs text-ink px-3 py-1.5 rounded-sm focus:outline-none focus:border-ink"
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
                  <div className="w-full flex-grow rounded-md overflow-hidden border border-hairline relative min-h-[440px]">
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
                                  ? theme === "dark"
                                    ? "#f4f4f5"
                                    : "#171717"
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
                              <div className="text-ink font-sans text-xs">
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
                  <div className="w-full flex-grow overflow-y-auto rounded-md border border-hairline bg-canvas-elevated">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-hairline bg-canvas text-mute font-mono uppercase">
                          <th className="p-3">Sector ID</th>
                          <th className="p-3">Radio Stack</th>
                          <th className="p-3">PRB Load</th>
                          <th className="p-3">Power (W)</th>
                          <th className="p-3">PA Temp</th>
                          <th className="p-3">Operating State</th>
                          <th className="p-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline-soft font-mono">
                        {filteredTowers.map((t) => (
                          <tr
                            key={t.tower_id}
                            className={`hover:bg-canvas transition-colors ${
                              selectedTowerId === t.tower_id ? "bg-canvas" : ""
                            }`}
                          >
                            <td className="p-3 font-bold text-ink">
                              #{t.tower_id}
                            </td>
                            <td className="p-3 text-body">{t.radio_type}</td>
                            <td className="p-3 text-ink font-bold">
                              {t.current_prb_load}%
                            </td>
                            <td className="p-3 text-ink font-bold">
                              {t.optimized_power_w} W
                            </td>
                            <td className="p-3 text-body">
                              {t.pa_temperature_c} °C
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStateBadgeClass(t.current_state)}`}
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
                                className="px-2.5 py-1 bg-primary text-on-primary rounded-sm text-[10px] font-sans font-semibold cursor-pointer hover:opacity-90 transition-all"
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
              <div className="bg-canvas-elevated border border-hairline rounded-md p-5 flex flex-col justify-between">
                <div>
                  <h2 className="text-sm font-bold text-ink uppercase tracking-wider mb-4">
                    AI Operational Recommendation Queue
                  </h2>

                  {selectedTower ? (
                    <div className="space-y-4">
                      {/* Node Header */}
                      <div className="bg-canvas p-4 rounded-md border border-hairline flex justify-between items-center">
                        <div>
                          <span className="text-[10px] text-mute font-mono uppercase">
                            Selected Base Station
                          </span>
                          <div className="text-xl font-bold text-ink">
                            Sector #{selectedTower.tower_id}
                          </div>
                          <span className="text-xs text-body font-mono">
                            {selectedTower.radio_type}
                          </span>
                        </div>
                        {selectedTower.manual_override ? (
                          <span className="px-2 py-1 bg-warning-soft text-warning-deep border border-warning/40 rounded-full text-[10px] font-mono font-bold">
                            MANUAL OVERRIDE
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-cyan-soft text-ink border border-hairline rounded-full text-[10px] font-mono font-bold">
                            AI AUTO-PILOT
                          </span>
                        )}
                      </div>

                      {/* Live Load & Hardware Gauges */}
                      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                        <div className="bg-canvas p-3.5 rounded-md border border-hairline">
                          <span className="text-mute text-[10px] block uppercase">
                            PRB Load Demand
                          </span>
                          <span className="font-bold text-ink text-base">
                            {selectedTower.current_prb_load}%
                          </span>
                        </div>
                        <div className="bg-canvas p-3.5 rounded-md border border-hairline">
                          <span className="text-mute text-[10px] block uppercase">
                            PA Thermal Reading
                          </span>
                          <span className="font-bold text-ink text-base">
                            {selectedTower.pa_temperature_c} °C
                          </span>
                        </div>
                      </div>

                      {/* Power State Controls */}
                      <div className="bg-canvas p-4 rounded-md border border-hairline space-y-2">
                        <span className="text-mute text-[10px] font-mono uppercase block mb-1">
                          Operating Power State
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex-1 px-3 py-1.5 rounded-sm text-xs font-bold text-center ${getStateBadgeClass(selectedTower.current_state)}`}
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
                            className="flex-1 py-1 bg-canvas-elevated hover:bg-hairline text-ink border border-hairline rounded-sm transition-all"
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
                            className="flex-1 py-1 bg-canvas-elevated hover:bg-hairline text-ink border border-hairline rounded-sm transition-all"
                          >
                            Set ASM Sleep
                          </button>
                          {selectedTower.manual_override && (
                            <button
                              onClick={() =>
                                handleReleaseOverride(selectedTower.tower_id)
                              }
                              className="px-2 py-1 bg-canvas border border-hairline text-ink rounded-sm"
                              title="Release manual override back to AI Auto-Pilot"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Real-time Dynamic Line Chart */}
                      <div className="bg-canvas p-3 rounded-md border border-hairline">
                        <span className="text-[10px] font-mono text-mute uppercase block mb-2">
                          Real-Time PRB Load Stream
                        </span>
                        <div className="h-28 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={timeSeriesData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke={chartGridStroke}
                              />
                              <XAxis
                                dataKey="time"
                                stroke={chartTextStroke}
                                tick={{ fontSize: 9 }}
                              />
                              <YAxis
                                domain={[0, 100]}
                                stroke={chartTextStroke}
                                tick={{ fontSize: 9 }}
                              />
                              <Tooltip contentStyle={chartTooltipStyle} />
                              <Line
                                type="monotone"
                                dataKey="actual_prb"
                                stroke={theme === "dark" ? "#f4f4f5" : "#171717"}
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

                      <div className="bg-link-soft border border-hairline p-3.5 rounded-md text-xs text-body leading-relaxed">
                        💡 <strong className="text-ink">Action Rationale:</strong> Base station consumes {selectedTower.optimized_power_w}W (saving{" "}
                        {selectedTower.baseline_power_w - selectedTower.optimized_power_w}W baseline power).
                      </div>
                    </div>
                  ) : (
                    <div className="text-mute text-xs">
                      Select a sector node on the map to inspect telemetry.
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-hairline text-xs font-mono">
                  SLA Capacity Protection:{" "}
                  <span className="text-ink font-bold">
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
                <div className="lg:col-span-2 bg-canvas-elevated border border-hairline rounded-md p-5">
                  <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-3">
                    Continuous Baseline vs. AI Power Stream (Watts)
                  </h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timeSeriesData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={chartGridStroke}
                        />
                        <XAxis
                          dataKey="time"
                          stroke={chartTextStroke}
                          tick={{ fontSize: 10 }}
                        />
                        <YAxis stroke={chartTextStroke} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="baseline_w"
                          stackId="1"
                          stroke="#ee0000"
                          fill="#ee0000"
                          fillOpacity={0.2}
                          name="Baseline 100% Power (W)"
                        />
                        <Area
                          type="monotone"
                          dataKey="optimized_w"
                          stackId="2"
                          stroke="#0070f3"
                          fill="#0070f3"
                          fillOpacity={0.4}
                          name="AI Optimized Power (W)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 2: Operating State Distribution Pie Chart */}
                <div className="bg-canvas-elevated border border-hairline rounded-md p-5 flex flex-col items-center justify-center">
                  <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-3 self-start">
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
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Chart 3: Sector Power Comparison Bar Chart */}
              <div className="bg-canvas-elevated border border-hairline rounded-md p-5">
                <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-3">
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
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={chartGridStroke}
                      />
                      <XAxis
                        dataKey="id"
                        stroke={chartTextStroke}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis stroke={chartTextStroke} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Bar
                        dataKey="power"
                        fill="#0070f3"
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
              <div className="bg-canvas-elevated border border-hairline rounded-md p-5 space-y-6">
                <div>
                  <h2 className="text-sm font-bold text-ink uppercase tracking-wider mb-1">
                    What-If Control Parameters
                  </h2>
                  <p className="text-xs text-body">
                    Simulate stadium crowds, traffic surges, or custom safety
                    headroom settings live.
                  </p>
                </div>

                <div className="space-y-4 text-xs font-mono">
                  <div>
                    <label className="flex justify-between text-ink font-semibold mb-1">
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
                    <label className="flex justify-between text-ink font-semibold mb-1">
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
                    <label className="flex justify-between text-ink font-semibold mb-1">
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
                    setStaticPowerP0(STATIC_POWER_P0);
                  }}
                  className="w-full py-2 bg-canvas border border-hairline text-ink hover:bg-hairline rounded-md text-xs font-semibold transition-all"
                >
                  Reset Default Controls
                </button>
              </div>

              {/* Simulation Outcome Panel */}
              <div className="lg:col-span-2 bg-canvas-elevated border border-hairline rounded-md p-5 flex flex-col justify-between">
                <div>
                  <h2 className="text-sm font-bold text-ink uppercase tracking-wider mb-4">
                    Simulated Power & SLA Outcome
                  </h2>

                  {selectedTowerOpt && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="bg-canvas p-4 rounded-md border border-hairline">
                          <span className="text-mute text-[10px] uppercase block font-mono">
                            Simulated PRB Load
                          </span>
                          <span className="text-xl font-bold text-ink">
                            {(
                              selectedTowerOpt.predicted_prb * trafficMultiplier
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                        <div className="bg-canvas p-4 rounded-md border border-hairline">
                          <span className="text-mute text-[10px] uppercase block font-mono">
                            Allocated Capacity
                          </span>
                          <span className="text-xl font-bold text-link">
                            {(
                              selectedTowerOpt.predicted_prb *
                              trafficMultiplier *
                              (1 + safetyHeadroom / 100)
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                        <div className="bg-canvas p-4 rounded-md border border-hairline">
                          <span className="text-mute text-[10px] uppercase block font-mono">
                            Estimated Savings
                          </span>
                          <span className="text-xl font-bold text-link">
                            {(
                              selectedTowerOpt.baseline_power_w -
                              selectedTowerOpt.optimized_power_w
                            ).toFixed(1)}{" "}
                            W
                          </span>
                        </div>
                      </div>

                      <div className="bg-canvas p-4 rounded-md border border-hairline">
                        <h3 className="text-xs font-bold text-ink uppercase mb-2">
                          Simulation State Evaluation
                        </h3>
                        <p className="text-xs text-body leading-relaxed">
                          Under a{" "}
                          <strong className="text-ink">
                            {trafficMultiplier}x traffic surge
                          </strong>{" "}
                          with a{" "}
                          <strong className="text-ink">
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
            <div className="bg-canvas-elevated border border-hairline rounded-md p-6 space-y-6">
              <div>
                <h2 className="text-base font-bold text-ink mb-1">
                  3GPP Release 18 EARTH Base Station Hardware Specifications
                </h2>
                <p className="text-xs text-body font-mono">
                  Non-linear power equations applied across active sector
                  transceivers.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
                <div className="bg-canvas p-4 rounded-md border border-hairline">
                  <h3 className="font-bold text-ink mb-2">Macro Cell (3GPP)</h3>
                  <p className="text-body">P0 (Static Idle): {STATIC_POWER_P0} W</p>
                  <p className="text-body">Delta_p (Slope): {DELTA_P}</p>
                  <p className="text-body">Pmax (RF Output): {PMAX} W</p>
                  <p className="text-ink mt-2 font-bold">
                    Max Power: {STATIC_POWER_P0 + DELTA_P * PMAX} W
                  </p>
                </div>

                <div className="bg-canvas p-4 rounded-md border border-hairline">
                  <h3 className="font-bold text-violet mb-2">Micro-Sleep (ASM) Mode</h3>
                  <p className="text-body">Symbol gap amplifier gating</p>
                  <p className="text-body">Disables PA during zero traffic</p>
                  <p className="text-body">Transition Latency: 35 µs</p>
                  <p className="text-ink mt-2 font-bold">Power Reduction: ~40%</p>
                </div>

                <div className="bg-canvas p-4 rounded-md border border-hairline">
                  <h3 className="font-bold text-cyan mb-2">Deep Sleep Mode</h3>
                  <p className="text-body">Deactivates secondary carriers</p>
                  <p className="text-body">BBU static power reduction</p>
                  <p className="text-body">Transition Latency: 15 ms</p>
                  <p className="text-ink mt-2 font-bold">Power Reduction: ~80%</p>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* TAB 5: SYSTEM AUDIT TRAIL LOGS                                     */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === "logs" && (
            <div className="bg-canvas-elevated border border-hairline rounded-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-bold text-ink">
                  System Operations & Audit Trail Log
                </h2>
                <span className="text-xs font-mono text-mute">
                  {systemLogs.length} Events Captured
                </span>
              </div>

              <div className="space-y-2 font-mono text-xs max-h-[500px] overflow-y-auto pr-2">
                {systemLogs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-canvas p-3 rounded-md border border-hairline flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-mute">{log.timestamp}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          log.level === "ACTION"
                            ? "bg-link-soft text-link-deep"
                            : log.level === "WARN"
                              ? "bg-warning-soft text-warning-deep"
                              : log.level === "CRITICAL"
                                ? "bg-error/10 text-error-deep"
                                : "bg-canvas border border-hairline text-body"
                        }`}
                      >
                        {log.level}
                      </span>
                      <span className="text-ink">{log.message}</span>
                    </div>
                    {log.tower_id > 0 && (
                      <span className="text-mute font-bold">
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
