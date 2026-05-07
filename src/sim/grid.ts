// Grid-based terrain model. Cell resolution kept coarse (1 cell ≈ 2m) for
// real-time performance while preserving the spec's per-cell semantics.
import type { GridCell } from "./types";

export const GRID_SIZE = 48; // 48x48 cells
export const CELL_M = 2; // metres per cell
export const WORLD_SIZE = GRID_SIZE * CELL_M; // 96m (48 cells × 2m/cell)

export const SLOPE_LIMIT = 0.85;
export const MAX_PILE_HEIGHT = 10.0;

export function makeGrid(): GridCell[][] {
  const g: GridCell[][] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      // Procedural irregular terrain: mild rolling base
      const cx = x - GRID_SIZE / 2;
      const cy = y - GRID_SIZE / 2;
      const r = Math.sqrt(cx * cx + cy * cy) / (GRID_SIZE / 2);
      row.push({
        x, y,
        occupied: false,
        height: 0,
        slope: 0,
        accessibility: true,
        reserved: false,
        reservedUntil: 0,
        hasDump: false,
      });
    }
    g.push(row);
  }
  recomputeSlopes(g);
  return g;
}

export function recomputeSlopes(g: GridCell[][]) {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const c = g[y][x];
      const hL = g[y][Math.max(0, x - 1)].height;
      const hR = g[y][Math.min(GRID_SIZE - 1, x + 1)].height;
      const hD = g[Math.max(0, y - 1)][x].height;
      const hU = g[Math.min(GRID_SIZE - 1, y + 1)][x].height;
      const dx = (hR - hL) / (2 * CELL_M);
      const dy = (hU - hD) / (2 * CELL_M);
      c.slope = Math.sqrt(dx * dx + dy * dy);
      c.accessibility = c.slope <= SLOPE_LIMIT && !c.occupied;
    }
  }
}

export function recomputeSlopesLocal(g: GridCell[][], cx: number, cy: number, r = 4) {
  const x0 = Math.max(1, cx - r);
  const x1 = Math.min(GRID_SIZE - 2, cx + r);
  const y0 = Math.max(1, cy - r);
  const y1 = Math.min(GRID_SIZE - 2, cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = g[y][x];
      const hL = g[y][x - 1].height;
      const hR = g[y][x + 1].height;
      const hD = g[y - 1][x].height;
      const hU = g[y + 1][x].height;
      const dx = (hR - hL) / (2 * CELL_M);
      const dy = (hU - hD) / (2 * CELL_M);
      c.slope = Math.sqrt(dx * dx + dy * dy);
      c.accessibility = c.slope <= SLOPE_LIMIT && !c.occupied;
    }
  }
}

export function gridToWorld(gx: number, gy: number): [number, number] {
  return [(gx - GRID_SIZE / 2 + 0.5) * CELL_M, (gy - GRID_SIZE / 2 + 0.5) * CELL_M];
}

export function worldToGrid(wx: number, wz: number): [number, number] {
  return [
    Math.round(wx / CELL_M + GRID_SIZE / 2 - 0.5),
    Math.round(wz / CELL_M + GRID_SIZE / 2 - 0.5),
  ];
}

export function inBounds(x: number, y: number) {
  return x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE;
}
