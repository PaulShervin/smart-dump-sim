// Animated path visualization + reservation footprints + dump dust.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import type { Truck, GridCell } from "@/sim/types";
import { GRID_SIZE, gridToWorld, MAX_PILE_HEIGHT } from "@/sim/grid";

// Dynamic instanced rubble rendering for extreme realism in Demo Mode
export function RockRubble({ gridRef, isDemoMode, onClick }: { gridRef: React.MutableRefObject<GridCell[][]>; isDemoMode: boolean; onClick?: (event: any) => void }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const COUNT = 1500; // number of rocks
  
  // Random static attributes for rocks
  const rockData = useMemo(() => {
    const data = [];
    for (let i = 0; i < COUNT; i++) {
      data.push({
        gridX: Math.floor(Math.random() * GRID_SIZE),
        gridY: Math.floor(Math.random() * GRID_SIZE),
        offsetX: (Math.random() - 0.5) * 1.5,
        offsetZ: (Math.random() - 0.5) * 1.5,
        rotX: Math.random() * Math.PI,
        rotY: Math.random() * Math.PI,
        rotZ: Math.random() * Math.PI,
        scale: Math.random() * 0.4 + 0.1,
      });
    }
    return data;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    if (!isDemoMode || !meshRef.current) return;
    const grid = gridRef.current;
    
    let visibleCount = 0;
    for (let i = 0; i < COUNT; i++) {
      const rock = rockData[i];
      const cell = grid[rock.gridY]?.[rock.gridX];
      if (!cell || cell.height < 0.2) continue; // Only spawn on existing piles

      const [wx, wz] = gridToWorld(rock.gridX, rock.gridY);
      
      dummy.position.set(wx + rock.offsetX, cell.height + rock.scale * 0.5, wz + rock.offsetZ);
      dummy.rotation.set(rock.rotX, rock.rotY, rock.rotZ);
      dummy.scale.set(rock.scale, rock.scale, rock.scale);
      dummy.updateMatrix();
      
      meshRef.current.setMatrixAt(visibleCount, dummy.matrix);
      visibleCount++;
    }
    meshRef.current.count = visibleCount;
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (!isDemoMode) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} castShadow receiveShadow onClick={onClick}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshPhysicalMaterial color="#5c2616" roughness={1.0} metalness={0.1} flatShading={true} />
    </instancedMesh>
  );
}

export function PathLines({ trucks }: { trucks: Truck[] }) {
  return (
    <group>
      {trucks.map((t) => {
        if (!t.path.length || t.state === "WAITING_AT_ENTRY" || t.state === "DUMPING") return null;
        const remaining = t.path.slice(Math.max(0, t.pathIndex - 1));
        if (remaining.length < 2) return null;
        const points = remaining.map(([gx, gy]) => {
          const [wx, wz] = gridToWorld(gx, gy);
          return new THREE.Vector3(wx, 0.4, wz);
        });
        return (
          <Line
            key={t.id}
            points={points}
            color={t.color}
            lineWidth={4} // Thicker, more visible laser line
            dashed={true}
            dashScale={5}
            dashSize={2}
            dashOffset={-performance.now() / 500} // Animated marching effect
            transparent
            opacity={0.8}
          />
        );
      })}
    </group>
  );
}

export function ReservationMarkers({ gridRef, tick }: { gridRef: React.MutableRefObject<GridCell[][]>; tick: number }) {
  const grid = gridRef.current;
  const items: { x: number; y: number }[] = [];
  // Sample only every Nth cell for perf
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (grid[y][x].reserved) items.push({ x, y });
    }
  }
  // Cluster: show centers only
  const seen = new Set<string>();
  const clusters: { x: number; y: number }[] = [];
  for (const c of items) {
    let near = false;
    for (const k of seen) {
      const [kx, ky] = k.split(",").map(Number);
      if (Math.abs(kx - c.x) < 4 && Math.abs(ky - c.y) < 4) { near = true; break; }
    }
    if (!near) { seen.add(`${c.x},${c.y}`); clusters.push(c); }
  }
  const pulse = 0.6 + 0.4 * Math.sin(tick * 0.15);
  return (
    <group>
      {clusters.map((c, i) => {
        const [wx, wz] = gridToWorld(c.x, c.y);
        const h = grid[c.y][c.x].height;
        return (
          <group key={i} position={[wx, h + 1.2, wz]}>
            {/* Spinning Holographic Cylinder */}
            <mesh rotation-x={Math.PI / 2} rotation-z={tick * 0.05}>
              <cylinderGeometry args={[2.5, 2.5, 0.8, 16, 1, true]} />
              <meshBasicMaterial color="#00ffcc" transparent opacity={0.4 * pulse} side={THREE.DoubleSide} />
            </mesh>
            {/* Pulsing Core */}
            <mesh position={[0, -0.8, 0]}>
              <boxGeometry args={[3, 0.2, 3]} />
              <meshBasicMaterial color="#00ffcc" transparent opacity={0.6 * pulse} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// Dust particles that spawn during dump events
export function DustParticles({ trucks }: { trucks: Truck[] }) {
  const ref = useRef<THREE.Points>(null);
  const COUNT = 200;
  const positions = useMemo(() => new Float32Array(COUNT * 3), []);
  const velocities = useMemo(() => new Float32Array(COUNT * 3), []);
  const ages = useMemo(() => new Float32Array(COUNT), []);
  const cursor = useRef(0);

  useFrame((_, dt) => {
    // Spawn from dumping trucks
    for (const t of trucks) {
      if (t.state !== "DUMPING") continue;
      for (let s = 0; s < 2; s++) {
        const i = cursor.current % COUNT;
        cursor.current++;
        // Spawn at rear of truck bed
        positions[i * 3] = t.position[0] - Math.sin(t.heading) * 3;
        positions[i * 3 + 1] = t.position[1] + 0.5;
        positions[i * 3 + 2] = t.position[2] - Math.cos(t.heading) * 3;
        velocities[i * 3] = (Math.random() - 0.5) * 1.5;
        velocities[i * 3 + 1] = Math.random() * 1.2 + 0.3;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
        ages[i] = 1;
      }
    }
    // Update
    for (let i = 0; i < COUNT; i++) {
      if (ages[i] <= 0) continue;
      ages[i] -= dt * 0.6;
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      velocities[i * 3 + 1] -= 0.4 * dt;
    }
    if (ref.current) {
      const attr = ref.current.geometry.attributes.position as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={COUNT} />
      </bufferGeometry>
      <pointsMaterial color="#c9a878" size={0.6} transparent opacity={0.55} sizeAttenuation depthWrite={false} />
    </points>
  );
}

// V2X communication beams from trucks to a virtual control tower at center
export function V2XBeams({ trucks, tick }: { trucks: Truck[]; tick: number }) {
  return (
    <group>
      {/* Control tower */}
      <mesh position={[0, 6, 0]}>
        <cylinderGeometry args={[0.4, 0.6, 12, 8]} />
        <meshStandardMaterial color="#444" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, 12.5, 0]}>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.6 + 0.4 * Math.sin(tick * 0.2)} />
      </mesh>
      {trucks.map((t) => {
        if (t.state === "WAITING_AT_ENTRY") return null;
        const points = [
          new THREE.Vector3(t.position[0], t.position[1] + 2.5, t.position[2]),
          new THREE.Vector3(0, 12, 0),
        ];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const pulse = 0.3 + 0.4 * Math.abs(Math.sin(tick * 0.3 + t.position[0]));
        return (
          <line key={t.id}>
            <primitive object={geom} attach="geometry" />
            <lineBasicMaterial color="#22d3ee" transparent opacity={pulse} />
          </line>
        );
      })}
    </group>
  );
}
