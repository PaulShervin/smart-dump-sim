// Lightweight A* on the occupancy grid with slope/reservation awareness.
import type { GridCell } from "./types";
import { GRID_SIZE, SLOPE_LIMIT, inBounds } from "./grid";

interface Node {
  x: number; y: number;
  g: number; f: number;
  parent: Node | null;
  dir: number;
}

const NEIGHBORS: [number, number, number, number][] = [
  [1, 0, 1, 2], [-1, 0, 1, 6], [0, 1, 1, 4], [0, -1, 1, 0],
  [1, 1, 1.4142, 3], [1, -1, 1.4142, 1], [-1, 1, 1.4142, 5], [-1, -1, 1.4142, 7],
];

function key(x: number, y: number) { return y * GRID_SIZE + x; }

export function astar(
  grid: GridCell[][],
  start: [number, number],
  goal: [number, number],
  opts: { ignoreReserved?: boolean, heightThreshold?: number, sizeClass?: "S" | "M" | "L", ignoreAllHeight?: boolean } = {}
): [number, number][] | null {
  const [sx, sy] = start, [gx, gy] = goal;
  if (!inBounds(sx, sy) || !inBounds(gx, gy)) return null;

  const open = new Map<number, Node>();
  const closed = new Set<number>();
  const startNode: Node = { x: sx, y: sy, g: 0, f: heur(sx, sy, gx, gy), parent: null, dir: -1 };
  open.set(key(sx, sy), startNode);

  const turnCostTable = {
    S: [0, 0.5, 1.5, 4.0, 99],
    M: [0, 0.5, 2.0, 6.0, 99],
    L: [0, 1.0, 3.0, 99, 99]
  };

  const ht = opts.ignoreAllHeight ? Infinity : (opts.heightThreshold !== undefined ? opts.heightThreshold : 0.5);
  const size = opts.sizeClass || "M";

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

    for (const [dx, dy, moveCost, dir] of NEIGHBORS) {
      const nx = best.x + dx, ny = best.y + dy;
      if (!inBounds(nx, ny)) continue;
      const k = key(nx, ny);
      if (closed.has(k)) continue;
      const cell = grid[ny][nx];
      
      if (cell.slope > SLOPE_LIMIT) continue;
      if (!opts.ignoreReserved && cell.reserved && !(nx === gx && ny === gy)) continue;
      if (cell.height > ht && !(nx === gx && ny === gy)) continue;

      let turnCost = 0;
      if (best.dir !== -1) {
        let diff = Math.abs(dir - best.dir);
        if (diff > 4) diff = 8 - diff;
        turnCost = turnCostTable[size][diff] || 0;
        if (turnCost >= 99) continue;
      }

      const slopePenalty = cell.slope * 10;
      const heightPenalty = cell.height * 10;
      const ng = best.g + moveCost + slopePenalty + heightPenalty + turnCost;
      const existing = open.get(k);
      
      if (!existing || ng < existing.g) {
        open.set(k, { x: nx, y: ny, g: ng, f: ng + heur(nx, ny, gx, gy), parent: best, dir });
      }
    }
  }
  return null;
}

function heur(x: number, y: number, gx: number, gy: number) {
  const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
  return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
}

// BFS reachability check
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
      if (cell.slope > SLOPE_LIMIT || cell.height > 0.5) continue;
      visited.add(k);
      q.push([nx, ny, d + 1]);
    }
  }
  return false;
}

export function checkCorridorPreservation(grid: GridCell[][], entry: [number, number], proposedCell: [number, number]): boolean {
  const q: [number, number][] = [entry];
  const reachableBefore = new Set<number>();
  reachableBefore.add(key(entry[0], entry[1]));
  
  let head = 0;
  while(head < q.length) {
    const [x, y] = q[head++];
    for(const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const k = key(nx, ny);
      if (reachableBefore.has(k)) continue;
      if (grid[ny][nx].height > 0.5 || grid[ny][nx].slope > 0.85) continue;
      reachableBefore.add(k);
      q.push([nx, ny]);
    }
  }

  const reachableAfter = new Set<number>();
  reachableAfter.add(key(entry[0], entry[1]));
  const q2: [number, number][] = [entry];
  
  const blockedRegion = new Set<number>();
  for(let dy=-2; dy<=2; dy++) {
    for(let dx=-2; dx<=2; dx++) {
      blockedRegion.add(key(proposedCell[0]+dx, proposedCell[1]+dy));
    }
  }

  head = 0;
  while(head < q2.length) {
    const [x, y] = q2[head++];
    for(const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const k = key(nx, ny);
      if (reachableAfter.has(k)) continue;
      if (blockedRegion.has(k)) continue;
      if (grid[ny][nx].height > 0.5 || grid[ny][nx].slope > 0.85) continue;
      reachableAfter.add(k);
      q2.push([nx, ny]);
    }
  }

  // Are any previously reachable cells now unreachable?
  for(const k of reachableBefore) {
    if (!blockedRegion.has(k) && !reachableAfter.has(k)) {
      return false; // Isolates part of polygon!
    }
  }
  return true; // Safe
}

export function smoothPath(path: [number, number][], radiusCells: number): [number, number][] {
  if (path.length < 3) return path;
  const smoothed: [number, number][] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const p1 = smoothed[smoothed.length - 1];
    const p2 = path[i];
    const p3 = path[i + 1];
    const dx1 = p1[0] - p2[0], dy1 = p1[1] - p2[1];
    const dx2 = p3[0] - p2[0], dy2 = p3[1] - p2[1];
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 === 0 || len2 === 0) continue;
    const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
    if (dot < -0.95) {
      smoothed.push(p2);
      continue;
    }
    const cutDist = Math.min(radiusCells, len1 * 0.5, len2 * 0.5);
    const cp1: [number, number] = [p2[0] + (dx1 / len1) * cutDist, p2[1] + (dy1 / len1) * cutDist];
    const cp2: [number, number] = [p2[0] + (dx2 / len2) * cutDist, p2[1] + (dy2 / len2) * cutDist];
    smoothed.push(cp1);
    for (let t = 0.25; t <= 0.75; t += 0.25) {
      const px = (1 - t) * (1 - t) * cp1[0] + 2 * (1 - t) * t * p2[0] + t * t * cp2[0];
      const py = (1 - t) * (1 - t) * cp1[1] + 2 * (1 - t) * t * p2[1] + t * t * cp2[1];
      smoothed.push([px, py]);
    }
    smoothed.push(cp2);
  }
  smoothed.push(path[path.length - 1]);
  return smoothed;
}
