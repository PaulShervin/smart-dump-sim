/**
 * @file DumpYardBoundary.tsx
 * @description 3D visual rendering for the dynamic dump yard:
 *  - Polygon boundary lines (glowing fence posts + wires)
 *  - Vertex markers at each polygon corner
 *  - Entry point marker (pulsing beacon)
 *  - Semi-transparent fill showing the valid dump area
 *  - Drawing-mode preview line from last vertex to cursor
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { DumpYardPoint, DumpYardState } from "@/hooks/useDumpYardStore";

interface Props {
  dumpYardState: DumpYardState;
}

// ─── Boundary Fence Lines ─────────────────────────────────────────────────────
function BoundaryLines({ polygon }: { polygon: DumpYardPoint[] }) {
  const lineRef = useRef<THREE.LineLoop>(null);
  const glowRef = useRef<THREE.LineLoop>(null);

  const geometry = useMemo(() => {
    if (polygon.length < 2) return null;
    const points = polygon.map((p) => new THREE.Vector3(p.x, 0.3, p.z));
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [polygon]);

  useFrame(({ clock }) => {
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.LineBasicMaterial;
      mat.opacity = 0.4 + Math.sin(clock.getElapsedTime() * 3) * 0.2;
    }
  });

  if (!geometry) return null;

  return (
    <group>
      {/* Solid inner line */}
      <lineLoop ref={lineRef} geometry={geometry}>
        <lineBasicMaterial color="#f59e0b" linewidth={2} transparent opacity={0.9} />
      </lineLoop>
      {/* Outer glow line */}
      <lineLoop ref={glowRef} geometry={geometry}>
        <lineBasicMaterial color="#fbbf24" linewidth={4} transparent opacity={0.5} />
      </lineLoop>
    </group>
  );
}

// ─── Vertex Markers (corner posts) ────────────────────────────────────────────
function VertexMarkers({ polygon }: { polygon: DumpYardPoint[] }) {
  return (
    <group>
      {polygon.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          {/* Post */}
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.15, 0.15, 3, 8]} />
            <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.5} />
          </mesh>
          {/* Top cap glow */}
          <mesh position={[0, 3.1, 0]}>
            <sphereGeometry args={[0.3, 12, 12]} />
            <meshStandardMaterial
              color="#fbbf24"
              emissive="#fcd34d"
              emissiveIntensity={1.5}
              transparent
              opacity={0.9}
            />
          </mesh>
          {/* Index label ring */}
          <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.6, 1.0, 16]} />
            <meshBasicMaterial color="#f59e0b" transparent opacity={0.35} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── Polygon Fill (semi-transparent zone indicator) ───────────────────────────
function PolygonFill({ polygon }: { polygon: DumpYardPoint[] }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    if (polygon.length < 3) return null;
    const shape = new THREE.Shape();
    shape.moveTo(polygon[0].x, polygon[0].z);
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i].x, polygon[i].z);
    }
    shape.closePath();
    const geom = new THREE.ShapeGeometry(shape);
    // Rotate from XY to XZ plane
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, [polygon]);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.06 + Math.sin(clock.getElapsedTime() * 1.5) * 0.03;
    }
  });

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} position={[0, 0.15, 0]}>
      <meshBasicMaterial
        color="#f59e0b"
        transparent
        opacity={0.08}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// ─── Entry Point Beacon ───────────────────────────────────────────────────────
function EntryPointBeacon({ point }: { point: DumpYardPoint }) {
  const beaconRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const pillarRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (beaconRef.current) {
      beaconRef.current.position.y = 5 + Math.sin(t * 2) * 0.5;
      const mat = beaconRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.5 + Math.sin(t * 4) * 0.5;
    }
    if (ringRef.current) {
      ringRef.current.scale.setScalar(1.5 + Math.sin(t * 2) * 0.3);
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.3 + Math.sin(t * 3) * 0.15;
    }
  });

  return (
    <group position={[point.x, 0, point.z]}>
      {/* Ground ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
        <ringGeometry args={[1.8, 2.8, 24]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>

      {/* Pillar */}
      <mesh ref={pillarRef} position={[0, 2, 0]}>
        <cylinderGeometry args={[0.12, 0.2, 4, 8]} />
        <meshStandardMaterial color="#155e75" emissive="#22d3ee" emissiveIntensity={0.3} />
      </mesh>

      {/* Beacon light */}
      <mesh ref={beaconRef} position={[0, 5, 0]}>
        <octahedronGeometry args={[0.6]} />
        <meshStandardMaterial
          color="#22d3ee"
          emissive="#22d3ee"
          emissiveIntensity={2}
          transparent
          opacity={0.95}
        />
      </mesh>

      {/* Point light for real illumination */}
      <pointLight position={[0, 5, 0]} color="#22d3ee" intensity={40} distance={20} decay={2} />

      {/* Cross marker on ground */}
      {[0, Math.PI / 2].map((rot, i) => (
        <mesh key={i} position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, rot]}>
          <planeGeometry args={[4, 0.2]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* "ENTRY" text indicator (small plane behind beacon) */}
      <mesh position={[0, 4.2, 0.5]} rotation={[0, 0, 0]}>
        <planeGeometry args={[2, 0.4]} />
        <meshBasicMaterial color="#0e7490" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ─── Drawing Preview (line from last vertex to indicate next click position) ──
function DrawingGuide({ polygon }: { polygon: DumpYardPoint[] }) {
  if (polygon.length === 0) return null;

  // Show a subtle indicator at the first vertex to hint about closing the polygon
  const first = polygon[0];
  return (
    <group>
      {/* First vertex highlight — "close here" indicator */}
      {polygon.length >= 3 && (
        <mesh position={[first.x, 0.3, first.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.0, 1.8, 16]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function DumpYardBoundary({ dumpYardState }: Props) {
  const { polygon, entryPoint, mode, isFinalized } = dumpYardState;

  return (
    <group>
      {/* Always show polygon if it has vertices */}
      {polygon.length >= 2 && <BoundaryLines polygon={polygon} />}
      {polygon.length > 0 && <VertexMarkers polygon={polygon} />}

      {/* Show fill when polygon is closed (≥3 vertices and past drawing mode) */}
      {polygon.length >= 3 && mode !== "drawing" && <PolygonFill polygon={polygon} />}

      {/* Drawing guide hints */}
      {mode === "drawing" && <DrawingGuide polygon={polygon} />}

      {/* Entry point beacon */}
      {entryPoint && <EntryPointBeacon point={entryPoint} />}
    </group>
  );
}
