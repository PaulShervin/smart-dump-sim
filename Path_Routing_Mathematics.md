# Path Routing and Navigation Framework

This document outlines the mathematical and algorithmic framework used for path routing within the autonomous dump simulation. The system ensures collision-free, kinematically feasible, and efficient movement of haul trucks through three primary components: **Occupancy Mapping**, **Hybrid A* Search**, and **4D Space-Time Reservation**.

---

## 1. Occupancy Map (Grid-Based Terrain Model)

The simulation environment is represented by a high-resolution occupancy grid that acts as the foundation for both dumping strategy and navigation.

### Technical Specifications
- **Resolution**: 1 cell ≈ 2.0m (optimized for truck dimensions and computational efficiency).
- **Data Attributes**: Each cell stores `height`, `slope`, `occupied` (static obstacle), and `reserved` (dynamic reservation).
- **Accessibility**: A cell is considered traversable if its slope is below the safety threshold ($\text{SLOPE\_LIMIT} \approx 0.85$) and it is not occupied by a pile.

### Dynamic Updates
As trucks deposit material, the `height` and `slope` values are updated in real-time. The occupancy map is recalculated locally around dump sites to reflect the new terrain geometry, ensuring that subsequent paths bypass newly created piles.

---

## 2. Hybrid A* Pathfinding

While standard A* finds the shortest path on a discrete grid, **Hybrid A*** is employed to generate paths that respect the physical constraints (kinematics) of the haul trucks.

### Kinematic Constraints
Haul trucks have a finite turning radius and cannot move sideways. Hybrid A* searches the continuous state space $(x, y, \theta)$ while using the discrete occupancy grid for heuristic guidance.

### Cost Function
The search algorithm minimizes a multi-objective cost function $J$:
$$J = g(n) + h(n) + P_{slope} + P_{height}$$

Where:
- **$g(n)$**: Distance traveled from the start.
- **$h(n)$**: Heuristic (Euclidean distance or Reed-Shepp curves).
- **$P_{slope}$**: Penalty for traversing steep inclines to prioritize flatter, safer routes.
- **$P_{height}$**: A massive penalty for driving over existing dumps to prevent damage or instability.

---

## 3. 4D Reservation System (Space-Time Deconfliction)

To enable multiple trucks to operate concurrently without collisions or deadlocks, the system utilizes a **4D Reservation** (x, y, z, t) scheme.

### Temporal Dimension
Each cell in the occupancy grid includes a `reservedUntil` timestamp. When a truck plans a path, it doesn't just check for static obstacles; it checks if a cell is reserved by another truck at the specific time it intends to arrive.

### Deconfliction Logic
1. **Path Reservation**: Once a path is calculated, the DSDE (Dump Strategy Decision Engine) "locks" the cells along that path for the expected duration of the truck's transit.
2. **Sequential Planning**: Trucks plan their routes in sequence (Token-Passing). Truck B will treat Truck A's planned path as a dynamic obstacle.
3. **Collision Avoidance**: If a conflict is detected at a specific time-step $t$, the planner will either:
   - Wait at the current cell until the reservation expires.
   - Calculate an alternative route that avoids the reserved space-time volume.

### Deadlock Prevention
By treating time as a fourth dimension, the system avoids "head-on" deadlocks where two trucks block each other indefinitely. The centralized reservation system ensures that one truck always yields or reroutes based on global priority.

---

## 4. Implementation Summary

| Component | Function | Key Algorithm |
| :--- | :--- | :--- |
| **Occupancy Map** | Environment Representation | LiDAR Point-Cloud Fusion |
| **Path Planning** | Feasible Route Generation | Hybrid A* (Kinematic-aware) |
| **Coordination** | Multi-truck Deconfliction | 4D Space-Time Reservation |
