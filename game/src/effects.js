// Effects: tracers, impact sparks, the explosion, the smoke volumes and the planted
// charge, all from fixed pools, so a firefight never allocates. A tracer is a
// two-point line that lives 60 ms; a spark is a small tetra that pops and fades; the
// explosion is one expanding shell and one light.
// v2: smoke is the new star. A smoke burst grows a cluster of soft grey spheres that
// drift, swell and thin over twelve seconds — the same volume the grenade module
// reports for line-of-sight, so the picture and the simulation agree. The smoke
// spheres are seeded from the burst position (a cheap hash), never from Math.random,
// so a seeded capture replays the same cloud.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 16;
const TRACER_LIFE = 0.06;
const SPARK_COUNT = 24;
const SPARK_LIFE = 0.35;
const SMOKE_PUFFS = 9;

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  const sparks = [];
  const sparkGeometry = new THREE.TetrahedronGeometry(0.07);
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const mesh = new THREE.Mesh(sparkGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, velocity: new THREE.Vector3() });
  }

  const shellGeometry = new THREE.SphereGeometry(1, 18, 12);
  const shell = new THREE.Mesh(shellGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf7a'), transparent: true, opacity: 0, depthWrite: false }));
  shell.visible = false;
  scene.add(shell);
  const blastLight = new THREE.PointLight(new THREE.Color('#ff9a3c'), 0, 22);
  scene.add(blastLight);
  let blastLife = 0;

  // Smoke: one cluster per burst, nine puffs each. A puff is a translucent sphere
  // whose offset, drift and swell are hashed from its index and the burst centre,
  // so the cloud is deterministic for a given position.
  const smokeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b8bfc6'), roughness: 1, metalness: 0, transparent: true, opacity: 0, depthWrite: false });
  const smokeClusters = [];
  for (let c = 0; c < 3; c += 1) {
    const puffs = [];
    for (let i = 0; i < SMOKE_PUFFS; i += 1) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), smokeMaterial.clone());
      mesh.visible = false;
      scene.add(mesh);
      puffs.push({ mesh, offset: new THREE.Vector3(), drift: new THREE.Vector3(), size: 1 });
    }
    smokeClusters.push({ puffs, life: 0, maxLife: 12, center: new THREE.Vector3() });
  }

  function hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function smokeBurst(position, radius) {
    let cluster = smokeClusters.find((entry) => entry.life <= 0);
    if (!cluster) cluster = smokeClusters[0];
    cluster.center.copy(position);
    cluster.center.y = Math.max(0.8, position.y);
    cluster.life = cluster.maxLife;
    for (let i = 0; i < cluster.puffs.length; i += 1) {
      const puff = cluster.puffs[i];
      const seed = position.x * 3.1 + position.z * 7.7 + i * 13.7;
      puff.offset.set((hash(seed) - 0.5) * radius * 1.4, (hash(seed + 1) - 0.5) * 1.6 + 0.6, (hash(seed + 2) - 0.5) * radius * 1.4);
      puff.drift.set((hash(seed + 3) - 0.5) * 0.5, 0.12 + hash(seed + 4) * 0.25, (hash(seed + 5) - 0.5) * 0.5);
      puff.size = radius * (0.45 + hash(seed + 6) * 0.45);
      puff.mesh.visible = true;
    }
  }

  // The planted charge: a small blinking box that sits on a site until it is defused
  // or blows. Its light blinks faster as the fuse runs down.
  const chargeGroup = new THREE.Group();
  const chargeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(PALETTE.danger), emissiveIntensity: 0.4 }),
  );
  const chargeLight = new THREE.PointLight(new THREE.Color(PALETTE.danger), 0, 8);
  chargeLight.position.y = 0.4;
  chargeGroup.add(chargeBody, chargeLight);
  chargeGroup.visible = false;
  scene.add(chargeGroup);
  let chargeBlink = 0;

  function fireTracer(from, to) {
    let tracer = tracers.find((entry) => entry.life <= 0);
    if (!tracer) tracer = tracers[0];
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x;
    positions[1] = from.y;
    positions[2] = from.z;
    positions[3] = to.x;
    positions[4] = to.y;
    positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.material.opacity = 0.85;
    tracer.life = TRACER_LIFE;
  }

  function spark(point) {
    const entry = sparks.find((item) => item.life <= 0) ?? sparks[0];
    entry.mesh.position.copy(point);
    entry.mesh.visible = true;
    entry.mesh.material.opacity = 1;
    entry.mesh.scale.setScalar(1);
    // Deterministic scatter from the impact point, so a seeded replay matches.
    const seed = point.x * 12.9 + point.y * 78.2 + point.z * 37.7;
    entry.velocity.set((hash(seed) - 0.5) * 3, hash(seed + 1) * 3, (hash(seed + 2) - 0.5) * 3);
    entry.life = SPARK_LIFE;
  }

  function explosion(point) {
    shell.position.copy(point);
    shell.scale.setScalar(0.5);
    shell.visible = true;
    shell.material.opacity = 0.9;
    blastLight.position.copy(point);
    blastLight.position.y += 1;
    blastLight.intensity = 60;
    blastLife = 0.5;
  }

  function showCharge(position) {
    chargeGroup.position.copy(position);
    chargeGroup.position.y = 0.14;
    chargeGroup.visible = true;
    chargeBlink = 0;
  }

  function hideCharge() {
    chargeGroup.visible = false;
    chargeLight.intensity = 0;
  }

  function step(dt, time) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, (tracer.life / TRACER_LIFE) * 0.85);
    }
    for (const entry of sparks) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      entry.mesh.position.addScaledVector(entry.velocity, dt);
      entry.velocity.y -= 6 * dt;
      entry.mesh.material.opacity = Math.max(0, entry.life / SPARK_LIFE);
      entry.mesh.scale.setScalar(Math.max(0.1, entry.life / SPARK_LIFE));
      if (entry.life <= 0) entry.mesh.visible = false;
    }
    if (blastLife > 0) {
      blastLife -= dt;
      const progress = 1 - Math.max(0, blastLife) / 0.5;
      shell.scale.setScalar(0.5 + progress * 6.5);
      shell.material.opacity = Math.max(0, 0.9 * (1 - progress));
      blastLight.intensity = Math.max(0, 60 * (1 - progress));
      if (blastLife <= 0) shell.visible = false;
    }
    for (const cluster of smokeClusters) {
      if (cluster.life <= 0) continue;
      cluster.life -= dt;
      const age = cluster.maxLife - Math.max(0, cluster.life);
      const grow = Math.min(1, age / 1.5);
      const fade = Math.min(1, Math.max(0, cluster.life) / 3);
      for (const puff of cluster.puffs) {
        if (cluster.life <= 0) {
          puff.mesh.visible = false;
          continue;
        }
        puff.mesh.position.set(
          cluster.center.x + puff.offset.x + puff.drift.x * age,
          cluster.center.y + puff.offset.y + puff.drift.y * age,
          cluster.center.z + puff.offset.z + puff.drift.z * age,
        );
        puff.mesh.scale.setScalar(Math.max(0.1, puff.size * (0.5 + grow * 0.8)));
        puff.mesh.material.opacity = 0.55 * grow * fade;
      }
    }
    if (chargeGroup.visible) {
      chargeBlink += dt;
      chargeLight.intensity = Math.sin(chargeBlink * 12) > 0 ? 10 : 0;
    }
  }

  return { fireTracer, spark, explosion, showCharge, hideCharge, smokeBurst, step };
}
