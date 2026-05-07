// Lightweight A* on the occupancy grid with slope/reservation awareness.
import type { GridCell } from "./types";
import { GRID_SIZE, SLOPE_LIMIT, inBounds } from "./grid";

interface Node {
  x: number; y: number;
  g: number; f: number;
  parent: Node | null;
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

function key(x: number, y: number) { return y * GRID_SIZE + x; }

export function astar(
  grid: GridCell[][],
  start: [number, number],
  goal: [number, number],
  opts: { ignoreReserved?: boolean } = {}
): [number, number][] | null {
  const [sx, sy] = start, [gx, gy] = goal;
  if (!inBounds(sx, sy) || !inBounds(gx, gy)) return null;

  const open = new Map<number, Node>();
  const closed = new Set<number>();
  const startNode: Node = { x: sx, y: sy, g: 0, f: heur(sx, sy, gx, gy), parent: null };
  open.set(key(sx, sy), startNode);

  let iter = 0;
  while (open.size > 0 && iter++ < 10000) {
    let best: Node | null = null;
    let bestKey = -1;
    for (const [k, n] of open) {
      if (!best || n.f < best.f) { best = n; bestKey = k; }
    }
    if (!best) break;
    open.delete(bestKey);
    closed.add(bestKey);

    if (best.x === gx && best.y === gy) {
      const path: [number, number][] = [];
      let cur: Node | null = best;
      while (cur) { path.push([cur.x, cur.y]); cur = cur.parent; }
      return path.reverse();
    }

    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = best.x + dx, ny = best.y + dy;
      if (!inBounds(nx, ny)) continue;
      const k = key(nx, ny);
      if (closed.has(k)) continue;
      const cell = grid[ny][nx];
      if (cell.slope > SLOPE_LIMIT) continue;
      if (!opts.ignoreReserved && cell.reserved && !(nx === gx && ny === gy)) continue;

      const slopePenalty = cell.slope * 10;
      // Strict avoidance of existing piles: impassable if height > 0.5m
      if (cell.height > 0.5 && !(nx === gx && ny === gy)) continue;
      
      const heightPenalty = cell.height * 10;
      const ng = best.g + cost + slopePenalty + heightPenalty;
      const existing = open.get(k);
      if (!existing || ng < existing.g) {
        open.set(k, { x: nx, y: ny, g: ng, f: ng + heur(nx, ny, gx, gy), parent: best });
      }
    }
  }
  return null;
}

function heur(x: number, y: number, gx: number, gy: number) {
  const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
  return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
}

// BFS reachability check (depth-limited)
export function bfsReachable(
  grid: GridCell[][],
  start: [number, number],
  goal: [number, number],
  maxDepth = 200
): boolean {
  const [sx, sy] = start, [gx, gy] = goal;
  const visited = new Set<number>();
  const q: [number, number, number][] = [[sx, sy, 0]];
  visited.add(key(sx, sy));
  while (q.length) {
    const [x, y, d] = q.shift()!;
    if (x === gx && y === gy) return true;
    if (d >= maxDepth) continue;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      const cell = grid[ny][nx];
      // Only reachable if it's mostly flat and NOT a dump pile (height <= 0.5)
      if (cell.slope > SLOPE_LIMIT || cell.height > 0.5) continue;
      visited.add(k);
      q.push([nx, ny, d + 1]);
    }
  }
  return false;
}
