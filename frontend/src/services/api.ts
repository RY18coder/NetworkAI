import type { Tower, OptimizationDetails, SystemSummary } from "../types";

const API_BASE_URL = "http://localhost:5000/api/v1";

export const fetchTowers = async (): Promise<Tower[]> => {
  const response = await fetch(`${API_BASE_URL}/towers`);
  if (!response.ok)
    throw new Error(
      "Failed to fetch cell tower telemetry from Node.js Gateway.",
    );
  return response.json();
};

export const fetchTowerOptimization = async (
  towerId: number,
): Promise<OptimizationDetails> => {
  const response = await fetch(`${API_BASE_URL}/optimize/${towerId}`);
  if (!response.ok)
    throw new Error(
      `Failed to fetch optimization telemetry for Tower #${towerId}`,
    );
  return response.json();
};

export const fetchSystemSummary = async (): Promise<SystemSummary> => {
  const response = await fetch(`${API_BASE_URL}/analytics/summary`);
  if (!response.ok)
    throw new Error(
      "Failed to fetch network KPI summary from Node.js Gateway.",
    );
  return response.json();
};
