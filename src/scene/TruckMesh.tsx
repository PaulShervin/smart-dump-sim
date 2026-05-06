// Heavy mining dump truck: chassis, articulated bed, 6 wheels, headlights.
// Drives off Truck state from the simulation.
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import type { Truck } from "@/sim/types";

interface Props { truck: Truck; isNight?: boolean; onClick?: (event: any) => void; }

const SIZE_SCALE = { S: 0.85, M: 1, L: 1.2 } as const;

export function TruckMesh({ truck, isNight, onClick }: Props) {
  const root = useRef<THREE.Group>(null);
  const bed = useRef<THREE.Group>(null);
  const wheels = useRef<THREE.Mesh[]>([]);

  useFrame(() => {
    if (!root.current) return;
    root.current.position.set(truck.position[0], truck.position[1] + 0.4, truck.position[2]);
    root.current.rotation.y = truck.heading;
    if (bed.current) {
      bed.current.rotation.x = -truck.bedTilt * 0.9;
    }
    for (const w of wheels.current) {
      if (w) w.rotation.x = truck.wheelSpin;
    }
  });

  const s = SIZE_SCALE[truck.size];
  // Backfill trucks get a distinct cyan/teal color to stand out from anchor (yellow) trucks
  const isBackfill = truck.role === "BACKFILL";
  const bodyColor = isBackfill ? "#06b6d4" : truck.color;
  const dark = "#1a1410";
  const yellow = "#fcd34d";

  return (
    <group ref={root} onClick={onClick}>
      <group scale={[s, s, s]}>
        {/* Chassis / Frame */}
        <mesh position={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[2.0, 0.6, 4.8]} />
          <meshPhysicalMaterial color={dark} roughness={0.95} metalness={0.7} clearcoat={0.0} />
        </mesh>
        
        {/* Front Grille & Radiator */}
        <mesh position={[0, 0.6, 2.45]} castShadow>
          <boxGeometry args={[1.8, 1.2, 0.2]} />
          <meshPhysicalMaterial color="#111" roughness={0.95} metalness={0.8} />
        </mesh>

        {/* Front Bumper & Deck */}
        <mesh position={[0, 1.3, 2.3]} castShadow>
          <boxGeometry args={[2.8, 0.2, 1.0]} />
          <meshPhysicalMaterial color={bodyColor} roughness={0.85} metalness={0.4} clearcoat={0.1} />
        </mesh>

        {/* Asymmetrical Cab (Left side for typical CAT) */}
        <mesh position={[-0.8, 1.8, 2.2]} castShadow>
          <boxGeometry args={[0.9, 0.8, 0.8]} />
          <meshPhysicalMaterial color={bodyColor} roughness={0.85} metalness={0.4} clearcoat={0.1} />
        </mesh>
        {/* Windshield */}
        <mesh position={[-0.8, 1.9, 2.61]} rotation={[-0.1, 0, 0]}>
          <planeGeometry args={[0.8, 0.5]} />
          <meshStandardMaterial color="#0a1418" roughness={0.1} metalness={0.9} emissive="#0a2030" emissiveIntensity={0.3} />
        </mesh>

        {/* Autonomous Sensor Array (LIDARs) */}
        {/* Top of Cab LIDAR */}
        <mesh position={[-0.8, 2.25, 2.2]}>
          <cylinderGeometry args={[0.15, 0.15, 0.2, 16]} />
          <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.8} />
        </mesh>
        {/* Right Deck Sensor Block */}
        <mesh position={[1.0, 1.5, 2.5]}>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <mesh position={[1.0, 1.75, 2.5]}>
          <cylinderGeometry args={[0.1, 0.1, 0.1, 16]} />
          <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.8} />
        </mesh>

        {/* Headlights on Deck */}
        <mesh position={[-1.2, 1.3, 2.82]}>
          <sphereGeometry args={[0.15, 12, 12]} />
          <meshStandardMaterial color={yellow} emissive={yellow} emissiveIntensity={isNight ? 4.0 : 1.2} />
        </mesh>
        <mesh position={[1.2, 1.3, 2.82]}>
          <sphereGeometry args={[0.15, 12, 12]} />
          <meshStandardMaterial color={yellow} emissive={yellow} emissiveIntensity={isNight ? 4.0 : 1.2} />
        </mesh>
        
        {/* Dynamic Headlight Glow (Night Only) */}
        {isNight && (
          <pointLight position={[0, 1.3, 4.0]} intensity={40} distance={80} color={yellow} castShadow />
        )}

        {/* CAT-Style Massive Dump Bed */}
        <group ref={bed} position={[0, 1.2, -1.0]}>
          {/* Main Floor */}
          <mesh castShadow position={[0, 0.3, -0.2]}>
            <boxGeometry args={[2.8, 0.2, 4.0]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Canopy extending over the cab */}
          <mesh castShadow position={[0, 1.3, 2.3]} rotation={[0.15, 0, 0]}>
            <boxGeometry args={[3.2, 0.2, 2.0]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Front Wall (slanted) */}
          <mesh castShadow position={[0, 0.8, 1.7]} rotation={[0.3, 0, 0]}>
            <boxGeometry args={[3.2, 1.2, 0.2]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Side Walls (slanted outward slightly) */}
          <mesh position={[-1.4, 0.8, -0.2]} castShadow rotation={[0, 0, -0.15]}>
            <boxGeometry args={[0.2, 1.2, 4.0]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[1.4, 0.8, -0.2]} castShadow rotation={[0, 0, 0.15]}>
            <boxGeometry args={[0.2, 1.2, 4.0]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.4} />
          </mesh>

          {/* CAT Logos */}
          <Text
            position={[-1.52, 0.8, -0.2]}
            rotation={[0, -Math.PI / 2, -0.15]}
            fontSize={0.7}
            color="#111"
            anchorX="center"
            anchorY="middle"
          >
            CAT
          </Text>
          <Text
            position={[1.52, 0.8, -0.2]}
            rotation={[0, Math.PI / 2, 0.15]}
            fontSize={0.7}
            color="#111"
            anchorX="center"
            anchorY="middle"
          >
            CAT
          </Text>

          {/* Back edge */}
          <mesh position={[0, 0.4, -2.15]} castShadow>
            <boxGeometry args={[2.8, 0.4, 0.2]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.4} />
          </mesh>
          
          {/* Material in bed (Massive Conical Piles) */}
          {truck.load > 0.05 && (
            <group position={[0, 0.4 + truck.load * 1.4, -0.2]}>
              {/* Main central peak - overflowing dangerously */}
              <mesh scale={[1.6, 1, 2.2]}>
                <coneGeometry args={[1, truck.load * 2.8, 16]} />
                <meshStandardMaterial color={materialColor(truck.material)} roughness={1} />
              </mesh>
              {/* Front trailing peak */}
              <mesh position={[0, -0.2, 1.2]} scale={[1.4, 1, 1.6]}>
                <coneGeometry args={[1, truck.load * 2.2, 12]} />
                <meshStandardMaterial color={materialColor(truck.material)} roughness={1} />
              </mesh>
              {/* Back trailing peak */}
              <mesh position={[0, -0.2, -1.4]} scale={[1.4, 1, 1.6]}>
                <coneGeometry args={[1, truck.load * 2.2, 12]} />
                <meshStandardMaterial color={materialColor(truck.material)} roughness={1} />
              </mesh>
            </group>
          )}
        </group>

        {/* Wheels — 6 Massive Mining Tires */}
        {[
          [-1.5, 0.3, 1.6], [1.5, 0.3, 1.6],  // Front axle
          [-1.5, 0.3, -0.5], [1.5, 0.3, -0.5], // Mid axle
          [-1.5, 0.3, -2.0], [1.5, 0.3, -2.0], // Rear axle
        ].map(([x, y, z], i) => (
          <mesh
            key={i}
            ref={(el) => { if (el) wheels.current[i] = el; }}
            position={[x, y, z]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[0.7, 0.7, 0.6, 24]} />
            <meshStandardMaterial color="#111" roughness={0.9} />
            {/* Hubcaps */}
            <mesh position={[0, 0.31, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 0.02, 12]} />
              <meshStandardMaterial color="#444" metalness={0.8} />
            </mesh>
            <mesh position={[0, -0.31, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 0.02, 12]} />
              <meshStandardMaterial color="#444" metalness={0.8} />
            </mesh>
          </mesh>
        ))}
      </group>

      {/* Status indicator on top */}
      <mesh position={[0, 2.6 * s, 0]}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshStandardMaterial
          color={statusColor(truck.state)}
          emissive={statusColor(truck.state)}
          emissiveIntensity={1.5}
        />
      </mesh>

      {/* Role indicator ring — glowing cyan torus for BACKFILL trucks */}
      {isBackfill && (
        <group position={[0, 3.0 * s, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.4, 0.06, 8, 24]} />
            <meshStandardMaterial
              color="#06b6d4"
              emissive="#22d3ee"
              emissiveIntensity={3.0}
              transparent
              opacity={0.9}
            />
          </mesh>
          {/* Vertical beacon light for backfill visibility */}
          <pointLight intensity={8} distance={15} color="#22d3ee" />
        </group>
      )}
    </group>
  );
}

function statusColor(s: Truck["state"]): string {
  switch (s) {
    case "MOVING": return "#22d3ee";
    case "ARRIVED": return "#facc15";
    case "DUMPING": return "#f97316";
    case "RETURNING": return "#a78bfa";
    default: return "#64748b";
  }
}

function materialColor(m: string): string {
  switch (m) {
    case "COAL": return "#1a1a1a";
    case "IRON_ORE": return "#5a2c20";
    case "LIMESTONE": return "#e0e0e0";
    default: return "#5a3a20";
  }
}
