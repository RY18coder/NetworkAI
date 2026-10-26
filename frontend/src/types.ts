export interface Tower {
  tower_id: number;
  grid_id: number;
  latitude: number;
  longitude: number;
  current_prb_load: number;
  current_state: "Full Power" | "Micro-Sleep (ASM)" | "Deep Sleep";
}

export interface OptimizationDetails {
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

export interface SystemSummary {
  total_towers: number;
  active_towers: number;
  average_prb_load: number;
  total_baseline_kwh: number;
  total_optimized_kwh: number;
  total_energy_saved_kwh: number;
  savings_percentage: number;
}
