// Heightmap terrain mesh with layered ochre/brown coloring & subtle slope shading.
// Re-uploads vertex positions/colors when the underlying grid mutates.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GridCell } from "@/sim/types";
import { GRID_SIZE, CELL_M, MAX_PILE_HEIGHT } from "@/sim/grid";

interface Props {
  gridRef: React.MutableRefObject<GridCell[][]>;
  showHeatmap: boolean;
  showEmptyGrid?: boolean;
  onClick?: (event: any) => void;
}

const SEG = GRID_SIZE; // one vertex per cell corner
const SIZE = GRID_SIZE * CELL_M;

// Color palettes per material
const MAT_COLORS = {
  COAL: { low: new THREE.Color("#2a2a2a"), high: new THREE.Color("#1a1a1a"), crest: new THREE.Color("#0f0f0f") },
  IRON_ORE: { low: new THREE.Color("#8c3a21"), high: new THREE.Color("#6e2b17"), crest: new THREE.Color("#d96341") },
  LIMESTONE: { low: new THREE.Color("#d1cfc7"), high: new THREE.Color("#a6a59e"), crest: new THREE.Color("#f0efe9") },
  OVERBURDEN: { low: new THREE.Color("#7a5230"), high: new THREE.Color("#3d2a1a"), crest: new THREE.Color("#d9b27a") },
};

// Distinct cyan/teal palette for backfill (gap-fill) dumps
const BACKFILL_COLORS = {
  low: new THREE.Color("#0e7490"),   // dark teal base
  high: new THREE.Color("#06b6d4"),  // mid cyan 
  crest: new THREE.Color("#67e8f9"), // bright cyan crest
};

const C_EMPTY = new THREE.Color("#1e1e1e"); // Dark base surface

const H_LOW = new THREE.Color("#1f7a3a");
const H_MID = new THREE.Color("#e0b020");
const H_HIGH = new THREE.Color("#c0392b");

export function Terrain({ gridRef, showHeatmap, showEmptyGrid, onClick }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const currentHeights = useRef<Float32Array>(new Float32Array(SEG * SEG));

  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG - 1, SEG - 1);
    g.rotateX(-Math.PI / 2);
    const colors = new Float32Array(g.attributes.position.count * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);

  const noiseOffsets = useMemo(() => {
    const arr = new Float32Array(SEG * SEG);
    for (let i = 0; i < arr.length; i++) {
      // High frequency micro-variation noise (max 25cm perturbation)
      arr[i] = (Math.random() - 0.5) * 0.25; 
    }
    return arr;
  }, []);

  useFrame((state, delta) => {
    const grid = gridRef.current;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const col = geom.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    let needsUpdate = false;

    for (let y = 0; y < SEG; y++) {
      for (let x = 0; x < SEG; x++) {
        const cell = grid[Math.min(GRID_SIZE - 1, y)][Math.min(GRID_SIZE - 1, x)];
        const i = y * SEG + x;
        const targetH = cell.height;
        let currentH = currentHeights.current[i];

        if (Math.abs(targetH - currentH) > 0.01) {
          currentH = THREE.MathUtils.lerp(currentH, targetH, 10 * delta);
          currentHeights.current[i] = currentH;
          needsUpdate = true;
        } else if (currentH !== targetH) {
          currentH = targetH;
          currentHeights.current[i] = currentH;
          needsUpdate = true;
        }

        // Apply physical static noise to piles and ground
        const bump = currentH > 0.1 ? noiseOffsets[i] * (1 + currentH * 0.1) : noiseOffsets[i] * 0.2;
        pos.setY(i, currentH + bump);

        if (showHeatmap) {
          const t = Math.min(1, currentH / MAX_PILE_HEIGHT);
          if (t < 0.5) c.lerpColors(H_LOW, H_MID, t * 2);
          else c.lerpColors(H_MID, H_HIGH, (t - 0.5) * 2);
          // mix with slope warning
          if (cell.slope > 0.45) c.lerp(new THREE.Color("#ff3030"), 0.4);
        } else if (showEmptyGrid) {
          c.copy(C_EMPTY);
        } else {
          if (currentH <= 0.01) {
            c.copy(C_EMPTY);
          } else {
            // Use backfill palette for gap-fill dumps, material palette for anchors
            const matColors = cell.isBackfill
              ? BACKFILL_COLORS
              : MAT_COLORS[cell.material || "OVERBURDEN"];
            const t = Math.min(1, currentH / 5);
            if (t < 0.5) c.lerpColors(matColors.low, matColors.high, t / 0.5);
            else c.lerpColors(matColors.high, matColors.crest, (t - 0.5) / 0.5);
            
            // Add subtle color noise to break up solid faces
            c.r += (Math.random() - 0.5) * 0.05;
            c.g += (Math.random() - 0.5) * 0.05;
            c.b += (Math.random() - 0.5) * 0.05;
            // slope shading
            const sh = Math.max(0, 1 - cell.slope * 0.8);
            c.multiplyScalar(0.6 + 0.4 * sh);
          }
        }
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }
    
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (needsUpdate) {
      geom.computeVertexNormals();
    }
  });

  return (
    <mesh ref={meshRef} geometry={geom} receiveShadow castShadow onClick={onClick}>
      <meshPhysicalMaterial 
        vertexColors 
        roughness={1.0} 
        metalness={0.1} 
        clearcoat={0.0}
        flatShading={false} 
        wireframe={false}
      />
    </mesh>
  );
}

// Subtle grid overlay (manual lines so we can control opacity)
export function GridOverlay() {
  const geom = useMemo(() => {
    const verts: number[] = [];
    const half = SIZE / 2;
    const step = SIZE / SEG;
    for (let i = 0; i <= SEG; i++) {
      const p = -half + i * step;
      verts.push(p, 0.05, -half, p, 0.05, half);
      verts.push(-half, 0.05, p, half, 0.05, p);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color="#555555" transparent opacity={0.2} />
    </lineSegments>
  );
}
