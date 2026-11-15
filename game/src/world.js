// Rustyard v2: EMBERLINE's map, a decommissioned freight yard at dusk, built from boxes.
// Attackers (Ember, amber) spawn south and push north to one of two sites; defenders
// (Slate, teal) spawn north and hold them. Three named lanes run the length of the yard
// — West Alley, Mid Yard and East Alley — split by container stacks and crate cover, so
// every approach has corners, sightlines and a place to stop and aim.
// v2 changes, in the order the study asked for them:
//  - LIGHT: the round-1 yard photographed dark and flat. The sun is stronger, the
//    hemisphere fill is brighter, the sky is a lighter dusk blue and the fog sits
//    farther out, so the scene reads at a glance and the amber/teal teams pop.
//  - SITE DRESSING: Site A is an amber warehouse corner (warm crates, a big painted
//    "A — WAREHOUSE" sign, amber floodlights); Site B is a teal dock (cool crates, a
//    "B — DOCK" sign, teal floods, a silo and a mooring bollard row).
//  - PROPS AND TRIM: barrels, pallets, tyre stacks, hazard stripes on the lane edges,
//    painted lane names on the ground and a distant skyline, so no sightline is empty
//    brown boxes.
//  - VERTICALITY: a low walkway crosses Mid Yard north (0.9 m deck, stepped up from
//    the south) with a sightline over the mid crates; the crate stacks beside it are
//    climbable by jumping crate to crate.
// Every box is both a collider and a surface a bullet stops on. Waypoints form the graph
// bots path over; sites are the boxes a charge may be planted inside.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints: [x, z, ...neighbour indices]. Laid over the lanes, the sites and both spawns.
const WAYPOINTS = [
  [0, 15], // 0 ember spawn
  [-8, 13], // 1
  [8, 13], // 2
  [-14, 9], // 3 west alley
  [0, 9], // 4 mid yard south
  [14, 9], // 5 east alley
  [-14, 3], // 6
  [-6, 3], // 7
  [6, 3], // 8
  [14, 3], // 9
  [-14, -3], // 10
  [-6, -3], // 11
  [6, -3], // 12
  [14, -3], // 13
  [-15, -9], // 14 site A approach
  [-7, -9], // 15
  [7, -9], // 16
  [15, -9], // 17 site B approach
  [-15, -14], // 18 site A
  [0, -13], // 19 mid north
  [15, -14], // 20 site B
  [0, -16], // 21 slate spawn
  [-8, -15], // 22
  [8, -15], // 23
  [-14, -13], // 24 site A west
  [14, -13], // 25 site B east
];
const EDGES = [
  [0, 1], [0, 2], [0, 4],
  [1, 3], [1, 4], [2, 4], [2, 5],
  [3, 6], [4, 6], [4, 7], [4, 8], [5, 8], [5, 9],
  [6, 10], [7, 10], [7, 11], [8, 11], [8, 12], [9, 12], [9, 13],
  [10, 14], [11, 14], [11, 15], [12, 15], [12, 16], [13, 16], [13, 17],
  [14, 18], [14, 24], [15, 19], [16, 19], [17, 20], [17, 25],
  [18, 24], [19, 21], [19, 22], [19, 23], [20, 25],
  [21, 22], [21, 23], [22, 24], [23, 25],
  [6, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17],
];

// The named lanes, for the minimap labels and the HUD plan line.
export const LANES = [
  { name: 'WEST ALLEY', x: -14, z: 6 },
  { name: 'MID YARD', x: 0, z: 6 },
  { name: 'EAST ALLEY', x: 14, z: 6 },
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const siteAMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.1, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.35 });
  const siteBMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.slate), roughness: 0.5, metalness: 0.1, emissive: new THREE.Color(PALETTE.slate), emissiveIntensity: 0.35 });
  const hazardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8a13a'), roughness: 0.8, metalness: 0.05 });
  const barrelAmber = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.warehouse), roughness: 0.6, metalness: 0.25 });
  const barrelTeal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dock), roughness: 0.6, metalness: 0.25 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#15181d'), roughness: 0.95, metalness: 0 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collider = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material] ?? material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collider) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Painted text, drawn on a canvas and put on a plane: the yard's own signage, made
  // in code — no image files, no network. One canvas per sign, drawn once at boot.
  function sign(text, sub, width, height, fg, bg) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 160);
    ctx.fillStyle = fg;
    ctx.font = 'bold 92px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 62);
    ctx.font = 'bold 34px monospace';
    ctx.fillText(sub, 256, 126);
    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
    group.add(mesh);
    return mesh;
  }

  function groundLabel(text, x, z, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 52px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 48);
    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 1.3),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.03, z);
    group.add(mesh);
    return mesh;
  }

  // Ground and the yard wall: 44 x 36 m, 5 m walls, open sky so the dusk sun reaches in.
  box(46, 0.4, 38, 0, -0.2, 0, 'yardFloor');
  box(0.4, 5, 38, -22.2, 2.5, 0, 'yardWall');
  box(0.4, 5, 38, 22.2, 2.5, 0, 'yardWall');
  box(46, 5, 0.4, 0, 2.5, -18.2, 'yardWall');
  box(46, 5, 0.4, 0, 2.5, 18.2, 'yardWall');

  // Painted lane lines on the ground (flat, no collision) plus hazard stripes where
  // the lanes meet the sites, so the map reads as a working yard, not a grey box.
  box(0.3, 0.02, 30, -14, 0.02, 0, 'accent', false).material = materials.accent;
  box(0.3, 0.02, 30, 14, 0.02, 0, 'slate', false).material = materials.slate;
  for (let i = 0; i < 6; i += 1) {
    box(0.5, 0.02, 0.5, -17 + i * 0.9, 0.02, -11, i % 2 === 0 ? hazardMat : materials.yardFloor, false);
    box(0.5, 0.02, 0.5, 12.5 + i * 0.9, 0.02, -11, i % 2 === 0 ? hazardMat : materials.yardFloor, false);
  }
  groundLabel('WEST ALLEY', -14, 12.5, '#f5a52e');
  groundLabel('MID YARD', 0, 12.5, '#ece7db');
  groundLabel('EAST ALLEY', 14, 12.5, '#45c4b2');

  // Site markers: a glowing floor plate at each site, amber A and teal B.
  const plateA = new THREE.Mesh(new THREE.BoxGeometry(5, 0.06, 5), siteAMaterial);
  plateA.position.set(-15, 0.03, -14);
  plateA.receiveShadow = true;
  group.add(plateA);
  const plateB = new THREE.Mesh(new THREE.BoxGeometry(5, 0.06, 5), siteBMaterial);
  plateB.position.set(15, 0.03, -14);
  plateB.receiveShadow = true;
  group.add(plateB);

  // Site signage on the north wall, facing the yard: the first thing a player sees
  // when they push up a lane.
  const signA = sign('A', 'WAREHOUSE', 6, 1.9, '#1a2233', '#f5a52e');
  signA.position.set(-15, 3.6, -17.95);
  const signB = sign('B', 'DOCK', 6, 1.9, '#0d2b30', '#45c4b2');
  signB.position.set(15, 3.6, -17.95);
  const signMid = sign('RUSTYARD', 'FREIGHT TERMINAL 7', 9, 1.6, '#ece7db', '#2b313a');
  signMid.position.set(0, 3.8, 17.95);
  signMid.rotation.y = Math.PI;

  // Container stacks: the yard's cover. Each stack is two or three boxes; the top box of
  // a stack is climbable only by jumping from a crate, never by walking.
  // West alley containers.
  box(6, 2.6, 2.6, -17, 1.3, 6, 'containerA');
  box(6, 2.6, 2.6, -17, 1.3, -1, 'containerB');
  box(6, 2.6, 2.6, -17, 3.9, 6, 'containerC');
  // East alley containers.
  box(6, 2.6, 2.6, 17, 1.3, 6, 'containerB');
  box(6, 2.6, 2.6, 17, 1.3, -1, 'containerC');
  box(6, 2.6, 2.6, 17, 3.9, -1, 'containerA');
  // Mid yard: a central block that splits the lane, with a low crate to crouch behind.
  box(4.4, 2.6, 2.6, -3, 1.3, 3.5, 'containerC');
  box(4.4, 2.6, 2.6, 3, 1.3, -3.5, 'containerA');
  box(2.2, 1.1, 1.4, 0, 0.55, 8.5, 'crate');
  box(2.2, 1.1, 1.4, 0, 0.55, -8.5, 'crate');
  // Site A cover — the amber warehouse corner: warm crates and a barrel cluster.
  box(6, 2.6, 2.6, -19, 1.3, -11, 'containerB');
  box(2.2, 1.1, 1.4, -11.5, 0.55, -11.5, 'crate');
  box(1.4, 1.1, 2.2, -15, 0.55, -9.5, 'crate');
  box(6, 2.6, 2.6, -10, 1.3, -16.5, 'containerC');
  // Site B cover — the teal dock: cool crates, a silo and mooring bollards.
  box(6, 2.6, 2.6, 19, 1.3, -11, 'containerA');
  box(2.2, 1.1, 1.4, 11.5, 0.55, -11.5, 'crate');
  box(1.4, 1.1, 2.2, 15, 0.55, -9.5, 'crate');
  box(6, 2.6, 2.6, 10, 1.3, -16.5, 'containerB');
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 6.5, 18), materials.yardWall);
  silo.position.set(19.5, 3.25, -16.5);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3().setFromObject(silo));
  shootables.push(silo);
  // Spawn cover: low crates each side so a spawn peek is never a free kill.
  box(2.2, 1.1, 1.4, -6, 0.55, 14.5, 'crate');
  box(2.2, 1.1, 1.4, 6, 0.55, 14.5, 'crate');
  box(2.2, 1.1, 1.4, -6, 0.55, -14.5, 'crate');
  box(2.2, 1.1, 1.4, 6, 0.55, -14.5, 'crate');

  // The walkway: a 0.9 m deck crossing Mid Yard north, reached by two steps from the
  // south. From the deck a player sees over the mid crates and down both site lanes;
  // the deck is a collider, so it is real cover and a real firing position, not decor.
  box(6, 0.25, 2.4, 0, 0.78, -6.5, 'walkway');
  box(6, 0.9, 0.25, 0, 0.45, -5.3, 'walkway');
  box(2.2, 0.3, 1.2, -2, 0.15, -4.6, 'walkway');
  box(2.2, 0.6, 1.2, -2, 0.3, -5.4, 'walkway');
  box(6, 0.9, 0.25, 0, 0.45, -7.7, 'walkway');
  // Climbable crate stacks beside the walkway: crate, crate, container top.
  box(1.4, 1.1, 1.4, -6.5, 0.55, -6.5, 'crate');
  box(1.4, 1.1, 1.4, -6.5, 1.65, -6.5, 'crate');
  box(1.4, 1.1, 1.4, 6.5, 0.55, -6.5, 'crate');
  box(1.4, 1.1, 1.4, 6.5, 1.65, -6.5, 'crate');

  // Props: barrels, pallets and tyre stacks scattered as low cover and dressing.
  function barrel(x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14), material);
    mesh.position.set(x, 0.53, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
  }
  barrel(-12.5, -12.5, barrelAmber);
  barrel(-11.6, -12.9, barrelAmber);
  barrel(12.5, -12.5, barrelTeal);
  barrel(11.6, -12.9, barrelTeal);
  barrel(-9, 5.5, barrelTeal);
  barrel(9, 5.5, barrelAmber);
  barrel(-19.5, 2, barrelAmber);
  barrel(19.5, 2, barrelTeal);
  function tyres(x, z) {
    for (let i = 0; i < 3; i += 1) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.24, 14), tyreMat);
      mesh.position.set(x, 0.12 + i * 0.24, z);
      mesh.castShadow = true;
      group.add(mesh);
    }
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.42, 0, z - 0.42), new THREE.Vector3(x + 0.42, 0.72, z + 0.42)));
  }
  tyres(-10, -5);
  tyres(10, -5);
  tyres(-4, 12);
  tyres(4, 12);
  // Flat pallets: dressing only, no collision, so they never snag a strafe.
  function pallet(x, z, rotation) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1.2), materials.crate);
    mesh.position.set(x, 0.06, z);
    mesh.rotation.y = rotation;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  pallet(-13, 0, 0.3);
  pallet(13, 0, -0.4);
  pallet(-2, -12, 0.1);
  pallet(2, -12, -0.2);

  // Distant skyline silhouettes outside the wall, so the horizon is not flat fog.
  for (let i = 0; i < 9; i += 1) {
    const height = 6 + ((i * 37) % 9);
    const skyline = new THREE.Mesh(new THREE.BoxGeometry(5, height, 3), materials.canvas);
    skyline.position.set(-36 + i * 9, height / 2 - 0.5, -30 - ((i * 13) % 6));
    group.add(skyline);
  }
  // Two floodlight masts outside the walls, so the yard's glow has a source.
  for (const [mx, mz] of [[-24, -10], [24, -10]]) {
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.3, 9, 0.3), materials.yardWall);
    mast.position.set(mx, 4.5, mz);
    group.add(mast);
  }

  // Light: a high amber sun from the west, a bright hemisphere so shadows never go
  // black, a cool fill from the east, and a floodlight over each site in its own colour.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8fa3c0'), new THREE.Color('#4a3f30'), 1.35);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffc06a'), 3.4);
  sun.position.set(-26, 16, 10);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#8fd0c4'), 0.9);
  fill.position.set(20, 10, -14);
  scene.add(fill);
  const siteLightA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 30, 14);
  siteLightA.position.set(-15, 3.6, -14);
  scene.add(siteLightA);
  const siteLightB = new THREE.PointLight(new THREE.Color(PALETTE.slate), 30, 14);
  siteLightB.position.set(15, 3.6, -14);
  scene.add(siteLightB);
  const midLight = new THREE.PointLight(new THREE.Color('#ffd9a0'), 18, 12);
  midLight.position.set(0, 4.2, -6.5);
  scene.add(midLight);

  // Waypoint graph, built once: adjacency lists by index.
  const adjacency = WAYPOINTS.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  // Breadth-first shortest path between waypoints; returns indices, start to goal.
  function findPath(start, goal) {
    if (start === goal) return [start];
    const previous = new Array(WAYPOINTS.length).fill(-1);
    const queue = [start];
    previous[start] = start;
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adjacency[current]) {
        if (previous[next] !== -1) continue;
        previous[next] = current;
        if (next === goal) {
          const path = [goal];
          let node = goal;
          while (node !== start) {
            node = previous[node];
            path.unshift(node);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [start];
  }

  function nearestWaypoint(x, z) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const dx = WAYPOINTS[i][0] - x;
      const dz = WAYPOINTS[i][1] - z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  // Which named lane a point sits in: west of -7 is West Alley, east of 7 is East
  // Alley, the middle is Mid Yard. Used for radio callouts and the HUD plan line.
  function laneAt(x, z) {
    if (x < -7) return 'West Alley';
    if (x > 7) return 'East Alley';
    return 'Mid Yard';
  }

  return {
    colliders,
    shootables,
    group,
    waypoints: WAYPOINTS,
    findPath,
    nearestWaypoint,
    laneAt,
    sites: {
      A: { name: 'A', center: new THREE.Vector3(-15, 0, -14), box: new THREE.Box3(new THREE.Vector3(-17.5, 0, -16.5), new THREE.Vector3(-12.5, 3, -11.5)) },
      B: { name: 'B', center: new THREE.Vector3(15, 0, -14), box: new THREE.Box3(new THREE.Vector3(12.5, 0, -16.5), new THREE.Vector3(17.5, 3, -11.5)) },
    },
    spawns: {
      ember: [[-8, 15], [-4, 16], [0, 15], [4, 16], [8, 15]],
      slate: [[-8, -15], [-4, -16], [0, -15], [4, -16], [8, -15]],
    },
    bounds: { minX: -21.5, maxX: 21.5, minZ: -17.5, maxZ: 17.5 },
  };
}
