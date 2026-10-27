const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable Cross-Origin Resource Sharing for React Frontend
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : true,
  }),
);
app.use(express.json());

// In-Memory Data Store loaded from Step 3 Colab output CSV
let optimizationRecords = [];

// ------------------------------------------------------------------
// 1. DATA INGESTION: Load ML & EARTH Optimization Output on Startup
// ------------------------------------------------------------------
const RESULTS_CSV_PATH = path.join(__dirname, "optimization_results.csv");

function loadOptimizationData() {
  return new Promise((resolve, reject) => {
    const results = [];
    if (!fs.existsSync(RESULTS_CSV_PATH)) {
      console.warn(
        `⚠️ Warning: Results file not found at ${RESULTS_CSV_PATH}. Make sure optimization_results.csv is placed in this folder.`,
      );
      return resolve([]);
    }

    fs.createReadStream(RESULTS_CSV_PATH)
      .pipe(csv())
      .on("data", (data) => {
        // Parse CSV types into strict JavaScript formats
        results.push({
          Square_ID: parseInt(data.Square_ID, 10),
          Hourly_Timestamp: data.Hourly_Timestamp,
          PRB_Utilization: parseFloat(data.PRB_Utilization),
          Predicted_PRB: parseFloat(data.Predicted_PRB),
          Tower_Lat: parseFloat(data.Tower_Lat || 28.6139),
          Tower_Lon: parseFloat(data.Tower_Lon || 77.209),
          QoS_Allocated_PRB: parseFloat(data.QoS_Allocated_PRB),
          Baseline_Power_W: parseFloat(data.Baseline_Power_W),
          Optimized_Power_W: parseFloat(data.Optimized_Power_W),
          Energy_Saved_W: parseFloat(data.Energy_Saved_W),
          Recommended_State: data.Recommended_State,
          SLA_Violation:
            data.SLA_Violation === "True" || data.SLA_Violation === "true",
        });
      })
      .on("end", () => {
        console.log(
          `✅ Loaded ${results.length.toLocaleString()} ML & EARTH optimization records into Node.js server.`,
        );
        resolve(results);
      })
      .on("error", (err) => reject(err));
  });
}

// ------------------------------------------------------------------
// 2. REST API ENDPOINTS
// ------------------------------------------------------------------

// Health Check Endpoint
app.get("/health", (req, res) => {
  res.json({
    service: "Node.js Telecom Energy Gateway",
    status: "online",
    records_loaded: optimizationRecords.length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/towers - Returns current spatial telemetry for cell towers
app.get("/api/v1/towers", (req, res) => {
  if (optimizationRecords.length === 0) {
    return res
      .status(500)
      .json({ error: "Telemetry data not loaded on Node server." });
  }

  // Pick the latest timestamp batch from Colab evaluation window
  const latestTimestamp =
    optimizationRecords[optimizationRecords.length - 1].Hourly_Timestamp;
  const latestData = optimizationRecords.filter(
    (r) => r.Hourly_Timestamp === latestTimestamp,
  );

  const towers = latestData.map((row) => ({
    tower_id: row.Square_ID,
    grid_id: row.Square_ID,
    latitude: row.Tower_Lat,
    longitude: row.Tower_Lon,
    current_prb_load: row.PRB_Utilization,
    current_state: row.Recommended_State,
    radio_type:
      row.Square_ID % 3 === 0 ? "5G NR (Massive MIMO)" : "4G LTE Advanced",
    baseline_power_w: 418.4,
    optimized_power_w:
      row.Recommended_State === "Deep Sleep"
        ? 50.0
        : row.Recommended_State === "Micro-Sleep (ASM)"
          ? 180.0
          : 418.4,
    pa_temperature_c: 42.0,
    manual_override: false,
  }));

  res.json(towers);
});

// GET /api/v1/optimize/:tower_id - Returns predictive power breakdown for a specific tower
app.get("/api/v1/optimize/:tower_id", (req, res) => {
  const towerId = parseInt(req.params.tower_id, 10);
  const towerRecords = optimizationRecords.filter(
    (r) => r.Square_ID === towerId,
  );

  if (towerRecords.length === 0) {
    return res.status(404).json({ error: `Tower ID ${towerId} not found.` });
  }

  const latest = towerRecords[towerRecords.length - 1];

  res.json({
    tower_id: latest.Square_ID,
    timestamp: latest.Hourly_Timestamp,
    predicted_prb: latest.Predicted_PRB,
    qos_allocated_prb: latest.QoS_Allocated_PRB,
    baseline_power_w: latest.Baseline_Power_W,
    optimized_power_w: latest.Optimized_Power_W,
    energy_saved_w: latest.Energy_Saved_W,
    recommended_state: latest.Recommended_State,
    sla_violation_risk: latest.SLA_Violation,
  });
});

// GET /api/v1/analytics/summary - Returns aggregate system energy savings and KPIs
app.get("/api/v1/analytics/summary", (req, res) => {
  if (optimizationRecords.length === 0) {
    return res.status(500).json({ error: "Telemetry data unavailable." });
  }

  const latestTimestamp =
    optimizationRecords[optimizationRecords.length - 1].Hourly_Timestamp;
  const latestBatch = optimizationRecords.filter(
    (r) => r.Hourly_Timestamp === latestTimestamp,
  );

  const totalTowers = latestBatch.length;
  const activeTowers = latestBatch.filter(
    (r) => r.PRB_Utilization > 15.0,
  ).length;
  const totalLoad = latestBatch.reduce((sum, r) => sum + r.PRB_Utilization, 0);
  const avgLoad = totalLoad / (totalTowers || 1);

  const totalBaselineW = latestBatch.reduce(
    (sum, r) => sum + r.Baseline_Power_W,
    0,
  );
  const totalOptW = latestBatch.reduce(
    (sum, r) => sum + r.Optimized_Power_W,
    0,
  );

  const baselineKwh = (totalBaselineW * 1) / 1000.0;
  const optKwh = (totalOptW * 1) / 1000.0;
  const savedKwh = baselineKwh - optKwh;
  const savingPct = baselineKwh > 0 ? (savedKwh / baselineKwh) * 100.0 : 0.0;

  res.json({
    total_towers: totalTowers,
    active_towers: activeTowers,
    average_prb_load: parseFloat(avgLoad.toFixed(2)),
    total_baseline_kwh: parseFloat(baselineKwh.toFixed(2)),
    total_optimized_kwh: parseFloat(optKwh.toFixed(2)),
    total_energy_saved_kwh: parseFloat(savedKwh.toFixed(2)),
    savings_percentage: parseFloat(savingPct.toFixed(2)),
  });
});

// ------------------------------------------------------------------
// 3. START SERVER (local process) / EXPORT APP (serverless & tests)
// ------------------------------------------------------------------
const startServer = async () => {
  optimizationRecords = await loadOptimizationData();

  app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(
      `🚀 Node.js Express Gateway running on http://localhost:${PORT}`,
    );
    console.log(
      `📊 Serving ${optimizationRecords.length.toLocaleString()} records to React App.`,
    );
    console.log(`==================================================\n`);
  });
};

if (require.main === module) {
  startServer().catch((err) => {
    console.error("❌ Failed to start Node.js server:", err);
  });
}

module.exports = app;
