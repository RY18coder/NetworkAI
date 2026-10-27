export type TowerState = "Full Power" | "Micro-Sleep (ASM)" | "Deep Sleep";

export interface Tower {
  tower_id: number;
  grid_id: number;
  latitude: number;
  longitude: number;
  current_prb_load: number;
  current_state: TowerState;
  radio_type: string;
  baseline_power_w: number;
  optimized_power_w: number;
  pa_temperature_c: number;
  manual_override: boolean;
}

/** Subset of the tower record returned by the Node.js telemetry gateway. */
export type TowerApiRecord = Pick<
  Tower,
  "tower_id" | "grid_id" | "latitude" | "longitude" | "current_prb_load" | "current_state"
>;

export interface OptimizationDetails {
  tower_id: number;
  timestamp: string;
  predicted_prb: number;
  qos_allocated_prb: number;
  baseline_power_w: number;
  optimized_power_w: number;
  energy_saved_w: number;
  recommended_state: TowerState;
  sla_violation_risk: boolean;
}

export interface SystemSummary {
  total_towers: number;
  active_towers: number;
  average_prb_load: number;
  total_baseline_kwh: number;
  total_optimized_kwh: number;
  total_energy_saved_kwh: number;
  savings_percentage: number;
}

export interface TimeSeriesPoint {
  time: string;
  actual_prb: number;
  predicted_prb: number;
  baseline_w: number;
  optimized_w: number;
}

export interface SystemLog {
  id: string;
  timestamp: string;
  level: "INFO" | "WARN" | "ACTION" | "CRITICAL";
  tower_id: number;
  message: string;
}
