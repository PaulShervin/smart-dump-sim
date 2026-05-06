// Digital twin domain types
export type MaterialType = "COAL" | "IRON_ORE" | "LIMESTONE" | "OVERBURDEN";

// Real Caterpillar haul truck models used in the mixed-fleet selector
export interface TruckModel {
  id: string;          // e.g. "CAT_777G"
  label: string;       // e.g. "Cat 777G"
  payloadT: number;    // tonnes
  size: "S" | "M" | "L"; // maps to dump footprint scaling
}

export const TRUCK_MODELS: TruckModel[] = [
  { id: "CAT_777G",  label: "Cat 777G",  payloadT: 100, size: "S" },
  { id: "CAT_785",   label: "Cat 785",   payloadT: 139, size: "S" },
  { id: "CAT_789D",  label: "Cat 789D",  payloadT: 181, size: "M" },
  { id: "CAT_793F",  label: "Cat 793F",  payloadT: 227, size: "M" },
  { id: "CAT_797F",  label: "Cat 797F",  payloadT: 363, size: "L" },
  { id: "CAT_794AC", label: "Cat 794 AC", payloadT: 290, size: "L" },
];

// Fleet composition: how many of each model
export type FleetConfig = Record<string, number>; // modelId → count

export interface GridCell {
  x: number;
  y: number;
  occupied: boolean;
  height: number;
  slope: number;
  accessibility: boolean;
  reserved: boolean;
  reservedUntil: number; // ms timestamp
  material?: MaterialType;
  hasDump?: boolean;
  isBackfill?: boolean; // true if this dump was placed as a backfill (gap-fill) operation
}

export type TruckState = "MOVING" | "ARRIVED" | "DUMPING" | "RETURNING" | "IDLE";

export interface Truck {
  id: string;
  state: TruckState;
  position: [number, number, number];
  heading: number; // radians
  speed: number;
  load: number; // 0..1
  size: "S" | "M" | "L";
  color: string;
  material: MaterialType;
  path: [number, number][]; // grid coords
  pathIndex: number;
  target?: [number, number]; // grid coord
  role?: "ANCHOR" | "BACKFILL"; // current dump role in MIXED_FLEET strategy
  bedTilt: number; // 0..1
  wheelSpin: number;
  dumpProgress: number; // 0..1 during DUMPING
  cycleStart: number;
  lastCycleMs: number;
  totalDumps: number;
}

export interface DumpEvent {
  id: number;
  truckId: string;
  cell: [number, number];
  volume: number;
  t: number;
}

export interface Metrics {
  totalDumps: number;
  avgHeight: number;
  utilization: number;
  activeTrucks: number;
  packingDensity: number;
  throughput: number; // dumps/min
  avgCycleMs: number;
}
