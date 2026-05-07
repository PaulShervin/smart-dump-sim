// HUD overlay: metrics panel + truck roster + live charts + heatmap toggle.
import { useEffect, useRef, useState } from "react";
import type { Metrics, Truck, DumpEvent, FleetConfig } from "@/sim/types";
import { TRUCK_MODELS } from "@/sim/types";
import type { Zone } from "@/sim/voronoi";
import { REASSIGN_THRESHOLD } from "@/sim/voronoi";
import { DemoAvatar } from "./DemoAvatar";
import type { MeasurementState } from "@/hooks/useMeasurementStore";
import type { DumpYardState } from "@/hooks/useDumpYardStore";

interface Props {
  truckCount: number;
  onTruckCountChange: (count: number) => void;
  simSpeed: number;
  onSimSpeedChange: (speed: number) => void;
  metrics: Metrics;
  trucks: Truck[];
  events: DumpEvent[];
  showHeatmap: boolean;
  onToggleHeatmap: () => void;
  showEmptyGrid?: boolean;
  onToggleEmptyGrid?: () => void;
  cameraView: "ADMIN" | "TOP" | "SIDE" | "VEHICLE" | "FLEET";
  onCameraViewChange: (view: "ADMIN" | "TOP" | "SIDE" | "VEHICLE" | "FLEET") => void;
  selectedMaterial: string;
  onSelectedMaterialChange: (m: string) => void;
  packingStrategy: "LEGACY" | "MIXED_FLEET";
  onPackingStrategyChange: (s: "LEGACY" | "MIXED_FLEET") => void;
  fleetConfig: FleetConfig;
  onFleetConfigChange: (fc: FleetConfig) => void;
  isNight: boolean;
  onToggleNight: () => void;
  gridRef?: React.MutableRefObject<any>;
  isDemoMode?: boolean;
  onToggleDemoMode?: () => void;
  measurement?: {
    state: MeasurementState;
    startSelection: () => void;
    analyse: () => void;
    reset: () => void;
    clearHistory: () => void;
  };
  dumpYard?: {
    state: DumpYardState;
    startDrawing: () => void;
    undoLastVertex: () => void;
    finishPolygon: () => void;
    resetYard: () => void;
  };
  simControl?: {
    isRunning: boolean;
    startSim: () => void;
    pauseSim: () => void;
    resumeSim: () => void;
  };
}

export function HudOverlay({ truckCount, onTruckCountChange, simSpeed, onSimSpeedChange, metrics, trucks, events, showHeatmap, onToggleHeatmap, showEmptyGrid, onToggleEmptyGrid, cameraView, onCameraViewChange, selectedMaterial, onSelectedMaterialChange, packingStrategy, onPackingStrategyChange, isNight, onToggleNight, gridRef, isDemoMode, onToggleDemoMode, measurement, fleetConfig, onFleetConfigChange, dumpYard, simControl }: Props) {
  const [showFleetPanel, setShowFleetPanel] = useState(false);
  const totalTrucks = Object.values(fleetConfig).reduce((s, n) => s + n, 0);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
      {/* Top bar */}
      <header className="pointer-events-auto flex items-center justify-between px-6 py-3 hud-panel border-b">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" style={{ boxShadow: "0 0 12px hsl(var(--primary))" }} />
            <h1 className="text-sm font-bold tracking-[0.3em] text-primary hud-glow">OREPACK</h1>
          </div>
          <span className="text-[10px] text-muted-foreground tracking-widest">
            AUTONOMOUS DUMP YARD · DIGITAL TWIN v1.0
          </span>

          {/* ── START / PAUSE / RESUME ── */}
          {simControl && (
            <div className="flex items-center gap-2 ml-2">
              {!simControl.isRunning ? (
                <button
                  onClick={simControl.startSim}
                  className="px-5 py-2 border-2 border-emerald-500 text-emerald-400 tracking-[0.3em] transition font-black text-sm hover:bg-emerald-500/20 flex items-center gap-2"
                  style={{ boxShadow: '0 0 20px rgba(16,185,129,0.25), inset 0 0 15px rgba(16,185,129,0.08)' }}
                >
                  <span className="text-lg">▶</span> START
                </button>
              ) : (
                <button
                  onClick={simControl.pauseSim}
                  className="px-5 py-2 border-2 border-amber-500 text-amber-400 tracking-[0.3em] transition font-black text-sm hover:bg-amber-500/20 flex items-center gap-2"
                  style={{ boxShadow: '0 0 20px rgba(245,158,11,0.25), inset 0 0 15px rgba(245,158,11,0.08)' }}
                >
                  <span className="text-lg">⏸</span> PAUSE
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          <div className="flex flex-col gap-1 mr-4">
            <label className="text-muted-foreground tracking-widest flex justify-between">
              <span>SIM SPEED:</span>
              <span className="text-primary">{simSpeed}x</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={simSpeed}
              onChange={(e) => onSimSpeedChange(parseInt(e.target.value))}
              className="w-24 accent-primary cursor-pointer"
            />
          </div>
          <div className="flex flex-col gap-1 mr-4">
            <label className="text-muted-foreground tracking-widest flex justify-between">
              <span>FLEET SIZE:</span>
              <span className="text-primary">{truckCount}</span>
            </label>
            <input
              type="range"
              min="1"
              max="15"
              value={truckCount}
              onChange={(e) => onTruckCountChange(parseInt(e.target.value))}
              className="w-24 accent-primary cursor-pointer"
            />
          </div>
          <div className="flex flex-col gap-1 mr-4">
            <label className="text-muted-foreground tracking-widest flex justify-between">
              <span>MATERIAL:</span>
            </label>
            <select
              value={selectedMaterial}
              onChange={(e) => onSelectedMaterialChange(e.target.value)}
              className="bg-background border border-border text-primary text-[10px] tracking-widest outline-none py-1 px-2 cursor-pointer"
            >
              <option value="IRON_ORE">IRON ORE</option>
              <option value="MIXED">MIXED</option>
              <option value="COAL">COAL</option>
              <option value="LIMESTONE">LIMESTONE</option>
              <option value="OVERBURDEN">OVERBURDEN</option>
            </select>
          </div>
          {onToggleEmptyGrid && (
            <button
              onClick={onToggleEmptyGrid}
              className={`px-3 py-1.5 border tracking-widest transition ${
                showEmptyGrid ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              DEBUG GRID {showEmptyGrid ? "ON" : "OFF"}
            </button>
          )}
          
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground tracking-widest uppercase">CAMERA:</span>
            <select
              value={cameraView}
              onChange={(e) => onCameraViewChange(e.target.value as any)}
              className="bg-transparent text-primary text-[10px] tracking-widest outline-none border-b border-primary/30 pb-0.5 cursor-pointer uppercase"
            >
              <option className="bg-background" value="ADMIN">ADMIN</option>
              <option className="bg-background" value="TOP">TOP</option>
              <option className="bg-background" value="SIDE">SIDE</option>
              <option className="bg-background" value="VEHICLE">VEHICLE</option>
              <option className="bg-background" value="FLEET">FLEET MONITORS</option>
            </select>
          </div>

          {onToggleDemoMode && (
            <button
              onClick={onToggleDemoMode}
              className={`px-3 py-1.5 border tracking-widest transition ${
                isDemoMode ? "bg-red-900/50 text-red-400 border-red-500/50" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              DEMO: {isDemoMode ? "1-TRUCK (4 DUMPS)" : "OFF"}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => {
                const nextStrategy = packingStrategy === "LEGACY" ? "MIXED_FLEET" : "LEGACY";
                onPackingStrategyChange(nextStrategy);
              }}
              className={`px-3 py-1.5 border tracking-widest transition font-bold ${
                packingStrategy === "MIXED_FLEET" ? "bg-emerald-600 text-white border-emerald-500" : "bg-slate-800 text-slate-400 border-slate-700"
              }`}
            >
              STRATEGY: {packingStrategy === "MIXED_FLEET" ? "MIXED-FLEET" : "LEGACY"} {packingStrategy === "MIXED_FLEET" ? "(ANCHOR-BACKFILL)" : "(HEX-GRID)"}
            </button>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowFleetPanel(!showFleetPanel)}
              className={`px-3 py-1.5 border tracking-widest transition font-bold flex items-center gap-1.5 ${
                showFleetPanel ? "bg-primary text-primary-foreground border-primary" : "border-primary/50 text-primary hover:bg-primary/10"
              }`}
            >
              FLEET CONFIG ({totalTrucks}) ▾
            </button>
            {showFleetPanel && (
              <div className="absolute right-0 top-full mt-1 w-80 hud-panel border border-primary/30 bg-[#0a0a0f]/98 backdrop-blur-xl p-4 z-50 shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
                <div className="text-[10px] tracking-[0.3em] text-primary mb-4 font-bold flex items-center justify-between">
                  <span>AUTONOMOUS FLEET MODELS</span>
                  <span className="text-muted-foreground tracking-wider font-normal">{totalTrucks} TRUCKS</span>
                </div>
                <div className="flex flex-col gap-2">
                  {TRUCK_MODELS.map((model) => {
                    const count = fleetConfig[model.id] || 0;
                    return (
                      <div
                        key={model.id}
                        className={`flex items-center justify-between px-3 py-2.5 border transition-all ${
                          count > 0
                            ? "border-primary/40 bg-primary/5"
                            : "border-border/50 bg-transparent opacity-60"
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-bold tracking-wider text-foreground">{model.label}</span>
                          <span className="text-[9px] text-muted-foreground tracking-widest">{model.payloadT}t payload · {model.size}</span>
                        </div>
                        <div className="flex items-center gap-0">
                          <button
                            onClick={() => {
                              if (count <= 0) return;
                              const next = { ...fleetConfig, [model.id]: count - 1 };
                              onFleetConfigChange(next);
                            }}
                            className="w-7 h-7 flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition text-sm font-bold"
                          >
                            −
                          </button>
                          <div className="w-8 h-7 flex items-center justify-center border-y border-border text-sm font-bold tabular-nums text-primary">
                            {count}
                          </div>
                          <button
                            onClick={() => {
                              if (totalTrucks >= 15) return;
                              const next = { ...fleetConfig, [model.id]: count + 1 };
                              onFleetConfigChange(next);
                            }}
                            className="w-7 h-7 flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition text-sm font-bold"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
                  <span className="text-[9px] text-muted-foreground tracking-widest">TOTAL CONFIGURED TRUCKS</span>
                  <span className="text-sm font-bold text-primary tabular-nums">{totalTrucks}</span>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => onCameraViewChange(cameraView === "FLEET" ? "ADMIN" : "FLEET")}
            className={`px-3 py-1.5 border tracking-widest transition font-bold ${
              cameraView === "FLEET" ? "bg-primary text-primary-foreground border-primary" : "border-primary/50 text-primary hover:bg-primary/10"
            }`}
          >
            ADMIN DASHBOARD
          </button>
          <button
            onClick={onToggleHeatmap}
            className={`px-3 py-1.5 border tracking-widest transition ${
              showHeatmap ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            HEATMAP {showHeatmap ? "ON" : "OFF"}
          </button>
          <button
            onClick={onToggleNight}
            className={`px-3 py-1.5 border tracking-widest transition ${
              isNight ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            TIME: {isNight ? "NIGHT" : "DAY"}
          </button>
          {measurement && (
            <button
              onClick={() => measurement.state.step === "idle" ? measurement.startSelection() : measurement.reset()}
              className={`px-3 py-1.5 border tracking-widest transition ${
                measurement.state.step !== "idle" ? "bg-accent text-accent-foreground border-accent" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              MEASURE {measurement.state.step !== "idle" ? "ON" : "OFF"}
            </button>
          )}

          {/* Dynamic Dump Yard Controls */}
          {dumpYard && (
            <>
              {dumpYard.state.mode === "idle" && (
                <button
                  onClick={dumpYard.startDrawing}
                  className="px-3 py-1.5 border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 tracking-widest transition font-bold flex items-center gap-1.5"
                >
                  <span className="text-base">✏️</span> DRAW DUMP YARD
                </button>
              )}
              {dumpYard.state.mode === "drawing" && (
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-amber-400 tracking-widest animate-pulse">DRAWING ({dumpYard.state.polygon.length} pts)</span>
                  {dumpYard.state.polygon.length > 0 && (
                    <button
                      onClick={dumpYard.undoLastVertex}
                      className="px-2 py-1 border border-amber-500/40 text-amber-400 text-[9px] tracking-widest hover:bg-amber-500/10 transition"
                    >
                      UNDO
                    </button>
                  )}
                  {dumpYard.state.polygon.length >= 3 && (
                    <button
                      onClick={dumpYard.finishPolygon}
                      className="px-2 py-1 border border-emerald-500 text-emerald-400 text-[9px] tracking-widest hover:bg-emerald-500/10 transition font-bold"
                    >
                      FINISH POLYGON
                    </button>
                  )}
                </div>
              )}
              {dumpYard.state.mode === "placing_entry" && (
                <span className="px-3 py-1.5 border border-cyan-500 text-cyan-400 tracking-widest text-[9px] animate-pulse font-bold">
                  ⬇️ CLICK TERRAIN TO SET ENTRY POINT
                </span>
              )}
              {dumpYard.state.mode === "active" && (
                <div className="flex items-center gap-1">
                  <span className="px-3 py-1.5 border border-emerald-500/50 text-emerald-400 tracking-widest text-[9px] font-bold">
                    ✅ YARD ACTIVE ({dumpYard.state.insideCells.size} cells)
                  </span>
                  <button
                    onClick={dumpYard.resetYard}
                    className="px-2 py-1 border border-red-500/40 text-red-400 text-[9px] tracking-widest hover:bg-red-500/10 transition"
                  >
                    RESET
                  </button>
                </div>
              )}
            </>
          )}

          <div className={`px-3 py-1.5 border tracking-widest ${
            simControl?.isRunning 
              ? 'border-emerald-500/50 text-muted-foreground' 
              : 'border-amber-500/50 text-muted-foreground'
          }`}>
            STATUS: {simControl?.isRunning 
              ? <span className="text-emerald-400">RUNNING</span> 
              : <span className="text-amber-400">PAUSED</span>
            }
          </div>
        </div>
      </header>

      {cameraView !== "FLEET" && (
        <>
          <div className="flex-1 flex justify-between p-4 gap-4 overflow-hidden">
            {/* Left: Metrics + Charts */}
            <div className="pointer-events-auto flex flex-col gap-3 w-72 overflow-y-auto">
              <MetricsPanel metrics={metrics} />
              <ChartCard title="PACKING DENSITY" value={metrics.packingDensity} max={1} unit="%" series="density" tick={metrics.totalDumps} />
              <ChartCard title="THROUGHPUT (60s)" value={metrics.throughput} max={20} unit="dumps" series="throughput" tick={metrics.totalDumps} />
              <ChartCard title="AVG CYCLE TIME" value={metrics.avgCycleMs / 1000} max={60} unit="s" series="cycle" tick={metrics.totalDumps} />
            </div>

            {/* Right: Truck roster */}
            <div className="pointer-events-auto flex flex-col gap-3 w-72">
              <TruckRoster trucks={trucks} followTruck={cameraView === "VEHICLE" && trucks.length > 0 ? trucks[0].id : null} onFollow={() => onCameraViewChange("VEHICLE")} />
              <EventLog events={events} />
            </div>
          </div>

          {/* Bottom: Legend */}
          <footer className="pointer-events-auto flex items-center justify-center gap-6 px-6 py-2 hud-panel border-t text-[10px] tracking-widest text-muted-foreground">

        <Legend color="#22d3ee" label="MOVING" />
        <Legend color="#facc15" label="ARRIVED" />
        <Legend color="#f97316" label="DUMPING" />
        <Legend color="#a78bfa" label="RETURNING" />
        <span className="text-muted-foreground">·</span>
        <Legend color="#fbb414" label="ANCHOR TRUCK" />
        <Legend color="#06b6d4" label="BACKFILL TRUCK" />
        <span className="text-muted-foreground">·</span>
        <span>SLOPE LIMIT: 0.6</span>
        <span>·</span>
        <span>GRID: 48×48 @ 2m</span>
      </footer>
      </>
      )}

      {/* Active Truck Telemetry Card */}
      {cameraView === "VEHICLE" && trucks.length > 0 && (
        <>
          <LidarRadar truck={trucks[0]} gridRef={gridRef} />
          <LiveTelemetryCard truck={trucks[0]} />
        </>
      )}

      {/* Demo Mode Avatar Guide */}
      <DemoAvatar trucks={trucks} isDemoMode={!!isDemoMode} />

      {/* Measurement Status Overlay */}
      {measurement && measurement.state.step !== "idle" && (
        <div className="pointer-events-auto absolute bottom-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
          <div className="hud-panel p-4 flex flex-col items-center gap-2 border-accent/50 bg-background/80 backdrop-blur-md">
            <div className="text-[10px] tracking-[0.2em] text-accent font-bold uppercase">
              {measurement.state.step === "selectingA" && "Select Point A (Click on Terrain)"}
              {measurement.state.step === "selectingB" && "Select Point B (Click on Terrain)"}
              {measurement.state.step === "ready" && "Points Ready"}
            </div>
            <div className="flex gap-4">
              <div className={`flex flex-col items-center p-2 border ${measurement.state.pointA ? "border-primary bg-primary/10" : "border-border opacity-50"}`}>
                <span className="text-[8px] text-muted-foreground uppercase">Point A</span>
                <span className="text-[10px] font-mono">{measurement.state.pointA ? `${measurement.state.pointA.x.toFixed(1)}, ${measurement.state.pointA.z.toFixed(1)}` : "---"}</span>
              </div>
              <div className={`flex flex-col items-center p-2 border ${measurement.state.pointB ? "border-primary bg-primary/10" : "border-border opacity-50"}`}>
                <span className="text-[8px] text-muted-foreground uppercase">Point B</span>
                <span className="text-[10px] font-mono">{measurement.state.pointB ? `${measurement.state.pointB.x.toFixed(1)}, ${measurement.state.pointB.z.toFixed(1)}` : "---"}</span>
              </div>
            </div>
            {measurement.state.step === "ready" && (
              <button
                onClick={measurement.analyse}
                className="w-full mt-2 bg-accent text-accent-foreground px-4 py-2 text-[10px] font-bold tracking-widest hover:bg-accent/80 transition"
              >
                COMPUTE DISTANCE
              </button>
            )}
            {measurement.state.result && (
              <div className="mt-2 text-xl font-bold text-accent hud-glow">
                {measurement.state.result.distance.toFixed(2)}m
              </div>
            )}
            <button
              onClick={measurement.reset}
              className="mt-2 text-[8px] text-muted-foreground hover:text-foreground uppercase tracking-widest"
            >
              Cancel / Reset
            </button>
          </div>
        </div>
      )}

      {/* Dump Yard Drawing Status Overlay */}
      {dumpYard && (dumpYard.state.mode === "drawing" || dumpYard.state.mode === "placing_entry") && (
        <div className="pointer-events-auto absolute bottom-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
          <div className="hud-panel p-5 flex flex-col items-center gap-3 border-amber-500/50 bg-background/80 backdrop-blur-md shadow-[0_0_30px_rgba(245,158,11,0.2)] min-w-[340px]">
            <div className="text-[11px] tracking-[0.2em] text-amber-400 font-bold uppercase flex items-center gap-2">
              {dumpYard.state.mode === "drawing" && (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" style={{ boxShadow: '0 0 10px #f59e0b' }} />
                  DRAWING DUMP YARD BOUNDARY
                </>
              )}
              {dumpYard.state.mode === "placing_entry" && (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse" style={{ boxShadow: '0 0 10px #22d3ee' }} />
                  <span className="text-cyan-400">SET ENTRY POINT</span>
                </>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground tracking-wider text-center max-w-xs">
              {dumpYard.state.mode === "drawing" &&
                "Click on the terrain to place polygon vertices. At least 3 points needed to define the dump yard area."
              }
              {dumpYard.state.mode === "placing_entry" &&
                "Click on the terrain to place the entry point. All trucks will start and return from this location."
              }
            </div>

            {/* Polygon vertices */}
            {dumpYard.state.polygon.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                {dumpYard.state.polygon.map((p, i) => (
                  <div key={i} className="px-2 py-1 border border-amber-500/30 bg-amber-500/5 text-[9px] font-mono text-amber-300">
                    V{i + 1}: ({p.x.toFixed(1)}, {p.z.toFixed(1)})
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 mt-2">
              {dumpYard.state.mode === "drawing" && dumpYard.state.polygon.length >= 3 && (
                <button
                  onClick={dumpYard.finishPolygon}
                  className="bg-emerald-600 text-white px-4 py-2 text-[10px] font-bold tracking-widest hover:bg-emerald-500 transition"
                >
                  ✓ FINISH POLYGON
                </button>
              )}
              <button
                onClick={dumpYard.resetYard}
                className="text-[9px] text-muted-foreground hover:text-red-400 uppercase tracking-widest border border-border px-3 py-2 hover:border-red-500/40 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
      <span>{label}</span>
    </div>
  );
}

function MetricsPanel({ metrics }: { metrics: Metrics }) {
  return (
    <div className="hud-panel p-4">
      <div className="text-[10px] tracking-widest text-primary mb-3">// SYSTEM METRICS</div>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="DUMPS" value={metrics.totalDumps.toString()} />
        <Metric label="ACTIVE" value={`${metrics.activeTrucks}`} />
        <Metric label="UTIL" value={`${(metrics.utilization * 100).toFixed(1)}%`} />
        <Metric label="AVG H" value={`${metrics.avgHeight.toFixed(2)}m`} />
      </div>
      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="text-muted-foreground tracking-widest">PACKING</span>
          <span className="text-primary">{(metrics.packingDensity * 100).toFixed(1)}%</span>
        </div>
        <div className="h-1.5 bg-secondary overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-primary-glow transition-all"
            style={{ width: `${Math.min(100, metrics.packingDensity * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] text-muted-foreground tracking-widest">{label}</div>
      <div className="text-xl font-bold text-foreground hud-glow tabular-nums">{value}</div>
    </div>
  );
}

const seriesStore: Record<string, number[]> = {};

function ChartCard({ title, value, max, unit, series, tick }: { title: string; value: number; max: number; unit: string; series: string; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!seriesStore[series]) seriesStore[series] = [];
    const arr = seriesStore[series];
    arr.push(value);
    if (arr.length > 60) arr.shift();
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const w = c.width = c.offsetWidth * devicePixelRatio;
    const h = c.height = c.offsetHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);
    // grid
    ctx.strokeStyle = "rgba(245,158,11,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // line
    if (arr.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2 * devicePixelRatio;
      arr.forEach((v, i) => {
        const x = (i / (arr.length - 1)) * w;
        const y = h - (Math.min(max, v) / max) * h * 0.92 - 4;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // fill
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = "rgba(245,158,11,0.15)";
      ctx.fill();
    }
  }, [tick, value, max, series]);
  return (
    <div className="hud-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] tracking-widest text-primary">{title}</span>
        <span className="text-xs tabular-nums text-foreground">{value.toFixed(1)} {unit}</span>
      </div>
      <canvas ref={ref} className="w-full h-16 block" />
    </div>
  );
}

function TruckRoster({ trucks, followTruck, onFollow }: { trucks: Truck[]; followTruck: string | null; onFollow: (id: string | null) => void }) {
  return (
    <div className="hud-panel p-4">
      <div className="text-[10px] tracking-widest text-primary mb-3">// FLEET ({trucks.length})</div>
      <div className="flex flex-col gap-1.5">
        {trucks.map((t) => {
          const active = followTruck === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onFollow(active ? null : t.id)}
              className={`flex items-center justify-between px-2 py-1.5 border text-[10px] transition ${
                active ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.role === "BACKFILL" ? "#06b6d4" : t.color, boxShadow: `0 0 6px ${t.role === "BACKFILL" ? "#06b6d4" : t.color}` }} />
                <span className="font-bold tracking-widest">{t.id}</span>
                <span className="text-muted-foreground">{t.size}</span>
                {t.role && (
                  <span className={`text-[8px] px-1 py-0.5 tracking-wider border font-bold ${t.role === "BACKFILL" ? "text-cyan-400 border-cyan-500/40 bg-cyan-500/10" : "text-yellow-400 border-yellow-500/40 bg-yellow-500/10"}`}>
                    {t.role}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground tabular-nums">{t.totalDumps}</span>
                <span className="text-primary tracking-widest w-16 text-right">{t.state}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventLog({ events }: { events: DumpEvent[] }) {
  return (
    <div className="hud-panel p-4 flex-1 overflow-hidden">
      <div className="text-[10px] tracking-widest text-primary mb-3">// EVENT LOG</div>
      <div className="flex flex-col gap-1 text-[10px] font-mono">
        {events.length === 0 && <span className="text-muted-foreground">Awaiting first dump...</span>}
        {events.slice().reverse().map((e) => (
          <div key={e.id} className="flex items-center gap-2 text-muted-foreground">
            <span className="text-primary">▸</span>
            <span className="text-foreground">{e.truckId}</span>
            <span>dumped @</span>
            <span className="text-accent">[{e.cell[0]},{e.cell[1]}]</span>
            <span className="ml-auto tabular-nums">{((performance.now() - e.t) / 1000).toFixed(0)}s</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveTelemetryCard({ truck }: { truck?: Truck }) {
  if (!truck) return null;
  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-[400px] hud-panel p-5 bg-[#0a0a0a]/95 backdrop-blur-md border border-primary/40 shadow-[0_0_30px_rgba(245,158,11,0.15)] pointer-events-auto transition-all">
      <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: truck.color, boxShadow: `0 0 10px ${truck.color}` }} />
          <h2 className="text-lg font-bold tracking-[0.2em] text-foreground">{truck.id} TELEMETRY</h2>
        </div>
        <div className="text-[10px] tracking-widest px-2 py-1 border border-primary text-primary bg-primary/10">
          {truck.state}
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-xs font-mono">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-muted-foreground tracking-widest">POSITION (XYZ)</span>
          <span className="text-primary">{truck.position[0].toFixed(1)}, {truck.position[1].toFixed(1)}, {truck.position[2].toFixed(1)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-muted-foreground tracking-widest">PAYLOAD STATUS</span>
          <span className="text-primary">{(truck.load * 100).toFixed(0)}% <span className="text-muted-foreground">[{truck.material}]</span></span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-muted-foreground tracking-widest">HEADING / TILT</span>
          <span className="text-foreground">{truck.heading.toFixed(2)} rad / {truck.bedTilt.toFixed(2)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-muted-foreground tracking-widest">SPEED</span>
          <span className="text-foreground">{truck.speed.toFixed(1)} m/s</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-muted-foreground tracking-widest">TARGET CELL</span>
          <span className="text-accent">{truck.target ? `[${truck.target[0]}, ${truck.target[1]}]` : "AWAITING"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-muted-foreground tracking-widest">CYCLE TIME</span>
          <span className="text-foreground tabular-nums">{((performance.now() - truck.cycleStart) / 1000).toFixed(1)}s</span>
        </div>
      </div>
      
      <div className="mt-4 pt-3 border-t border-border">
         <div className="text-[9px] text-muted-foreground tracking-widest mb-1 flex justify-between">
           <span>A* PATHFINDING WAYPOINTS</span>
           <span>{truck.path.length} NODES</span>
         </div>
         <div className="h-1.5 w-full bg-secondary">
           <div className="h-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, (truck.path.length / 40) * 100)}%` }} />
         </div>
      </div>
    </div>
  );
}

function LidarRadar({ truck, gridRef }: { truck?: Truck, gridRef?: React.MutableRefObject<any> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    if (!truck || !gridRef || !gridRef.current) return;
    let raf = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const loop = () => {
      const w = canvas.width = canvas.offsetWidth * devicePixelRatio;
      const h = canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.clearRect(0, 0, w, h);
      
      const cx = w / 2;
      const cy = h / 2;
      const radius = w / 2 - 10;
      
      // Radar rings
      ctx.strokeStyle = "rgba(34, 211, 238, 0.2)";
      ctx.lineWidth = 1 * devicePixelRatio;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (radius / 3) * i, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Crosshairs
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

      // Sweep line
      const time = performance.now() / 1000;
      const angle = (time * 3) % (Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      ctx.strokeStyle = "rgba(34, 211, 238, 0.8)";
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.stroke();
      
      // Sweep gradient
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, angle - 0.8, angle);
      ctx.closePath();
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, "rgba(34, 211, 238, 0.3)");
      grad.addColorStop(1, "rgba(34, 211, 238, 0.0)");
      ctx.fillStyle = grad;
      ctx.fill();

      // Obstacles
      const grid = gridRef.current;
      const truckX = truck.position[0];
      const truckZ = truck.position[2];
      const rangeM = 24; // 24 meters radius radar
      
      for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[0].length; x++) {
           const cell = grid[y][x];
           if (cell.height > 0.3) {
              const cellWx = (x - 24) * 2 + 1;
              const cellWz = (y - 24) * 2 + 1;
              const dx = cellWx - truckX;
              const dz = cellWz - truckZ;
              const dist = Math.hypot(dx, dz);
              if (dist < rangeM) {
                 const mapX = cx + (dx / rangeM) * radius;
                 const mapY = cy + (dz / rangeM) * radius;
                 ctx.beginPath();
                 ctx.arc(mapX, mapY, (1 + cell.height * 0.8) * devicePixelRatio, 0, Math.PI * 2);
                 ctx.fillStyle = `rgba(239, 68, 68, ${0.4 + (cell.height / 3) * 0.6})`;
                 ctx.fill();
              }
           }
        }
      }
      
      // Truck position and heading
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const hx = Math.sin(truck.heading);
      const hz = Math.cos(truck.heading);
      ctx.lineTo(cx + hx * 12 * devicePixelRatio, cy + hz * 12 * devicePixelRatio);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.stroke();

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [truck, gridRef]);

  if (!truck) return null;
  return (
    <div className="absolute bottom-16 left-6 w-56 h-56 hud-panel p-2 bg-[#0a0a0a]/95 backdrop-blur-md border border-primary/40 pointer-events-none overflow-hidden shadow-[0_0_20px_rgba(34,211,238,0.15)]">
      <div className="text-[9px] text-primary tracking-widest mb-1 absolute top-3 left-3 z-10 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
        LIDAR OBSTACLE DETECT
      </div>
      <canvas ref={canvasRef} className="w-full h-full rounded-full border border-primary/20 opacity-90 mt-2" />
    </div>
  );
}
