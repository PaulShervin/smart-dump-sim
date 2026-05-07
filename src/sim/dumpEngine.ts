// Dump decision engine: scores candidate cells, picks from top decile,
// validates with BFS + slope, reserves footprint with time window.
import type { GridCell } from "./types";
import { GRID_SIZE, SLOPE_LIMIT, MAX_PILE_HEIGHT, gridToWorld, worldToGrid, recomputeSlopesLocal } from "./grid";
import { bfsReachable } from "./pathfinding";

const W1 = 1.6;   // low-height preference
const W2 = 0.8;   // proximity to truck
const W4 = 2.5;   // slope penalty
const W6 = 5.0;   // furthest from entry (back-to-front packing)

export interface DumpCellResult {
  cell: [number, number];
  role: "ANCHOR" | "BACKFILL";
}

export function pickDumpCell(
  grid: GridCell[][],
  truck: any, // Pass the whole truck object for size awareness
  now: number,
  entryPoint: [number, number] = [2, 2],
  isDemoMode: boolean = false,
  strategy: "LEGACY" | "MIXED_FLEET" = "LEGACY",
  isInsideYard?: (gx: number, gy: number) => boolean
): DumpCellResult | null {
  const truckGrid = worldToGrid(truck.position[0], truck.position[2]);
  // 1. Hexagonal/Staggered Grid: Enforcing exactly 3.03m gap between dumps
  // Dump diameter is ~4m. 4m + 3.03m gap = 7.03m center-to-center.
  // 7.03m / 2m per cell = 3.515 cells step.
  const stepCells = (4.0 + 3.03) / 2.0;
  const rowStepCells = stepCells * 0.866; // Hexagonal row spacing (sin 60)

  // 1. Single BFS pass to find all reachable cells from the truck (O(N) = fast)
  const reachable = new Set<number>();
  const q: [number, number][] = [truckGrid];
  reachable.add(truckGrid[1] * GRID_SIZE + truckGrid[0]);
  let head = 0;
  while (head < q.length) {
    const [cx, cy] = q[head++];
    // Add neighbors
    for (const [dx, dy] of [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
        const k = ny * GRID_SIZE + nx;
        // Only reachable if it's mostly flat (not a mountain)
        if (!reachable.has(k) && grid[ny][nx].slope <= SLOPE_LIMIT && grid[ny][nx].height <= 1.0) {
          reachable.add(k);
          q.push([nx, ny]);
        }
      }
    }
  }

  let candidates: { x: number; y: number; score: number }[] = [];

  const maxX = isDemoMode ? 22 : GRID_SIZE - 4;
  const minX = isDemoMode ? 8 : 4;
  const maxY = isDemoMode ? 18 : GRID_SIZE - 4;
  const minY = isDemoMode ? 8 : 4;

  if (strategy === "LEGACY") {
    // 1. Hexagonal/Staggered Grid: Enforcing exactly 3.03m gap between dumps
    // Dump diameter is ~4m. 4m + 3.03m gap = 7.03m center-to-center.
    // 7.03m / 2m per cell = 3.515 cells step.
    const stepCells = (4.0 + 3.03) / 2.0;
    const rowStepCells = stepCells * 0.866; // Hexagonal row spacing (sin 60)

    for (let yF = maxY; yF >= minY; yF -= rowStepCells) {
      // Offset every other row to create a honeycomb pattern
      const rowIdx = Math.round((maxY - yF) / rowStepCells);
      const rowOffset = (rowIdx % 2 === 0) ? 0 : (stepCells / 2);

      for (let xF = maxX - rowOffset; xF >= minX; xF -= stepCells) {
        const x = Math.round(xF);
        const y = Math.round(yF);
        
        if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;

        // Skip cells outside the user-drawn dump yard polygon
        if (isInsideYard && !isInsideYard(x, y)) continue;

        const c = grid[y][x];

        // Blocked if reserved
        if (c.reserved && c.reservedUntil > now) continue;

      // 2. "The Low Spot" Problem Fix:
      // 2. Do not target cells that already have a dump on them!
      if (c.height > 0.5) continue;

        // Safety check (must be flat enough)
        if (c.slope > SLOPE_LIMIT) continue;

        // Must be reachable by the truck
        if (!reachable.has(y * GRID_SIZE + x)) continue;

      // 3. Multi-objective Scoring
      const distFromEntry = Math.hypot(x - entryPoint[0], y - entryPoint[1]);
      let score = distFromEntry * 5.0; // Back-to-front sweeping priority

      // Minor penalty for being far from truck
      const distFromTruck = Math.hypot(x - truckGrid[0], y - truckGrid[1]);
      score -= distFromTruck * 0.8;

        candidates.push({ x, y, score });
      }
    }
  } else {
    // =====================================================================
    // MIXED-FLEET STAGGERED-ROW STRATEGY (Size-Based Role Assignment)
    // Implements: Big→Anchor, Small→Backfill, Row Complete → Next Row
    // =====================================================================
    //
    // ALGORITHM:
    //   1. Generate all rows (parallel to X-axis, furthest Y first)
    //   2. For each row, generate SLOTS at fixed spacing
    //   3. Label even-index slots as ANCHOR, odd-index as BACKFILL
    //   4. BIG TRUCKS (L/M) → assigned to ANCHOR slots first
    //      Pattern: [BIG] [GAP] [BIG] [GAP] [BIG]
    //   5. SMALL TRUCKS (S)  → assigned to BACKFILL slots only after
    //      ≥4 anchors are placed by big trucks in that row
    //      Pattern: [BIG] [SML] [BIG] [SML] [BIG]
    //   6. Row is COMPLETE when every slot (anchor+backfill) is filled
    //   7. Only then move to the next closer row
    //
    // Truck size determines dump spacing:
    //   D = r1 + r2 + safety_gap - overlap + margin
    //   S: 2.0+2.0+1.0-0.5+0.5 = 5.0 cells (10m anchor-to-anchor)
    //   M: 2.5+2.5+1.0-0.5+0.5 = 6.0 cells (12m anchor-to-anchor)  
    //   L: 3.0+3.0+1.0-0.5+0.5 = 7.0 cells (14m anchor-to-anchor)
    // We use a moderate default of 3 cells between slot centers 
    // (6m real), so anchors are 6 cells (12m) apart with backfill 
    // slots in the gaps.

    const SLOT_SPACING = 3;   // cells between slot centers (anchor-to-anchor = 6 cells)
    const ROW_SPACING  = 4;   // cells between rows (8m driving lane)

    // --- Generate rows from furthest (maxY) to nearest (minY) ---
    const rows: number[] = [];
    for (let yF = maxY; yF >= minY; yF -= ROW_SPACING) {
      rows.push(Math.round(yF));
    }

    // --- Iterate rows in order (furthest first) ---
    for (const rowY of rows) {
      if (rowY < 0 || rowY >= GRID_SIZE) continue;

      // Row stagger: offset alternate rows by half a slot for interlocking
      const rowIdx = rows.indexOf(rowY);
      const staggerOffset = (rowIdx % 2 === 0) ? 0 : Math.floor(SLOT_SPACING / 2);

      // --- Generate all slot positions for this row ---
      const allSlots: { x: number; y: number; isAnchor: boolean }[] = [];
      let slotIndex = 0;
      for (let xF = minX + staggerOffset; xF <= maxX; xF += SLOT_SPACING) {
        const x = Math.round(xF);
        if (x < 0 || x >= GRID_SIZE) continue;
        // Skip slots outside the user-drawn dump yard polygon
        if (isInsideYard && !isInsideYard(x, rowY)) continue;
        allSlots.push({
          x,
          y: rowY,
          isAnchor: slotIndex % 2 === 0, // even = ANCHOR, odd = BACKFILL
        });
        slotIndex++;
      }

      if (allSlots.length === 0) continue;

      // --- Classify slot states ---
      const anchorSlots  = allSlots.filter(s => s.isAnchor);
      const backfillSlots = allSlots.filter(s => !s.isAnchor);

      // A slot is "filled" if terrain height > 0.5m at its position
      const isFilled = (s: { x: number; y: number }) => {
        return grid[s.y][s.x].height > 0.5;
      };

      const allAnchorsFilled = anchorSlots.every(isFilled);
      const allSlotsFilled   = allSlots.every(isFilled);

      // If this entire row is complete, skip to next row
      if (allSlotsFilled) continue;

      // --- Size-based role assignment ---
      // Big trucks (L/M) → ANCHOR role: lay structural foundation piles
      // Small trucks (S)  → BACKFILL role: fill gaps between anchors
      const truckSize = truck.size as "S" | "M" | "L";
      const isBigTruck = truckSize === "L" || truckSize === "M";
      const filledAnchorCount = anchorSlots.filter(isFilled).length;
      let availableSlots: { x: number; y: number; isAnchor: boolean }[];

      if (isBigTruck) {
        // --- BIG TRUCK (L/M): Anchor-first assignment ---
        const emptyAnchors = anchorSlots.filter(s => !isFilled(s));
        if (emptyAnchors.length > 0) {
          // Primary role: fill anchor slots to build the structural ridge
          availableSlots = emptyAnchors;
        } else {
          // All anchors done in this row → big truck can assist with backfill
          availableSlots = allSlots.filter(s => !isFilled(s));
        }
      } else {
        // --- SMALL TRUCK (S): Backfill-only assignment ---
        if (filledAnchorCount < 4) {
          // Not enough anchors placed yet → small truck WAITS (skip this row)
          // The big trucks need to lay the foundation first
          continue;
        }
        // Enough anchors are in place → small truck fills the gaps
        const emptyBackfills = backfillSlots.filter(s => !isFilled(s));
        if (emptyBackfills.length > 0) {
          availableSlots = emptyBackfills;
        } else {
          // All backfill done → help with any remaining slots in this row
          availableSlots = allSlots.filter(s => !isFilled(s));
        }
      }

      // --- Filter for reachability, slope, and reservation ---
      const validSlots = availableSlots.filter(s => {
        const c = grid[s.y][s.x];
        if (c.reserved && c.reservedUntil > now) return false;
        if (c.slope > SLOPE_LIMIT) return false;
        if (!reachable.has(s.y * GRID_SIZE + s.x)) return false;
        return true;
      });

      if (validSlots.length === 0) {
        // No valid slots in this row right now (maybe reserved by other trucks)
        // Still try this row — don't skip to next row
        continue;
      }

      // --- Pick the best slot: nearest to truck for fast assignment ---
      let bestSlot = validSlots[0];
      let bestDist = Infinity;
      for (const s of validSlots) {
        const d = Math.hypot(s.x - truckGrid[0], s.y - truckGrid[1]);
        if (d < bestDist) {
          bestDist = d;
          bestSlot = s;
        }
      }

      return { cell: [bestSlot.x, bestSlot.y], role: bestSlot.isAnchor ? "ANCHOR" as const : "BACKFILL" as const };
    }
  }

  if (candidates.length === 0) return null;

  // Sort candidates from best to worst
  candidates.sort((a, b) => b.score - a.score);
  return { cell: [candidates[0].x, candidates[0].y], role: "ANCHOR" as const };
}

export function reserveFootprint(
  grid: GridCell[][],
  cell: [number, number],
  heading: number,
  size: "S" | "M" | "L",
  now: number,
  windowMs = 8000
) {
  const [cx, cy] = cell;
  // Reserve a solid 5x5 block to ensure no other trucks collide or enter this 4-grid column
  const radius = 2;

  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      grid[y][x].reserved = true;
      grid[y][x].reservedUntil = now + windowMs;
    }
  }
}

export function clearExpiredReservations(grid: GridCell[][], now: number) {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const c = grid[y][x];
      if (c.reserved && c.reservedUntil <= now) c.reserved = false;
    }
  }
}

// Material properties: Gaussian distributions
// Coal: Base spread (k=1.8), wide ellipse (matFactor=1.2), normal peak (peakFactor=1.0)
// Iron Ore: Dense spread (k=1.4), tight ellipse (matFactor=0.9), high peak (peakFactor=1.3)
// Limestone: Moderate spread (k=1.6), circular (matFactor=1.0), moderate peak (peakFactor=1.1)
// Overburden: Loose spread (k=2.0), wide ellipse (matFactor=1.3), low peak (peakFactor=0.9)
const k = 1.4;
const matFactor = 0.9;
const peakFactor = 1.3;

// Apply material to grid as a 2D Gaussian distribution
export function applyDump(
  grid: GridCell[][],
  cell: [number, number],
  truck: any, // Pass truck to determine volume/size
  material: string = "OVERBURDEN"
): [number, number][] {
  const [cx, cy] = cell;
  grid[cy][cx].hasDump = true;
  const isBackfill = truck.role === "BACKFILL";
  grid[cy][cx].isBackfill = isBackfill;

  // Scale volume by truck size: S=0.8, M=1.2, L=1.8
  const sizeFactors = { S: 0.8, M: 1.2, L: 1.8 };
  const volume = sizeFactors[truck.size as keyof typeof sizeFactors] || 1.2;

  // Random jittering algorithm slightly mutates rx, ry, peak by up to 20%
  const jitterRx = 1 + (Math.random() * 0.4 - 0.2);
  const jitterRy = 1 + (Math.random() * 0.4 - 0.2);
  const jitterPeak = 1 + (Math.random() * 0.4 - 0.2);

  const v13 = Math.cbrt(volume);

  let matFactor = 1.0;
  let peakFactor = 1.0;
  if (material === "COAL") { matFactor = 1.25; peakFactor = 0.8; }
  else if (material === "IRON_ORE") { matFactor = 0.8; peakFactor = 1.35; }
  else if (material === "LIMESTONE") { matFactor = 1.05; peakFactor = 1.05; }
  else { matFactor = 1.15; peakFactor = 0.9; }

  // Constrain spread so dumps overlap into a continuous ridge (Windrow)
  const rx = v13 * 1.0 * jitterRx * matFactor;
  const ry = v13 * 1.0 * jitterRy * matFactor;

  // Set the peak height to target ~4.5m for clear visual ridges
  const peakAdd = v13 * 4.5 * jitterPeak * peakFactor;

  // Strict radius of 2 ensures it NEVER touches the truck parked 3 cells away!
  const radius = 2;
  const affected: [number, number][] = [];

  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      const dx = x - cx;
      const dy = y - cy;

      // Gaussian distribution
      const expNode = Math.exp(-((dx * dx) / (2 * rx * rx) + (dy * dy) / (2 * ry * ry)));
      const gaussianHeight = grid[y][x].height + peakAdd * expNode;
      
      grid[y][x].height = Math.min(MAX_PILE_HEIGHT, gaussianHeight);
      if (grid[y][x].height > 0.1) {
        // assign material to the cell if it's the core of the dump
        if (!grid[y][x].material || gaussianHeight > grid[y][x].height - 1.5) {
          grid[y][x].material = material as any;
          // Mark backfill cells so terrain renders them in a distinct color
          if (isBackfill) grid[y][x].isBackfill = true;
        }
      }
      affected.push([x, y]);
    }
  }
  recomputeSlopesLocal(grid, cx, cy, radius + 1);
  return affected;
}
