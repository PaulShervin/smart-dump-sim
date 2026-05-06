# Problem Statement and Requirements

The problem is to autonomously **plan and fill** a mine dump polygon with earth from haul trucks at a density comparable to manual operations.  Key requirements include:  
- **No collisions or deadlocks:** Multiple trucks must dump concurrently without crashing or blocking each other.  
- **Full coverage:** The dump area must be filled completely – no “low spots” or isolated regions – while respecting truck turning radii and remaining inside the polygon.  
- **Mixed-fleet support:** Trucks of different sizes/payloads (a mixed fleet) must achieve consistent packing density regardless of arrival order.  
- **High density fill:** The pattern should approach staffed-operation spacing (≈3.0m), avoiding the gaps left by fixed “spot-point” methods.  
- **Safe access:** Trucks must not create piles that block off sections of the dump or isolate parts of the area.  

These constraints come from the ADPS problem statement.  In practice, we assume a centralized “Dump Strategy Decision Engine” (DSDE) that maintains a real-time map of the dump (an occupancy grid from LiDAR scans) and plans dump locations and paths for each truck.  

# Chosen Approaches (Production-Oriented Dumping Patterns)

We have developed two related filling strategies:

- **Mixed-Fleet Staggered-Row Method** (primary approach): A columnar/row-based algorithm with *anchor/backfill* planning to handle arbitrary truck sizes. It allocates dumping “rows” across the polygon, placing some “anchor” piles first and later backfilling the gaps. This method is optimized for maximum packing density, handles irregular shapes, and directly addresses low-spot issues.

- **Homogeneous-Fleet Columnar Strategy** (simplified variant): A faster, simpler version for single-type trucks.  It also divides the area into columns and partitions, but without the two-phase backfill scheme.  It uses the same fundamental ideas (furthest-first, staggered offsets, partitioning) but is tuned for uniform fleets and speed.

Both methods share core elements: they use **LiDAR-based occupancy grids** to know where piles already exist, a global planner to assign dump points, and path planning (A*) to steer trucks.  Below we outline each approach, the key algorithms, and how they meet – or still need to meet – the requirements.

## Mixed-Fleet Columnar Slot Method (Dynamic Staggered Rows)

In the mixed-fleet method, the dump area is divided into multiple **parallel working rows** (aligned roughly perpendicular to the entry point).  We then plan dumps in two phases:

- **Anchor phase:** In each row we place one or more “anchor” piles, leaving reserved empty slots between them.  An anchor pile is a full dump slot where a truck dumps immediately.  Leaving empty slots (gaps) between anchors ensures trucks can maneuver and avoids building a single high ridge that blocks access.  

- **Backfill phase:** After anchors are placed, we fill the reserved slots with backfill dumps.  These backfills complete the ridge by dumping the remaining material into the gaps.  

The distance between anchors is calculated based on truck sizes and safety margins.  For two trucks of effective dump radii *r<sub>i</sub>* and *r<sub>j</sub>*, with target free gap *g<sub>ij</sub>*, allowable overlap *o<sub>ij</sub>*, and a margin *m<sub>ij</sub>*, the center spacing is  
\[
d_{ij} = r_i + r_j + g_{ij} - o_{ij} + m_{ij}.
\]  
This formula dynamically adjusts for different truck sizes so that larger vehicles get proportionally larger gaps.  The gap target *g<sub>ij</sub>* can be tuned to allow trucks to dump **closer** to prior piles as their perception allows (for example, if semantic segmentation of piles is available).  

Within each row, trucks are allocated in sequence: one truck dumps at the anchor slot, then moves to the next anchor, while others may queue or fill adjacent rows.  Once all anchors in the row are done, the reserved backfill slots are filled.  This staged approach ensures that trucks always have room to enter/exit the row and that partial piles do not create dead ends.  (See **Row Zoning and Slot Reservation** in [12] for a similar approach in multi-robot coverage.)

**Crescent shift and staggering:** To improve ridge stability, we apply a slight lateral “crescent” offset to each anchor’s position.  In practice, we use a quadratic offset (~0.0035·*dy²* per row) so the stack is not perfectly straight but gently curved.  Also, adjacent rows are vertically *staggered* (i.e. anchors in row 2 are offset relative to row 1) to interlock piles, raising volumetric density. These nonstandard tweaks (crescent and staggering) come from simulation tuning; they are not common in traditional spot-based patterns but help avoid deep ravines between piles.

**Retreating-fill strategy:** We always begin filling at the **furthest** point from the entry (the “farthest corner”) and work back toward the entry.  This “furthest-first” sweep prevents trucks from stranding themselves or creating high piles that block access.  It mimics a known coverage heuristic: fill the far end of one column/row completely (anchors + backfill) before moving to the next nearest one.  

**Example:** If the dump polygon is rectangular with entry on the bottom, trucks will first place anchors along the top row (at far end), then backfill that row, then proceed to the next row down, etc., always moving closer to entry.  

This dynamic staggered-row method directly targets the **low spot** problem: because piles from neighboring trucks overlap (like overlapping Gaussians), we get a continuous ridge without gaps.  Occupancy mapping (grid) is used to verify each planned dump location is “available” (above ground clearance and inside polygon)【22†L100-L107】.  We also monitor pile slopes (for example, checking local gradients) so trucks dump only where slopes remain safe.  

#### Example diagram of row zoning (anchor/backfill): 

```
Row 4:  A   □   A   □   A   □
Row 3:    □   A   □   A   □  
Row 2:  A   □   A   □   A   □
Row 1:    □   A   □   A   □  
```

Here `A`=anchor dumps placed, `□`=reserved slots. After anchors, the `□` slots are filled in.  This pattern is planned by the server using the above spacing rules. 

## Homogeneous-Fleet Columnar Strategy (Fast Single-Fleet Version)

For the case of a homogeneous or single-type fleet, we use a simpler variant that still uses columnar packing but with a few simplifications:

- **Simple column fill:** The dump area is partitioned into vertical *columns*. Trucks fill columns one by one.  Within a column, we may divide it into horizontal *partitions* (rows).  For example, if 3 identical trucks arrive, we split the column into 3 sub-rows top-to-bottom and assign each truck a sub-row.  This avoids trucks clustering on top of each other and speeds the operation.  When a truck finishes its sub-row, it is reallocated to the same sub-row of the next column.  

- **Furthest-point dispatch:** As before, we start at the farthest column from the entry and work back.  This ensures no column is left inaccessible.  

- **Crescent and staggered fills:** We apply the same minor offsets (crescent shifts) to maintain ridge strength.  Rows are still staggered as well. However, because all trucks are the same size, we can use a fixed safe gap (e.g. ≈3–4 m) and uniform spacing in each column.  

This context-based approach (described in **context_dump.md**) omits the two-phase anchor/backfill, making it faster.  It is essentially a steady back-and-forth (boustrophedon-like) fill with each truck responsible for one partition of a column.  It still uses the occupancy grid to avoid dumping on existing piles and uses LiDAR scans to keep the map updated.  The partitioning logic is fully automated: the DSDE computes how many equal partitions fit, or the user can override the number of splits.  

**When to use which approach:** For an actual mine with mixed truck sizes and priority on density, the staggered two-phase method is best.  If the fleet is uniform and raw speed is more critical than absolute max density, the column-partition method suffices.  

# Sensors and Mapping

Our design assumes the trucks and the DSDE have rich sensing: 

- **LiDAR (3D or 2D scanning):** Each truck scans the dump surface before and after dumping.  These point clouds are fused into an **occupancy grid map**.  This grid marks each cell as free or occupied by a pile.  We use this grid both for local navigation and for dump planning: the DSDE will never assign a dump point already occupied by a pile.  In our simulation we maintain a high-resolution grid so that trucks respect a configurable *clearance* distance around existing piles【22†L100-L107】.  (In practice, continuous lidar mapping is standard in autonomous haulage for terrain modeling.)

- **GNSS/RTK positioning:** Trucks use precise GPS/inertial (RTK-GPS) to know their global position.  This lets each dump target (column/row coordinate) be expressed in world coordinates.  It ensures that the planned columns line up exactly on the map.  (The literature notes autonomous trucks often use GNSS for global localization in the yard.)

- **Radar/Ultrasonic (proximity sensors):** To avoid collisions with other vehicles or obstacles, each truck has short-range sensors.  For example, Caterpillar’s MineStar Detect uses radar to warn of nearby trucks【29†L640-L648】.  We plan each truck’s route so that proximity sensors never detect another truck in its immediate turning path.  In close-quarters (e.g. backing out of a dump), these sensors provide a final safety check.

- **Cameras/Computer Vision:** Optionally, trucks may use cameras to do semantic segmentation of piles (distinguishing dirt from empty ground).  This was mentioned in our original design: by recognizing “already dumped” vs “empty”, a truck could dump more confidently closer to previous piles.  This is not strictly required for the packing algorithm but could increase density (the sensors slide in the PDF). 

In summary, the sensor suite (LiDAR + GPS + radar + cameras) creates a robust awareness of the dump geometry and other trucks.  For example, the patent [29] notes an autonomous loader’s sensor array often includes LIDAR, radar, sonar, cameras, etc., precisely to perceive its surroundings and other vehicles【29†L640-L648】.  We leverage this to build and maintain the occupancy map (grid) and to enforce safety margins between trucks.

# Path Planning and Collision Avoidance

Once the DSDE assigns a target dump position to a truck (from the planned pattern above), we compute a safe path to that location using a standard grid-based planner (A* on the occupancy grid).  The grid is updated to reflect other trucks’ reserved goals (so that we plan disjoint paths). 

To guarantee safety, we combine **central planning with local avoidance**: the server pre-computes non-conflicting paths, and each truck’s controller uses local sensors to refine motion.  In particular:  
- **Global A\* planning:** The DSDE runs A* on the static occupancy grid to find a collision-free route.  This automatically respects the grid’s obstacles (piles) and generates a path that avoids other trucks’ planned paths as well.  
- **Temporal deconfliction (token scheme):** We implement a simple version of a “token-passing” protocol for path assignment【12†L268-L270】.  The DSDE can treat each truck’s motion plan like a time-stamped reservation.  Only when a truck is “token holder” does it finalize its path, with knowledge of others’ reserved trajectories.  This sequential planning (token) approach is known to avoid head-on conflicts in multi-robot coverage【12†L268-L270】.  
- **Turning spacing rules:** We explicitly factor each truck’s turning radius into the plan.  In the pattern layout, we space rows/columns so that trucks can always make required turns.  If two trucks approach the same narrow turn simultaneously, they use a **peer-to-peer right-of-way protocol**: effectively a handshake to decide who yields.  This is analogous to autonomous vehicles negotiating who goes first at an intersection【24†L83-L90】.  In practice we have each truck broadcast intent; one truck (by pre-defined priority or negotiation) waits while the other executes its turn, then vice versa.  This simple form of communication prevents turn-collision deadlocks.

In short, **every segment of motion is coordinated**.  Trucks are not allowed to enter an already-assigned dump cell or block another’s path, and they hand off negotiation at potential conflict points.  This cooperative planning is supported by known algorithms: for example, Cooperative A* and token-passing multi-agent planners use a shared trajectory “token” so agents plan in turn without conflicts【12†L268-L270】.  

# Sensors & Algorithm Summary

- **LiDAR → Occupancy Grid:**  The 3D scans feed a grid where each cell is marked free/occupied【22†L100-L107】.  Dump slots are chosen only in free cells.  
- **RTK-GPS → Global Coordinates:**  The planned columns/rows are defined in world coordinates; GPS ensures each dump aligns on the grid.  
- **Radar/Ultrasonic → V2V Safety:**  Short-range sensors are used as an additional collision check; trucks broadcast positions so radar alarms can be suppressed for cooperative vehicles (they can ignore each other within planned safe zones, as noted in [29]).  
- **Algorithms:** We use A* for pathfinding, plus a custom slot-selection algorithm (anchor/backfill and partitioning).  A decoupled multi-agent plan (token passing【12†L268-L270】) prevents overlapping routes.  The DSDE’s codebase (per the spec) contains all row-definition and gap constants.  In simulation, we also use continuous collision checks and allow dynamic gap tuning (<1.0 to force overlapping piles if needed).  

# Gap Analysis and Missing Pieces

So far, this combined plan **covers most requirements**:

- It ensures **concurrent dumping** without collision or deadlock (through central path scheduling + local sensor checks).  
- It fills nearly the entire polygon with controlled overlaps (tackling the low-spot issue).  
- It respects turning radii by design and uses communication to avoid turn conflicts.  
- It handles mixed fleets by sizing gaps per truck in the mixed strategy.  

However, some aspects still need attention:

- **Scalability/Fault Tolerance:** Our design relies on a central server (DSDE).  If it lags or fails, trucks should have a fallback (e.g. temporary stop or safe stash of last command).  In a full implementation, we would add redundancy (backup controllers) or a “safe-zone” fallback behavior.  
- **Unknown Obstacles:** If an unforeseen pile or obstacle appears (e.g. spilled rock), the system would replan.  The occupancy grid is updated after each dump, but spontaneous hazards would require immediate local avoidance (something like RVO or emergency stop).  
- **Precision in the Real World:** The algorithms assume precise placement. In practice, wheel slip or surveying error might require trucks to “scan and correct” before dumping.  We should use LiDAR to verify each placement (as in our PDF design) and possibly adjust.  
- **Edge Cases:** In very irregular shapes, the “furthest corner first” rule might strand a truck in a nook.  The DSDE should detect if a planned sequence is not feasible (e.g. by seeing no exit path) and alter the sweep order.  
- **Peer Protocol Robustness:** The simple wait/decide protocol for right-of-way at turns must be tested.  It may need a timeout or tie-break rule to avoid livelock if both trucks wait.  Using a consensus-based scheme【24†L83-L90】 could formalize this (e.g. priority numbers).  

Overall, our combined approach (from *dump_approach.md*, *context_dump.md*, and the sensor/algorithm docs) forms a cohesive solution. It replaces rigid spot points with a dynamic, sensor-driven packing plan.  We have identified all system components (mapping, planning, coordination) and how they interact. The remaining work is mainly to finalize edge-case handling and tune parameters (gaps, staging thresholds) for the specific dump geometry. 

# References

- Multi-robot coverage and coordination literature (e.g. token-passing path planning【12†L268-L270】, multi-robot coverage objectives【14†L48-L57】) underpins our strategy.  
- Sensor usage in autonomous haulage (LiDAR + occupancy grids【22†L100-L107】, sensor suites of Lidar/radar/camera【29†L640-L648】) informs our assumptions.  
- Cooperative vehicle communication research (e.g. distributed right-of-way protocols【24†L83-L90】) supports our handshake scheme for turning conflicts.  

