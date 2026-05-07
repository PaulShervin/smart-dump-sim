// Dump decision engine: scores candidate cells, picks from top decile,
// validates with BFS + slope, reserves footprint with time window.
import type { GridCell } from "./types";
import { GRID_SIZE, SLOPE_LIMIT, MAX_PILE_HEIGHT, gridToWorld, worldToGrid, recomputeSlopesLocal } from "./grid";
import { bfsReachable, checkCorridorPreservation } from "./pathfinding";

// FIX 1+2: Effective truck dump radii in grid cells — r = cbrt(volume) × μ where μ=1.0
// S: cbrt(0.8)=0.928  M: cbrt(1.2)=1.063  L: cbrt(1.8)=1.216
const TRUCK_RADIUS: Record<"S" | "M" | "L", number> = { S: 0.928, M: 1.063, L: 1.216 };

// FIX T1: Spatial Index for fast slot lookup
const BUCKET_SIZE = 8;
const numBuckets = Math.ceil(GRID_SIZE / BUCKET_SIZE);
export const spatialBuckets: Set<number>[][] = Array(numBuckets).fill(0).map(() => Array(numBuckets).fill(0).map(() => new Set()));

// FIX T2: Dirty flag system for slope recomputation
export const dirtySlopes = new Set<number>();

export function processDirtySlopes(grid: GridCell[][], maxUpdates = 20) {
  let count = 0;
  for (const k of dirtySlopes) {
    if (count++ >= maxUpdates) break;
    dirtySlopes.delete(k);
    const x = k % GRID_SIZE;
    const y = Math.floor(k / GRID_SIZE);
    
    // Recompute local 3x3 slope
    const hL = grid[y][Math.max(0, x - 1)].height;
    const hR = grid[y][Math.min(GRID_SIZE - 1, x + 1)].height;
    const hD = grid[Math.max(0, y - 1)][x].height;
    const hU = grid[Math.min(GRID_SIZE - 1, y + 1)][x].height;
    const dx = (hR - hL) / (2 * 2); // CELL_M = 2
    const dy = (hU - hD) / (2 * 2);
    grid[y][x].slope = Math.sqrt(dx * dx + dy * dy);
    grid[y][x].accessibility = grid[y][x].slope <= SLOPE_LIMIT && !grid[y][x].occupied;
  }
}

// FIX T3: Reservation Registry
export const reservationRegistry = new Map<number, number>();

// FIX T4: Global counter for packing density
export let filledCellCount = 0;
export function resetFilledCellCount() { filledCellCount = 0; }

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
  strategy: "LEGACY" | "MIXED_FLEET" | "HOMOGENEOUS" = "LEGACY",
  isInsideYard?: (gx: number, gy: number) => boolean,
  fleetSmallestRadius: number = 0.928
): DumpCellResult | null {
  const truckGrid = worldToGrid(truck.position[0], truck.position[2]);
  // FIX 8: Removed dead function-scope stepCells/rowStepCells — redefined inside LEGACY branch below

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
        // Only reachable if it's mostly flat and NOT a dump pile (height <= 0.5)
        if (!reachable.has(k) && grid[ny][nx].slope <= SLOPE_LIMIT && grid[ny][nx].height <= 0.5) {
          reachable.add(k);
          q.push([nx, ny]);
        }
      }
    }
  }

  let candidates: { x: number; y: number; score: number }[] = [];

  const maxX = isDemoMode ? 22 : GRID_SIZE - 2;
  const minX = isDemoMode ? 8 : 2;
  const maxY = isDemoMode ? 18 : GRID_SIZE - 2;
  const minY = isDemoMode ? 8 : 2;

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
    // FIX 4: Spacing uses actual truck radii: d_ij = r_i + r_j + g - o + m
    //   g=1.0 (safety gap), o=0.5 (Gaussian overlap), m=0.5 (margin)
    //   S–S: 0.928+0.928+1.0-0.5+0.5 = 2.856 cells (5.71m)
    //   S–L: 0.928+1.216+1.0-0.5+0.5 = 3.144 cells (6.29m)
    //   L–L: 1.216+1.216+1.0-0.5+0.5 = 3.432 cells (6.86m)
    // ANCHOR phase:   2 × d_ij (leaves gap for backfill)
    // BACKFILL phase: 1 × d_ij (fills the gap)

    // =====================================================================
    // 1. DYNAMIC ROW PARAMETERS
    // =====================================================================
    const ROW_SPACING = 3.044; // FIX 3: Hexagonal — D×sin(60°)=3.515×0.866=3.044 cells (6.09m)
    const CRESCENT_STRENGTH = 0.0035;
    
    // --- Generate rows from furthest (maxY) to nearest (minY) ---
    const rows: number[] = [];
    for (let yF = maxY; yF >= minY; yF -= ROW_SPACING) {
      rows.push(Math.round(yF));
    }

    // FIX T6: On-Demand Slot Generation
    const truckSize = truck.size as "S" | "M" | "L";
    const isBigTruck = truckSize === "L" || truckSize === "M";

    // --- Iterate rows in order (furthest first) ---
    for (const rowY of rows) {
      if (rowY < 0 || rowY >= GRID_SIZE) continue;

      const rowIdx = rows.indexOf(rowY);
      const dy = maxY - rowY; // Distance from the back ridge
      const crescentShift = CRESCENT_STRENGTH * (dy * dy); // Quadratic curve offset
      const staggerOffset = (rowIdx % 2 === 0) ? 0 : 1.5;

      // Scan existing piles in this row using spatial index (FIX T1 & T6)
      const pilesInRow: {x: number, y: number, size: string, age: number, isAnchor: boolean}[] = [];
      const by = Math.floor(rowY / BUCKET_SIZE);
      if (by >= 0 && by < numBuckets) {
        for (let bx = 0; bx < numBuckets; bx++) {
          for (const k of spatialBuckets[by][bx]) {
            const px = k % GRID_SIZE;
            const py = Math.floor(k / GRID_SIZE);
            if (py === rowY) {
              const c = grid[py][px];
              if (c.hasDump) {
                pilesInRow.push({
                  x: px, 
                  y: py, 
                  size: c.isBackfill ? "S" : "L", 
                  age: c.dumpCompletedAt ? now - c.dumpCompletedAt : 0,
                  isAnchor: !c.isBackfill
                });
              }
            }
          }
        }
      }
      pilesInRow.sort((a, b) => a.x - b.x);
      const filledAnchors = pilesInRow.filter(p => p.isAnchor).length;

      let currentX = minX + staggerOffset + crescentShift;
      let sequenceIdx = 0;
      let allSlotsFilled = true;
      const candidates: { cell: [number, number], role: "ANCHOR" | "BACKFILL", distToTruck: number }[] = [];

      while (currentX <= maxX) {
        const isAnchorSlot = sequenceIdx % 2 === 0;
        
        let nearestPile = null;
        let minDist = Infinity;
        for (const p of pilesInRow) {
           const dist = Math.abs(p.x - currentX);
           if (dist < minDist) {
              minDist = dist;
              nearestPile = p;
           }
        }
        
        const isFilled = minDist < 1.5; // If a pile exists near this sequence position
        
        if (!isFilled) {
           allSlotsFilled = false;
           // Check if this truck can take this slot
           let canTake = false;
           if (isBigTruck && isAnchorSlot) canTake = true;
           if (!isBigTruck && !isAnchorSlot && filledAnchors >= 4) canTake = true;
           
           if (canTake) {
              let targetX = currentX;
              if (nearestPile) {
                 // FIX T5 & PP5: Pile Age Spacing Multiplier & Footprint Gap
                 const spacingMultiplier = nearestPile.age > 0 
                    ? (nearestPile.age > 20000 ? 0.52 : (nearestPile.age > 8000 ? 0.60 : 0.75)) 
                    : 1.0;
                 
                 const sign = nearestPile.x < currentX ? 1 : -1;

                 if (isAnchorSlot) {
                    const r_anchor = TRUCK_RADIUS[isBigTruck ? truckSize : "L"];
                    const r_nearest = TRUCK_RADIUS[nearestPile.size as "S" | "M" | "L"];
                    const gap = 2 * fleetSmallestRadius;
                    // anchor_radius + gap + anchor_radius
                    const d_effective = (r_anchor + gap + r_nearest) * spacingMultiplier;
                    targetX = nearestPile.x + sign * d_effective;
                 } else {
                    // Backfill: Center of gap. 
                    // From nearest anchor: r_anchor + r_small
                    const r_nearest = TRUCK_RADIUS[nearestPile.size as "S" | "M" | "L"];
                    const d_effective = (r_nearest + fleetSmallestRadius) * spacingMultiplier;
                    targetX = nearestPile.x + sign * d_effective;
                 }
              }
              
              const bx = Math.round(targetX);
               if (bx >= 0 && bx < GRID_SIZE && (!isInsideYard || isInsideYard(bx, rowY))) {
                  const k = rowY * GRID_SIZE + bx;
                  const c = grid[rowY][bx];
                  // If not reserved and reachable, it's a valid candidate!
                  if (!c.reserved || c.reservedUntil <= now) {
                     if (c.slope <= SLOPE_LIMIT && reachable.has(k)) {
                        // FIX P3: Pre-dump Reachability Check (Corridor Preservation)
                        if (checkCorridorPreservation(grid, entryPoint, [bx, rowY])) {
                           candidates.push({ 
                              cell: [bx, rowY], 
                              role: isAnchorSlot ? "ANCHOR" : "BACKFILL", 
                              distToTruck: Math.hypot(bx - truckGrid[0], rowY - truckGrid[1]) 
                           });
                        } else {
                           console.log(`Slot rejected — would isolate zone at ${bx}, ${rowY}`);
                        }
                     }
                  }
               }
           }
        }
        
        const r_curr = TRUCK_RADIUS[isAnchorSlot ? "L" : "S"];
        const nextIsAnchor = (sequenceIdx + 1) % 2 === 0;
        const r_next = TRUCK_RADIUS[nextIsAnchor ? "L" : "S"];
        const d = r_curr + r_next + 1.0 - 0.5 + 0.5;
        
        currentX += d;
        sequenceIdx++;
      }
      
      if (candidates.length > 0) {
         candidates.sort((a, b) => a.distToTruck - b.distToTruck);
         return { cell: candidates[0].cell, role: candidates[0].role };
      }
      
      // Big trucks MUST help with backfill if anchors are done (or if row is fully filled with anchors but no candidate found)
      if (!allSlotsFilled && isBigTruck && filledAnchors >= 4) {
         // Evaluate backfill slots for big truck as fallback
         currentX = minX + staggerOffset + crescentShift;
         sequenceIdx = 0;
         while (currentX <= maxX) {
            const isAnchorSlot = sequenceIdx % 2 === 0;
            if (!isAnchorSlot) {
               let nearestPile = null;
               let minDist = Infinity;
               for (const p of pilesInRow) {
                  const dist = Math.abs(p.x - currentX);
                  if (dist < minDist) { minDist = dist; nearestPile = p; }
               }
               if (minDist >= 1.5) {
                  let targetX = currentX;
                  if (nearestPile) {
                     const spacingMultiplier = nearestPile.age > 0 ? (nearestPile.age > 20000 ? 0.52 : (nearestPile.age > 8000 ? 0.60 : 0.75)) : 1.0;
                     const d_ij = TRUCK_RADIUS["S"] + TRUCK_RADIUS[nearestPile.size as "S" | "M" | "L"] + 1.0 - 0.5 + 0.5;
                     const d_effective = d_ij * spacingMultiplier * 1;
                     targetX = nearestPile.x + (nearestPile.x < currentX ? 1 : -1) * d_effective;
                  }
                  const bx = Math.round(targetX);
                  if (bx >= 0 && bx < GRID_SIZE && (!isInsideYard || isInsideYard(bx, rowY))) {
                     const k = rowY * GRID_SIZE + bx;
                     const c = grid[rowY][bx];
                     if ((!c.reserved || c.reservedUntil <= now) && c.slope <= SLOPE_LIMIT && reachable.has(k)) {
                        candidates.push({ cell: [bx, rowY], role: "BACKFILL", distToTruck: Math.hypot(bx - truckGrid[0], rowY - truckGrid[1]) });
                     }
                  }
               }
            }
            const r_curr = TRUCK_RADIUS[isAnchorSlot ? "L" : "S"];
            const nextIsAnchor = (sequenceIdx + 1) % 2 === 0;
            const r_next = TRUCK_RADIUS[nextIsAnchor ? "L" : "S"];
            currentX += r_curr + r_next + 1.0 - 0.5 + 0.5;
            sequenceIdx++;
         }
         
         if (candidates.length > 0) {
            candidates.sort((a, b) => a.distToTruck - b.distToTruck);
            return { cell: candidates[0].cell, role: candidates[0].role };
         }
      }
      
      if (allSlotsFilled) {
         continue; // Move to next row
      }
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
  const radius = 2;

  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      grid[y][x].reserved = true;
      grid[y][x].reservedUntil = now + windowMs;
      // FIX T3: Add to registry
      reservationRegistry.set(y * GRID_SIZE + x, now + windowMs);
    }
  }
}

export function clearExpiredReservations(grid: GridCell[][], now: number) {
  // FIX T3: Only scan reserved cells, not all 2304
  for (const [k, expiry] of reservationRegistry.entries()) {
    if (expiry <= now) {
      const x = k % GRID_SIZE;
      const y = Math.floor(k / GRID_SIZE);
      grid[y][x].reserved = false;
      reservationRegistry.delete(k);
    }
  }
}

// FIX 8: Removed dead module-level k, matFactor, peakFactor (shadowed by locals in applyDump)

// Apply material to grid as a 2D Gaussian distribution
export function applyDump(
  grid: GridCell[][],
  cell: [number, number],
  truck: any, // Pass truck to determine volume/size
  material: string = "OVERBURDEN"
): [number, number][] {
  const [cx, cy] = cell;
  // FIX 5: Mark center cell as occupied so A* and accessibility treat it as blocked
  grid[cy][cx].hasDump = true;
  grid[cy][cx].occupied = true;
  grid[cy][cx].accessibility = grid[cy][cx].slope <= SLOPE_LIMIT && false; // occupied=true → always false
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

  // FIX 1: Spread σx/σy = r × matFactor × jitter. Multiplier μ=1.0 (NOT 1.15).
  const rx = v13 * jitterRx * matFactor;
  const ry = v13 * jitterRy * matFactor;

  // Backfill optimization: target 85% of anchor peak to fill valleys smoothly
  const backfillDamping = isBackfill ? 0.85 : 1.0;
  const peakAdd = v13 * 4.5 * jitterPeak * peakFactor * backfillDamping;

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
      
      // FIX T4: Update filledCellCount incrementally
      const wasBelow = grid[y][x].height <= 1.2;
      grid[y][x].height = Math.min(MAX_PILE_HEIGHT, gaussianHeight);
      if (wasBelow && grid[y][x].height > 1.2) {
        filledCellCount++;
      }
      
      if (grid[y][x].height > 0.1) {
        // assign material to the cell if it's the core of the dump
        if (!grid[y][x].material || gaussianHeight > grid[y][x].height - 1.5) {
          grid[y][x].material = material as any;
          // Mark backfill cells so terrain renders them in a distinct color
          if (isBackfill) grid[y][x].isBackfill = true;
        }
      }
      affected.push([x, y]);
      // FIX T2: Mark cells as dirty instead of synchronously recomputing slopes
      dirtySlopes.add(y * GRID_SIZE + x);
    }
  }
  // FIX T1: Add pile center to spatial index
  const bx = Math.floor(cx / BUCKET_SIZE);
  const by = Math.floor(cy / BUCKET_SIZE);
  if (bx >= 0 && bx < numBuckets && by >= 0 && by < numBuckets) {
    spatialBuckets[by][bx].add(cy * GRID_SIZE + cx);
  }
  // Removed recomputeSlopesLocal(grid, cx, cy, radius + 1)
  return affected;
}
