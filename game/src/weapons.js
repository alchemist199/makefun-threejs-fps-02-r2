// Weapons: the buy menu's catalogue and the view model in the player's hands.
// Every weapon is hitscan with its own damage, fire rate, spread and recoil, so stopping
// to aim pays and spraying on the move does not. A grenade is a thrown body with a fuse,
// not a hitscan shot: it arcs, bounces once and bursts.
// Damage falls off past the weapon's range; a headshot multiplies it.
// v2: two new buys. The Longbow-8 scoped rifle (hold right mouse to aim down its scope:
// the view zooms, the crosshair hides behind a scope ring, spread collapses and the
// mouse steadies) and the Greyveil smoke grenade (no damage — it blooms into a smoke
// volume that blocks line of sight for both teams). The view models are rebuilt bigger
// and brighter than round 1's, with a handguard, a front sight, a magazine and a
// gloved hand on the grip, so the rifle reads in frame instead of vanishing into the
// dark; the muzzle flash is a cross-shaped plane plus a real point light.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sparrow', kind: 'pistol', price: 0, damage: 26, headMult: 3.5, mag: 12, reserve: 48, gap: 0.16, auto: false, reload: 1.4, spreadStill: 0.003, spreadMove: 0.02, recoil: 0.006, range: 45, zoom: 1 },
  smg: { id: 'smg', name: 'Hornet-9', kind: 'smg', price: 900, damage: 22, headMult: 3, mag: 30, reserve: 120, gap: 0.075, auto: true, reload: 1.7, spreadStill: 0.006, spreadMove: 0.034, recoil: 0.005, range: 34, zoom: 1 },
  rifle: { id: 'rifle', name: 'Kestrel-7', kind: 'rifle', price: 1600, damage: 34, headMult: 3.5, mag: 30, reserve: 90, gap: 0.105, auto: true, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.009, range: 60, zoom: 1.35 },
  scoped: { id: 'scoped', name: 'Longbow-8', kind: 'scoped', price: 2700, damage: 82, headMult: 3, mag: 5, reserve: 20, gap: 0.9, auto: false, reload: 2.8, spreadStill: 0.0006, spreadMove: 0.032, recoil: 0.028, range: 90, zoom: 2.4, scope: true },
  dmr: { id: 'dmr', name: 'Falcon-12', kind: 'dmr', price: 2400, damage: 70, headMult: 3, mag: 10, reserve: 30, gap: 0.55, auto: false, reload: 2.4, spreadStill: 0.0008, spreadMove: 0.03, recoil: 0.02, range: 80, zoom: 1.6 },
};
export const GRENADE = { id: 'grenade', name: 'Flashburst', price: 300, radius: 6.5, maxDamage: 95, fuse: 1.6 };
export const SMOKE = { id: 'smoke', name: 'Greyveil smoke', price: 250, radius: 4.5, fuse: 1.2, life: 12 };
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'scoped', 'dmr'];

const MUZZLE_TIME = 0.07;

export function createWeapons(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a5148'), roughness: 0.75, metalness: 0.15 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23272e'), roughness: 0.45, metalness: 0.45 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.25, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.35 });
  const steelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a929c'), roughness: 0.3, metalness: 0.7 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a2c17'), roughness: 0.9, metalness: 0 });
  const lensMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d2b30'), roughness: 0.15, metalness: 0.4, emissive: new THREE.Color(PALETTE.slate), emissiveIntensity: 0.5 });

  // One view model per weapon, built from boxes; only the equipped one is visible.
  // The model sits low-right of the camera, big enough to read at a glance, with a
  // gloved hand wrapped on the grip so it reads as held, not floating.
  const models = {};
  function buildModel(def) {
    const model = new THREE.Group();
    const length = def.kind === 'pistol' ? 0.26 : def.kind === 'smg' ? 0.4 : def.kind === 'scoped' || def.kind === 'dmr' ? 0.66 : 0.54;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, length), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, length * 0.72), steelMat);
    barrel.position.set(0, 0.03, -length * 0.62);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, length * 0.42), gripMat);
    handguard.position.set(0, 0.01, -length * 0.28);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.22), gripMat);
    stock.position.set(0, -0.02, length * 0.5);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.06, 0.015), accentMat);
    sight.position.set(0, 0.085, -length * 0.42);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.09), gripMat);
    grip.position.set(0, -0.11, 0.06);
    grip.rotation.x = 0.35;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.11), gloveMat);
    hand.position.set(0, -0.1, 0.06);
    model.add(receiver, barrel, handguard, stock, sight, grip, hand);
    if (def.kind === 'scoped') {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 12), bodyMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.1, -0.02);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 12), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 0.1, -0.125);
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.06), steelMat);
      mount.position.set(0, 0.07, -0.02);
      model.add(tube, lens, mount);
    }
    if (def.kind === 'dmr') {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.18), accentMat);
      scope.position.set(0, 0.1, -0.02);
      model.add(scope);
    }
    if (def.kind === 'smg' || def.kind === 'rifle' || def.kind === 'scoped') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.09), gripMat);
      mag.position.set(0, -0.13, -0.06);
      mag.rotation.x = 0.12;
      model.add(mag);
    }
    if (def.kind === 'rifle' || def.kind === 'scoped') {
      const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.08), gloveMat);
      foregrip.position.set(0, -0.09, -length * 0.3);
      model.add(foregrip);
    }
    model.position.set(0.26, -0.24, -0.5);
    model.visible = false;
    camera.add(model);
    return model;
  }
  for (const id of WEAPON_ORDER) models[id] = buildModel(WEAPONS[id]);

  // Muzzle flash: two crossed planes plus a point light, so a shot reads even in a
  // still screenshot — the flash is what makes the play shot look like a firefight.
  // The planes carry a radial-gradient texture (bright core, transparent edge) so
  // the flash reads as light, not as a solid board floating in front of the gun.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 128;
  flashCanvas.height = 128;
  const flashCtx = flashCanvas.getContext('2d');
  const gradient = flashCtx.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255, 240, 200, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 190, 90, 0.9)');
  gradient.addColorStop(1, 'rgba(255, 160, 60, 0)');
  flashCtx.fillStyle = gradient;
  flashCtx.fillRect(0, 0, 128, 128);
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture, color: new THREE.Color('#ffd27a'), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  const flashA = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  const flashB = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  flashB.rotation.z = Math.PI / 2;
  flash.add(flashA, flashB);
  flash.position.set(0.26, -0.19, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffb45e'), 0, 7);
  flashLight.position.set(0.26, -0.17, -0.7);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    owned: { pistol: true },
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
    smokes: 0,
    aiming: false,
    aimBlend: 0,
  };

  function def() {
    return WEAPONS[state.current];
  }

  function showModel() {
    for (const id of WEAPON_ORDER) models[id].visible = id === state.current;
  }
  showModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    // ADS eases in over ~0.12 s: the model slides to the centre and the camera
    // zoom follows the same blend, so the transition is one smooth motion.
    const target = state.aiming ? 1 : 0;
    state.aimBlend += (target - state.aimBlend) * Math.min(1, dt * 14);
    if (Math.abs(state.aimBlend - target) < 0.01) state.aimBlend = target;
    const model = models[state.current];
    const blend = state.aimBlend;
    model.position.x = 0.26 - blend * 0.26;
    model.position.y = -0.24 + blend * 0.055;
    model.position.z = -0.5 + state.kick - blend * 0.08;
    model.rotation.x = state.kick * 2.2;
    // A scoped rifle sighted fully in hides its own view model: the scope ring is
    // the sight picture now, and the rifle mesh would only block the middle.
    model.visible = !(blend > 0.92 && def().scope);
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 40;
    flash.scale.setScalar(0.8 + (1 - state.flash / MUZZLE_TIME) * 0.5);
    flashLight.intensity = state.flash > 0 ? 22 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / def().reload;
      model.rotation.x = -0.55 * Math.min(1, progress * 2);
      model.rotation.z = 0.35 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const need = def().mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    def,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055 + (def().scope ? 0.05 : 0);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return false;
      state.reloadLeft = d.reload;
      return true;
    },
    spread(speed) {
      const d = def();
      const base = d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove;
      // ADS tightens the cone to a third; a scoped rifle sighted in is a laser.
      return state.aiming ? base * 0.33 : base;
    },
    damageAt(distance, part) {
      const d = def();
      const falloff = distance > d.range ? Math.max(0.45, 1 - (distance - d.range) / d.range) : 1;
      const base = d.damage * falloff;
      return part === 'head' ? base * d.headMult : base;
    },
    // The camera zoom for the current weapon and ADS blend: 74 deg hip, down to
    // ~31 deg for a fully sighted Longbow-8.
    fov(baseFov) {
      const d = def();
      return baseFov - (baseFov - baseFov / d.zoom) * state.aimBlend;
    },
    equip(id) {
      if (!state.owned[id]) return false;
      state.current = id;
      state.mag = WEAPONS[id].mag;
      state.reserve = WEAPONS[id].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.aiming = false;
      showModel();
      return true;
    },
    // Buying keeps the pistol as a fallback; a bought weapon replaces the current one.
    buy(id) {
      if (state.owned[id]) return false;
      state.owned[id] = true;
      this.equip(id);
      return true;
    },
    buyGrenade() {
      if (state.grenades >= 1) return false;
      state.grenades = 1;
      return true;
    },
    buySmoke() {
      if (state.smokes >= 1) return false;
      state.smokes = 1;
      return true;
    },
    refill() {
      state.current = 'pistol';
      state.owned = { pistol: true };
      state.mag = WEAPONS.pistol.mag;
      state.reserve = WEAPONS.pistol.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.grenades = 0;
      state.smokes = 0;
      state.aiming = false;
      state.aimBlend = 0;
      showModel();
    },
    // A fresh round keeps what was bought; only the magazines are topped up.
    restock() {
      const d = def();
      state.mag = d.mag;
      state.reserve = d.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
    },
  };
}

// Grenades: a small pool of thrown bodies. Gravity pulls, walls bounce once, the fuse
// pops the burst. The pool is fixed size, so throwing never allocates mid-frame.
// v2: two kinds share the pool. A frag bursts with damage (onExplode); a smoke pops
// into a lingering volume (onSmoke) that blocks line of sight until it thins out.
// The live volumes are kept here, in one place, so bots, the player and the renderer
// all ask the same question: does this segment cross smoke?
export function createGrenades(scene, colliders, onExplode, onSmoke) {
  const pool = [];
  const fragGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const fragMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.4 });
  const smokeGeometry = new THREE.SphereGeometry(0.1, 10, 8);
  const smokeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#9aa5ad'), roughness: 0.9, metalness: 0 });
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(fragGeometry, fragMaterial);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, active: false, kind: 'frag', position: new THREE.Vector3(), velocity: new THREE.Vector3(), fuse: 0, bounced: false });
  }

  const volumes = [];
  const scratch = new THREE.Vector3();
  const segScratch = new THREE.Vector3();

  function throwFrom(origin, direction, kind) {
    const slot = pool.find((entry) => !entry.active);
    if (!slot) return false;
    slot.active = true;
    slot.kind = kind;
    slot.mesh.material = kind === 'smoke' ? smokeMaterial : fragMaterial;
    slot.position.copy(origin);
    slot.velocity.copy(direction).multiplyScalar(13);
    slot.velocity.y += 3.2;
    slot.fuse = kind === 'smoke' ? SMOKE.fuse : GRENADE.fuse;
    slot.bounced = false;
    slot.mesh.visible = true;
    slot.mesh.position.copy(origin);
    return true;
  }

  // A segment crosses a smoke volume when it passes within the volume's radius of
  // its centre — the standard closest-point-on-segment test, no allocation.
  function blocksSight(from, to) {
    for (const volume of volumes) {
      if (volume.life <= 0) continue;
      segScratch.copy(to).sub(from);
      const lengthSq = segScratch.lengthSq();
      if (lengthSq === 0) continue;
      const t = Math.max(0, Math.min(1, scratch.copy(volume.position).sub(from).dot(segScratch) / lengthSq));
      const closestX = from.x + segScratch.x * t;
      const closestY = from.y + segScratch.y * t;
      const closestZ = from.z + segScratch.z * t;
      const dx = volume.position.x - closestX;
      const dy = volume.position.y - closestY;
      const dz = volume.position.z - closestZ;
      if (dx * dx + dy * dy + dz * dz < volume.radius * volume.radius) return true;
    }
    return false;
  }

  function addVolume(position) {
    volumes.push({ position: position.clone(), radius: SMOKE.radius, life: SMOKE.life });
    if (volumes.length > 3) volumes.shift();
    onSmoke(position, SMOKE.radius);
  }

  function step(dt) {
    for (const volume of volumes) volume.life -= dt;
    for (let i = volumes.length - 1; i >= 0; i -= 1) {
      if (volumes[i].life <= 0) volumes.splice(i, 1);
    }
    for (const slot of pool) {
      if (!slot.active) continue;
      slot.fuse -= dt;
      slot.velocity.y -= 14 * dt;
      const next = scratch.copy(slot.position).addScaledVector(slot.velocity, dt);
      let bounced = false;
      for (const collider of colliders) {
        if (next.x > collider.min.x - 0.09 && next.x < collider.max.x + 0.09 && next.y > collider.min.y - 0.09 && next.y < collider.max.y + 0.09 && next.z > collider.min.z - 0.09 && next.z < collider.max.z + 0.09) {
          bounced = true;
          break;
        }
      }
      if (bounced && !slot.bounced) {
        slot.velocity.multiplyScalar(-0.45);
        slot.velocity.y = Math.abs(slot.velocity.y) * 0.4 + 1.5;
        slot.bounced = true;
      } else if (bounced) {
        slot.velocity.multiplyScalar(0.6);
      }
      if (next.y < 0.09) {
        next.y = 0.09;
        slot.velocity.y = Math.abs(slot.velocity.y) * 0.35;
        slot.velocity.x *= 0.7;
        slot.velocity.z *= 0.7;
      }
      slot.position.copy(next);
      slot.mesh.position.copy(slot.position);
      if (slot.fuse <= 0) {
        slot.active = false;
        slot.mesh.visible = false;
        if (slot.kind === 'smoke') addVolume(slot.position);
        else onExplode(slot.position);
      }
    }
  }

  return { throwFrom, step, blocksSight, volumes, active: pool };
}
