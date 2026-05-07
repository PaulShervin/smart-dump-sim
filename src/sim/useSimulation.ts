// Central simulation hook. Owns grid, trucks, metrics. Drives the FSM at
// fixed-step (~30Hz) independent of render frame rate.
import { useEffect, useRef, useState } from "react";
import type { GridCell, Truck, Metrics, DumpEvent, FleetConfig } from "@/sim/types";
import { TRUCK_MODELS } from "@/sim/types";
import {
  GRID_SIZE, CELL_M, MAX_PILE_HEIGHT, makeGrid, gridToWorld, worldToGrid, recomputeSlopesLocal,
} from "@/sim/grid";
import { astar } from "@/sim/pathfinding";
import {
  pickDumpCell, reserveFootprint, clearExpiredReservations, applyDump, processDirtySlopes, filledCellCount, resetFilledCellCount
} from "@/sim/dumpEngine";

const TRUCK_COLORS = ["#fbb414", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#eab308", "#ca8a04", "#a16207"]; // CAT Industrial Yellow
const MATERIALS: ("COAL" | "IRON_ORE" | "LIMESTONE" | "OVERBURDEN")[] = ["COAL", "IRON_ORE", "LIMESTONE", "OVERBURDEN", "IRON_ORE"];
const ENTRY_POINTS: [number, number][] = [
  [2, 2], // Default single entry/exit point for all trucks
];

export interface DumpYardConfig {
  entryGrid: [number, number];
  isInsideYard: (gx: number, gy: number) => boolean;
  isFinalized: boolean;
}

const DEFAULT_FLEET: FleetConfig = {
  CAT_777G: 1,
  CAT_785: 1,
  CAT_789D: 1,
  CAT_793F: 1,
  CAT_797F: 1,
  CAT_794AC: 0,
};

function makeTrucksFromFleet(fleet: FleetConfig, materialOverride: string, entryOverride?: [number, number]): Truck[] {
  const trucks: Truck[] = [];
  let idx = 0;
  for (const model of TRUCK_MODELS) {
    const count = fleet[model.id] || 0;
    for (let k = 0; k < count; k++) {
      const entry = entryOverride || ENTRY_POINTS[0];
      const [wx, wz] = gridToWorld(entry[0], entry[1]);
      const mat = materialOverride === "MIXED" ? MATERIALS[idx % MATERIALS.length] : (materialOverride as any);
      const sizeColors = { S: "#06b6d4", M: "#d946ef", L: "#84cc16" }; // Cyan, Magenta, Lime
      const color = sizeColors[model.size] || "#fbb414";
      trucks.push({
        id: `T-${(idx + 1).toString().padStart(2, "0")}`,
        state: "IDLE",
        position: [wx, 0, wz],
        heading: 0,
        speed: 0,
        load: 1,
        size: model.size,
        color: color,
        material: mat,
        path: [],
        pathIndex: 0,
        bedTilt: 0,
        wheelSpin: 0,
        dumpProgress: 0,
        cycleStart: performance.now(),
        lastCycleMs: 0,
        totalDumps: 0,
      });
      idx++;
    }
  }
  return trucks;
}

function totalFromFleet(fleet: FleetConfig): number {
  return Object.values(fleet).reduce((s, n) => s + n, 0);
}

export interface SimState {
  grid: GridCell[][];
  trucks: Truck[];
  metrics: Metrics;
  events: DumpEvent[];
  tick: number;
}

const TRUCK_SPEED_MPS = 6; // metres/sec

export type PackingStrategy = "LEGACY" | "MIXED_FLEET" | "HOMOGENEOUS";

export function useSimulation(initialTrucks = 5, dumpYardRef?: React.MutableRefObject<DumpYardConfig | null>) {
  const gridRef = useRef<GridCell[][]>(makeGrid());
  const [fleetConfig, setFleetConfigState] = useState<FleetConfig>(DEFAULT_FLEET);
  const fleetConfigRef = useRef<FleetConfig>(DEFAULT_FLEET);
  const trucksRef = useRef<Truck[]>(makeTrucksFromFleet(DEFAULT_FLEET, "IRON_ORE"));
  const [targetTruckCount, setTargetTruckCount] = useState(totalFromFleet(DEFAULT_FLEET));
  const [isDemoMode, setIsDemoModeState] = useState(false);
  const isDemoModeRef = useRef(false);
  const eventsRef = useRef<DumpEvent[]>([]);
  const eventIdRef = useRef(0);
  const cycleSamplesRef = useRef<number[]>([]);
  const dumpTimestampsRef = useRef<number[]>([]);
  const [simSpeed, setSimSpeedState] = useState(1);
  const simSpeedRef = useRef(1);

  const [selectedMaterial, setSelectedMaterialState] = useState<string>("IRON_ORE");
  const selectedMaterialRef = useRef<string>("IRON_ORE");

  const setSelectedMaterial = (m: string) => {
    selectedMaterialRef.current = m;
    setSelectedMaterialState(m);
    trucksRef.current.forEach((t, idx) => {
      t.material = m === "MIXED" ? MATERIALS[idx % MATERIALS.length] : (m as any);
    });
  };

  const [packingStrategy, setPackingStrategyState] = useState<PackingStrategy>("HOMOGENEOUS");
  const packingStrategyRef = useRef<PackingStrategy>("HOMOGENEOUS");
  
  const updateAutoStrategy = (fleet: FleetConfig) => {
    const activeModels = TRUCK_MODELS.filter(m => fleet[m.id] > 0);
    const uniqueSizes = new Set(activeModels.map(m => m.size));
    const nextStrategy: PackingStrategy = uniqueSizes.size > 1 ? "MIXED_FLEET" : "HOMOGENEOUS";
    
    packingStrategyRef.current = nextStrategy;
    setPackingStrategyState(nextStrategy);
  };

  const setFleetConfig = (fc: FleetConfig) => {
    fleetConfigRef.current = fc;
    setFleetConfigState(fc);
    const newTotal = totalFromFleet(fc);
    setTargetTruckCount(newTotal);
    // Rebuild trucks from fleet config
    trucksRef.current = makeTrucksFromFleet(fc, selectedMaterialRef.current);
    // Update strategy automatically
    updateAutoStrategy(fc);
    
    // Reset grid for fair comparison
    gridRef.current = makeGrid();
    eventsRef.current = [];
    tickRef.current = 0;
    cycleSamplesRef.current = [];
    dumpTimestampsRef.current = [];
    resetFilledCellCount(); // FIX T4: reset global counter
  };

  const setSimSpeed = (speed: number) => {
    simSpeedRef.current = speed;
    setSimSpeedState(speed);
  };

  const setIsDemoMode = (val: boolean) => {
    isDemoModeRef.current = val;
    setIsDemoModeState(val);
    gridRef.current = makeGrid(); // Wipe terrain
    eventsRef.current = [];
    tickRef.current = 0;
    cycleSamplesRef.current = [];
    dumpTimestampsRef.current = [];
    
    if (val) {
      setTargetTruckCount(1);
      const demoFleet = { CAT_789D: 1 };
      trucksRef.current = makeTrucksFromFleet(demoFleet, selectedMaterialRef.current);
      updateAutoStrategy(demoFleet);
    } else {
      const fc = fleetConfigRef.current;
      const n = totalFromFleet(fc);
      setTargetTruckCount(n);
      trucksRef.current = makeTrucksFromFleet(fc, selectedMaterialRef.current);
      updateAutoStrategy(fc);
    }
  };

  const [state, setState] = useState<SimState>(() => ({
    grid: gridRef.current,
    trucks: trucksRef.current,
    events: [],
    tick: 0,
    metrics: { totalDumps: 0, avgHeight: 0, utilization: 0, activeTrucks: 0, packingDensity: 0, throughput: 0, avgCycleMs: 0, peakToPeak: 0 },
  }));

  const lastTimeRef = useRef(performance.now());
  const tickRef = useRef(0);
  const runningRef = useRef(false);

  const [isRunning, setIsRunningState] = useState(false);

  const startSim = () => {
    runningRef.current = true;
    setIsRunningState(true);
  };

  const pauseSim = () => {
    runningRef.current = false;
    setIsRunningState(false);
  };

  const resumeSim = () => {
    runningRef.current = true;
    setIsRunningState(true);
  };

  useEffect(() => {
    // Fleet is now rebuilt entirely via setFleetConfig,
    // but the slider still works as a quick "add more of default model" shortcut.
    const currentLen = trucksRef.current.length;
    if (targetTruckCount !== currentLen) {
      // Rebuild from fleet config
      trucksRef.current = makeTrucksFromFleet(fleetConfigRef.current, selectedMaterialRef.current);
    }
  }, [targetTruckCount]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTimeRef.current) / 1000) * simSpeedRef.current;
      lastTimeRef.current = now;
      if (runningRef.current) step(dt, now);
      tickRef.current++;
      // Push reactive snapshot every ~6 frames to limit React work
      if (tickRef.current % 4 === 0) {
        setState({
          grid: gridRef.current,
          trucks: [...trucksRef.current],
          events: eventsRef.current.slice(-12),
          tick: tickRef.current,
          metrics: computeMetrics(now),
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastMetricsTimeRef = useRef(0);
  const prevMetricsRef = useRef<Metrics | null>(null);

  function computeMetrics(now: number): Metrics {
    if (now - lastMetricsTimeRef.current < 1000 && prevMetricsRef.current) {
      return prevMetricsRef.current;
    }
    lastMetricsTimeRef.current = now;

    const g = gridRef.current;
    const yardCfg = dumpYardRef?.current;
    
    let sumH = 0, filledInside = 0, totalInside = 0;
    
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const h = g[y][x].height;
        const inside = yardCfg?.isFinalized ? yardCfg.isInsideYard(x, y) : true;
        
        if (inside) {
          sumH += h;
          totalInside++;
          if (h > 1.2) filledInside++;
        }
      }
    }

    const avgHeight = totalInside > 0 ? sumH / totalInside : 0;
    const utilization = totalInside > 0 ? filledInside / totalInside : 0;
    // FIX T4: Using O(1) global counter for packing density
    const packingDensity = totalInside > 0 ? (filledCellCount / totalInside) * 100 : 0;
    
    const recent = dumpTimestampsRef.current.filter(t => now - t < 60000);
    dumpTimestampsRef.current = recent;
    const throughput = recent.length;
    const cs = cycleSamplesRef.current.slice(-20);
    const avgCycleMs = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0;
    
    // FIX 7: peakToPeak = avg nearest-neighbor distance between hasDump=true pile centres
    let peakToPeak = 0;
    const dumpCells: [number, number][] = [];
    const g2 = gridRef.current;
    for (let y = 0; y < GRID_SIZE; y++)
      for (let x = 0; x < GRID_SIZE; x++)
        if (g2[y][x].hasDump) dumpCells.push([x, y]);

    if (dumpCells.length > 1) {
      let sumNN = 0;
      for (const [x1, y1] of dumpCells) {
        let minD = Infinity;
        for (const [x2, y2] of dumpCells) {
          if (x1 === x2 && y1 === y2) continue;
          const d = Math.hypot((x1 - x2) * CELL_M, (y1 - y2) * CELL_M);
          if (d < minD) minD = d;
        }
        if (minD < Infinity) sumNN += minD;
      }
      peakToPeak = sumNN / dumpCells.length; // avg nearest-neighbour distance in metres
    }

    const res = {
      totalDumps: trucksRef.current.reduce((s, t) => s + t.totalDumps, 0),
      avgHeight, utilization, packingDensity, throughput, avgCycleMs,
      activeTrucks: trucksRef.current.filter(t => t.state !== "IDLE").length,
      peakToPeak,
    };
    prevMetricsRef.current = res;
    return res;
  }

  function step(dt: number, now: number) {
    clearExpiredReservations(gridRef.current, now);
    // FIX T2: Process dirty slopes
    processDirtySlopes(gridRef.current, 20);
    for (const truck of trucksRef.current) {
      stepTruck(truck, dt, now);
    }
  }

  function stepTruck(truck: Truck, dt: number, now: number) {
    const grid = gridRef.current;
    const [tgx, tgy] = worldToGrid(truck.position[0], truck.position[2]);

    if (truck.state === "IDLE") {
      // In demo mode, stop exactly after 4 dumps so the user can easily observe the packing.
      if (isDemoModeRef.current && truck.totalDumps >= 4) {
        return;
      }
      
      // Plan: pick a dump cell
      const yardCfg = dumpYardRef?.current;
      const entry: [number, number] = yardCfg?.isFinalized ? yardCfg.entryGrid : ENTRY_POINTS[0];
      const isInsideYard = yardCfg?.isFinalized ? yardCfg.isInsideYard : undefined;
      const result = pickDumpCell(grid, truck, now, entry, isDemoModeRef.current, packingStrategyRef.current, isInsideYard);
      if (!result) return;
      const target = result.cell;
      truck.role = result.role;

      // We pathfind directly to the target, which pickDumpCell already guaranteed is reachable.
      let path = astar(grid, [tgx, tgy], target);
      if (!path || path.length < 2) return;

      // Stop the truck a few steps before the exact target center 
      // to avoid it driving completely up a forming peak
      if (path.length > 3) {
        path = path.slice(0, path.length - 2);
      }

      reserveFootprint(grid, target, truck.heading, truck.size, now, 12000);
      truck.target = target;
      truck.path = path;
      truck.pathIndex = 1;
      truck.state = "MOVING";
      truck.cycleStart = now;
      return;
    }

    if (truck.state === "MOVING" || truck.state === "RETURNING") {
      // Follow path
      if (!truck.path.length || truck.pathIndex >= truck.path.length) {
        if (truck.state === "MOVING") {
          truck.state = "ARRIVED";
        } else {
          // Returned to entry: cycle complete
          const cycleMs = now - truck.cycleStart;
          truck.lastCycleMs = cycleMs;
          cycleSamplesRef.current.push(cycleMs);
          truck.state = "IDLE";
          truck.role = undefined;
          truck.load = 1;
        }
        return;
      }
      const [gx, gy] = truck.path[truck.pathIndex];
      const [wx, wz] = gridToWorld(gx, gy);
      const dx = wx - truck.position[0];
      const dz = wz - truck.position[2];
      const d = Math.hypot(dx, dz);
      const move = TRUCK_SPEED_MPS * dt;
      if (d <= move) {
        truck.position = [wx, terrainHeightAt(grid, gx, gy), wz];
        truck.pathIndex++;
      } else {
        const nx = truck.position[0] + (dx / d) * move;
        const nz = truck.position[2] + (dz / d) * move;
        const [ngx, ngy] = worldToGrid(nx, nz);
        truck.position = [nx, terrainHeightAt(grid, ngx, ngy), nz];
        truck.heading = Math.atan2(dx, dz);
      }
      truck.speed = TRUCK_SPEED_MPS;
      truck.wheelSpin += dt * 6;
      return;
    }

    if (truck.state === "ARRIVED") {
      truck.speed = 0;
      truck.state = "DUMPING";
      truck.dumpProgress = 0;
      // Spin around to dump backwards!
      if (truck.target) {
        const [twx, twz] = gridToWorld(truck.target[0], truck.target[1]);
        const dx = truck.position[0] - twx;
        const dz = truck.position[2] - twz;
        truck.heading = Math.atan2(dx, dz);
      }
      return;
    }

    if (truck.state === "DUMPING") {
      truck.dumpProgress += dt / 2.5; // ~2.5s dump
      truck.bedTilt = Math.min(1, truck.dumpProgress * 1.4);
      truck.load = Math.max(0, 1 - truck.dumpProgress);
      if (truck.dumpProgress >= 1 && truck.target) {
        // Apply material
        applyDump(grid, truck.target, truck, truck.material);
        // FIX T2: No synchronous recomputeSlopesLocal here; dirty system handles it.
        truck.totalDumps++;
        eventIdRef.current++;
        eventsRef.current.push({
          id: eventIdRef.current,
          truckId: truck.id,
          cell: truck.target,
          volume: 1.2,
          t: now,
        });
        dumpTimestampsRef.current.push(now);

        // Plan return
        const yardCfg2 = dumpYardRef?.current;
        const entry: [number, number] = yardCfg2?.isFinalized ? yardCfg2.entryGrid : ENTRY_POINTS[0];
        const [tgx2, tgy2] = worldToGrid(truck.position[0], truck.position[2]);
        const path = astar(grid, [tgx2, tgy2], entry, { ignoreReserved: true });
        truck.path = path && path.length > 1 ? path : [[tgx2, tgy2], entry];
        truck.pathIndex = 1;
        truck.state = "RETURNING";
        truck.bedTilt = 0;
        truck.dumpProgress = 0;
        
        // FIX T5: Confirm pile age tracking
        const cell = grid[truck.target[1]][truck.target[0]];
        cell.isConfirmedPile = true;
        cell.dumpCompletedAt = now;
        
        truck.target = undefined;
      }
    }
  }

  /** Reset simulation and move all trucks to a new entry point (called when dump yard is finalized) */
  function resetToEntryPoint(entry: [number, number]) {
    // Pause sim — user must click START to begin dumping
    runningRef.current = false;
    setIsRunningState(false);
    gridRef.current = makeGrid();
    eventsRef.current = [];
    tickRef.current = 0;
    cycleSamplesRef.current = [];
    dumpTimestampsRef.current = [];
    trucksRef.current = makeTrucksFromFleet(fleetConfigRef.current, selectedMaterialRef.current, entry);
  }

  return { 
    state, 
    gridRef, 
    trucksRef, 
    targetTruckCount, 
    setTargetTruckCount, 
    simSpeed, 
    setSimSpeed, 
    selectedMaterial, 
    setSelectedMaterial,
    packingStrategy,
    isDemoMode,
    setIsDemoMode,
    fleetConfig,
    setFleetConfig,
    resetToEntryPoint,
    isRunning,
    startSim,
    pauseSim,
    resumeSim,
  };
}

function terrainHeightAt(grid: GridCell[][], gx: number, gy: number) {
  if (gx < 0 || gy < 0 || gx >= GRID_SIZE || gy >= GRID_SIZE) return 0;
  return grid[gy][gx].height;
}

export { GRID_SIZE, CELL_M };
