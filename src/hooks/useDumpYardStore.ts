/**
 * @file useDumpYardStore.ts
 * @description React state store for dynamic dump yard polygon drawing + entry point placement.
 *
 * Uses a useReducer pattern (same as useMeasurementStore) to manage:
 *  - A polygon drawn by the user (world-space vertices)
 *  - An entry point placed by the user (where all trucks start/return)
 *  - A precomputed set of grid cells inside the polygon for fast lookup
 *  - The current interaction mode: "idle" | "drawing" | "placing_entry" | "active"
 */

import { useReducer, useCallback, useRef } from "react";
import { worldToGrid, gridToWorld, GRID_SIZE } from "@/sim/grid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DumpYardPoint {
  x: number; // world X
  z: number; // world Z
}

export type DumpYardMode = "idle" | "drawing" | "placing_entry" | "active";

export interface DumpYardState {
  mode: DumpYardMode;
  /** World-space polygon vertices (drawn by user on terrain) */
  polygon: DumpYardPoint[];
  /** World-space entry point (placed by user) */
  entryPoint: DumpYardPoint | null;
  /** Grid-space entry point [gx, gy] */
  entryGrid: [number, number];
  /** Cached set of grid cell keys (gy*GRID_SIZE + gx) inside the polygon */
  insideCells: Set<number>;
  /** Whether the yard is fully configured (polygon + entry point both set) */
  isFinalized: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: "START_DRAWING" }
  | { type: "ADD_VERTEX"; payload: DumpYardPoint }
  | { type: "UNDO_VERTEX" }
  | { type: "FINISH_POLYGON" }
  | { type: "START_PLACING_ENTRY" }
  | { type: "SET_ENTRY_POINT"; payload: DumpYardPoint }
  | { type: "RESET_YARD" };

// ---------------------------------------------------------------------------
// Point-in-Polygon (Ray-casting algorithm)
// ---------------------------------------------------------------------------

function pointInPolygon(px: number, pz: number, poly: DumpYardPoint[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Precompute which grid cells fall inside the drawn polygon */
function computeInsideCells(polygon: DumpYardPoint[]): Set<number> {
  const cells = new Set<number>();
  if (polygon.length < 3) return cells;
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const [wx, wz] = gridToWorld(gx, gy);
      if (pointInPolygon(wx, wz, polygon)) {
        cells.add(gy * GRID_SIZE + gx);
      }
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialState: DumpYardState = {
  mode: "idle",
  polygon: [],
  entryPoint: null,
  entryGrid: [2, 2],
  insideCells: new Set<number>(),
  isFinalized: false,
};

function reducer(state: DumpYardState, action: Action): DumpYardState {
  switch (action.type) {
    case "START_DRAWING":
      return {
        ...initialState,
        mode: "drawing",
      };

    case "ADD_VERTEX":
      if (state.mode !== "drawing") return state;
      return { ...state, polygon: [...state.polygon, action.payload] };

    case "UNDO_VERTEX":
      if (state.mode !== "drawing") return state;
      return { ...state, polygon: state.polygon.slice(0, -1) };

    case "FINISH_POLYGON": {
      if (state.mode !== "drawing" || state.polygon.length < 3) return state;
      const insideCells = computeInsideCells(state.polygon);
      return { ...state, mode: "placing_entry", insideCells };
    }

    case "START_PLACING_ENTRY":
      return { ...state, mode: "placing_entry" };

    case "SET_ENTRY_POINT": {
      const pt = action.payload;
      const [gx, gy] = worldToGrid(pt.x, pt.z);
      return {
        ...state,
        entryPoint: pt,
        entryGrid: [
          Math.max(0, Math.min(GRID_SIZE - 1, gx)),
          Math.max(0, Math.min(GRID_SIZE - 1, gy)),
        ],
        mode: "active",
        isFinalized: true,
      };
    }

    case "RESET_YARD":
      return { ...initialState };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Custom hook for dynamic dump yard polygon management.
 * Returns state + action dispatchers.
 */
export function useDumpYardStore() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Keep a ref so the simulation loop can read it synchronously
  const stateRef = useRef(state);
  stateRef.current = state;

  const startDrawing = useCallback(() => dispatch({ type: "START_DRAWING" }), []);
  const addVertex = useCallback((pt: DumpYardPoint) => dispatch({ type: "ADD_VERTEX", payload: pt }), []);
  const undoLastVertex = useCallback(() => dispatch({ type: "UNDO_VERTEX" }), []);
  const finishPolygon = useCallback(() => dispatch({ type: "FINISH_POLYGON" }), []);
  const startPlacingEntry = useCallback(() => dispatch({ type: "START_PLACING_ENTRY" }), []);
  const setEntryPoint = useCallback((pt: DumpYardPoint) => dispatch({ type: "SET_ENTRY_POINT", payload: pt }), []);
  const resetYard = useCallback(() => dispatch({ type: "RESET_YARD" }), []);

  /** Check if a grid cell is inside the drawn polygon. Returns true if no yard drawn (legacy). */
  const isInsideYard = useCallback((gx: number, gy: number): boolean => {
    const s = stateRef.current;
    if (!s.isFinalized) return true;
    return s.insideCells.has(gy * GRID_SIZE + gx);
  }, []);

  return {
    state,
    stateRef,
    startDrawing,
    addVertex,
    undoLastVertex,
    finishPolygon,
    startPlacingEntry,
    setEntryPoint,
    resetYard,
    isInsideYard,
  };
}
