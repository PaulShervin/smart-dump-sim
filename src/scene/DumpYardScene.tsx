// Main scene wrapper + camera controller (default isometric, follow-truck mode).
import { useEffect, useRef, useState, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Terrain, GridOverlay } from "@/scene/Terrain";
import { TruckMesh } from "@/scene/TruckMesh";
import { PathLines, ReservationMarkers, DustParticles, V2XBeams, RockRubble } from "@/scene/Effects";
import { HudOverlay } from "@/components/HudOverlay";
import { FleetMonitors } from "@/components/FleetMonitors";
import { useSimulation } from "@/sim/useSimulation";
import type { DumpYardConfig } from "@/sim/useSimulation";
import { WORLD_SIZE } from "@/sim/grid";
import { useMeasurementStore } from "@/hooks/useMeasurementStore";
import { useDumpYardStore } from "@/hooks/useDumpYardStore";
import { MeasurementMarker } from "@/components/MeasurementMarker";
import { MeasurementLine } from "@/components/MeasurementLine";
import { euclideanDistance } from "@/lib/distanceMeasurement";
import { DumpYardBoundary } from "@/scene/DumpYardBoundary";

export type CameraView = "ADMIN" | "TOP" | "SIDE" | "VEHICLE" | "FLEET";

function CameraRig({ cameraView, trucks }: { cameraView: CameraView; trucks: any[] }) {
  const { camera } = useThree();
  const lerpTarget = useRef(new THREE.Vector3());

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (cameraView === "VEHICLE" && trucks.length > 0) {
        const t = trucks[0];
        lerpTarget.current.set(t.position[0], t.position[1] + 2, t.position[2]);
        const offset = new THREE.Vector3(
          -Math.sin(t.heading) * 18,
          14,
          -Math.cos(t.heading) * 18
        );
        const desired = lerpTarget.current.clone().add(offset);
        camera.position.lerp(desired, 0.08);
        camera.lookAt(lerpTarget.current);
      } else if (cameraView === "TOP") {
        const desired = new THREE.Vector3(0, 150, 1); // Slight Z offset to prevent gimbal lock
        camera.position.lerp(desired, 0.05);
        lerpTarget.current.lerp(new THREE.Vector3(0, 0, 0), 0.1);
        camera.lookAt(lerpTarget.current);
      } else if (cameraView === "SIDE") {
        const desired = new THREE.Vector3(WORLD_SIZE * 0.7, 30, 0);
        camera.position.lerp(desired, 0.05);
        lerpTarget.current.lerp(new THREE.Vector3(0, 0, 0), 0.1);
        camera.lookAt(lerpTarget.current);
      }
      
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cameraView, trucks, camera]);

  return null;
}

export function DumpYardScene() {
  // ── Dump Yard Store ──
  const {
    state: dumpYardState,
    stateRef: dumpYardStateRef,
    startDrawing,
    addVertex,
    undoLastVertex,
    finishPolygon,
    setEntryPoint,
    resetYard,
    isInsideYard,
  } = useDumpYardStore();

  // Build a ref that the simulation loop can read synchronously
  const dumpYardConfigRef = useRef<DumpYardConfig | null>(null);

  // Keep config ref in sync with dump yard state
  useEffect(() => {
    const s = dumpYardState;
    if (s.isFinalized) {
      dumpYardConfigRef.current = {
        entryGrid: s.entryGrid,
        isInsideYard,
        isFinalized: true,
      };
    } else {
      dumpYardConfigRef.current = null;
    }
  }, [dumpYardState, isInsideYard]);

  const {
    state, gridRef, targetTruckCount, setTargetTruckCount,
    simSpeed, setSimSpeed, selectedMaterial, setSelectedMaterial,
    packingStrategy, setPackingStrategy, isDemoMode, setIsDemoMode,
    fleetConfig, setFleetConfig, resetToEntryPoint,
    isRunning, startSim, pauseSim, resumeSim,
  } = useSimulation(5, dumpYardConfigRef);

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showEmptyGrid, setShowEmptyGrid] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("ADMIN");
  const [isNight, setIsNight] = useState(false);

  // ── Measurement ──
  const {
    state: mState,
    startSelection,
    setPointA,
    setPointB,
    analyse,
    reset: resetMeasurement,
    clearHistory,
  } = useMeasurementStore();

  const isMeasuring = mState.step !== "idle";
  const isDrawingYard = dumpYardState.mode === "drawing";
  const isPlacingEntry = dumpYardState.mode === "placing_entry";
  const liveDistance = mState.pointA && mState.pointB ? euclideanDistance(mState.pointA, mState.pointB) : null;

  // When dump yard is finalized, reset simulation to the new entry point
  const prevFinalizedRef = useRef(false);
  useEffect(() => {
    if (dumpYardState.isFinalized && !prevFinalizedRef.current) {
      resetToEntryPoint(dumpYardState.entryGrid);
    }
    prevFinalizedRef.current = dumpYardState.isFinalized;
  }, [dumpYardState.isFinalized, dumpYardState.entryGrid, resetToEntryPoint]);

  const handleCanvasClick = (e: any) => {
    e.stopPropagation();
    const pt = { x: e.point.x, y: e.point.y, z: e.point.z };

    // Priority: dump yard drawing > entry point placement > measurement
    if (isDrawingYard) {
      addVertex({ x: pt.x, z: pt.z });
      return;
    }
    if (isPlacingEntry) {
      setEntryPoint({ x: pt.x, z: pt.z });
      return;
    }
    if (isMeasuring) {
      if (mState.step === "selectingA") setPointA(pt);
      else if (mState.step === "selectingB") setPointB(pt);
      return;
    }
  };

  return (
    <div className={`relative h-full w-full ${isNight ? "bg-[#02040a]" : "bg-background"}`}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [WORLD_SIZE * 0.55, WORLD_SIZE * 0.45, WORLD_SIZE * 0.55], fov: 38, near: 0.1, far: 1000 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={[isNight ? "#02040a" : "#d2c3b3"]} />
        <fogExp2 attach="fog" args={[isNight ? "#02040a" : "#d2c3b3", 0.0035]} />

        {/* Lighting */}
        <ambientLight intensity={isNight ? 0.15 : 0.8} color={isNight ? "#445566" : "#fff0d8"} />
        <directionalLight
          position={[80, 120, 60]}
          intensity={isNight ? 0.3 : 2.0}
          color={isNight ? "#aaccff" : "#ffd9a8"}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-WORLD_SIZE / 2}
          shadow-camera-right={WORLD_SIZE / 2}
          shadow-camera-top={WORLD_SIZE / 2}
          shadow-camera-bottom={-WORLD_SIZE / 2}
          shadow-camera-near={1}
          shadow-camera-far={300}
        />
        <directionalLight position={[-60, 40, -80]} intensity={isNight ? 0.1 : 0.6} color={isNight ? "#334466" : "#8aa8d0"} />
        <hemisphereLight args={["#c8a878", "#0a0610", isNight ? 0.1 : 0.5]} />

        {/* Night Mode Stadium Floodlights */}
        {isNight && (
          <group>
            <pointLight position={[WORLD_SIZE / 2.5, 30, WORLD_SIZE / 2.5]} intensity={300} color="#ffeedd" distance={120} decay={1.5} />
            <pointLight position={[-WORLD_SIZE / 2.5, 30, -WORLD_SIZE / 2.5]} intensity={300} color="#ffeedd" distance={120} decay={1.5} />
            <pointLight position={[-WORLD_SIZE / 2.5, 30, WORLD_SIZE / 2.5]} intensity={300} color="#ffeedd" distance={120} decay={1.5} />
            <pointLight position={[WORLD_SIZE / 2.5, 30, -WORLD_SIZE / 2.5]} intensity={300} color="#ffeedd" distance={120} decay={1.5} />
          </group>
        )}

        <Terrain 
          gridRef={gridRef} 
          showHeatmap={showHeatmap} 
          showEmptyGrid={showEmptyGrid} 
          onClick={handleCanvasClick}
        />
        <GridOverlay />

        {/* Dynamic Dump Yard Boundary Visuals */}
        <DumpYardBoundary dumpYardState={dumpYardState} />

        {/* Measurement Visuals */}
        {mState.pointA && (
          <MeasurementMarker position={mState.pointA} color="#00e5ff" label="A" />
        )}
        {mState.pointB && (
          <MeasurementMarker position={mState.pointB} color="#ff9f43" label="B" />
        )}
        {mState.pointA && mState.pointB && liveDistance !== null && (
          <MeasurementLine pointA={mState.pointA} pointB={mState.pointB} distance={liveDistance} />
        )}

        {state.trucks.map((t) => <TruckMesh key={t.id} truck={t} isNight={isNight} onClick={handleCanvasClick} />)}
        <PathLines trucks={state.trucks} />
        <ReservationMarkers gridRef={gridRef} tick={state.tick} />
        <DustParticles trucks={state.trucks} />
        <V2XBeams trucks={state.trucks} tick={state.tick} />
        <RockRubble gridRef={gridRef} isDemoMode={isDemoMode} onClick={handleCanvasClick} />

        {!isDemoMode && cameraView === "ADMIN" && (
          <OrbitControls
            target={[0, 2, 0]}
            enablePan
            enableZoom
            enableRotate
            minDistance={20}
            maxDistance={250}
            maxPolarAngle={Math.PI / 2.1}
          />
        )}
        <CameraRig cameraView={cameraView} trucks={state.trucks} />
      </Canvas>

      <HudOverlay
        simSpeed={simSpeed}
        onSimSpeedChange={setSimSpeed}
        metrics={state.metrics}
        trucks={state.trucks}
        events={state.events}
        showHeatmap={showHeatmap}
        onToggleHeatmap={() => setShowHeatmap((v) => !v)}
        showEmptyGrid={showEmptyGrid}
        onToggleEmptyGrid={() => setShowEmptyGrid(!showEmptyGrid)}
        cameraView={cameraView}
        onCameraViewChange={setCameraView}
        selectedMaterial={selectedMaterial}
        onSelectedMaterialChange={setSelectedMaterial}
        packingStrategy={packingStrategy}
        isNight={isNight}
        onToggleNight={() => setIsNight(!isNight)}
        gridRef={gridRef}
        isDemoMode={isDemoMode}
        onToggleDemoMode={() => setIsDemoMode(!isDemoMode)}
        fleetConfig={fleetConfig}
        onFleetConfigChange={setFleetConfig}
        measurement={{
          state: mState,
          startSelection,
          analyse,
          reset: resetMeasurement,
          clearHistory,
        }}
        dumpYard={{
          state: dumpYardState,
          startDrawing,
          undoLastVertex,
          finishPolygon,
          resetYard,
        }}
        simControl={{
          isRunning,
          startSim,
          pauseSim,
          resumeSim,
        }}
      />

      {cameraView === "FLEET" && (
        <FleetMonitors trucks={state.trucks} isNight={isNight} gridRef={gridRef} />
      )}
    </div>
  );
}
