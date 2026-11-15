// EMBERLINE v2 — Night Yard: boot and the one loop. A fixed 60 Hz simulation feeds a
// render at the display's rate, so the game plays the same on any monitor. main.js owns
// the glue: the player's shots, the bots' shots, deaths, the round events and the HUD
// numbers. Movement lives in player.js, bot brains in bots.js, the economy in rounds.js.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
// v2: the loop also wires the new systems — ADS (right mouse, camera zoom + scope
// overlay + spread bonus), the smoke grenade (F throws it, bots hear it and re-route),
// the radio feed (bots' callouts drained into the HUD every step), the team-plan line,
// and the damage-direction arc. The play capture is staged for action: the charge is
// planted on Site A, a smoke cloud hangs over Mid Yard, and the player fires a burst
// at a visible Slate bot with the muzzle flash still lit.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { GRENADE, SMOKE, WEAPONS, createGrenades, createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const BASE_FOV = 74;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 32, 85);
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud(world);
const player = createPlayer(world.colliders, world.spawns.ember[2]);
const weapons = createWeapons(camera);
const grenades = createGrenades(scene, world.colliders, onGrenadeExplode, onSmokeBloom);
const bots = createBots(scene, world, random);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

const direction = new THREE.Vector3();
const origin = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const ray = new THREE.Ray();
const segA = new THREE.Vector3();
const segB = new THREE.Vector3();
const closest = new THREE.Vector3();

let elapsed = 0;
let frozen = false;
let started = false;
let buyOpen = false;
let accumulator = 0;
let lastTime = performance.now();
let wasFiring = false;
let wasAiming = false;
let pressedSet = new Set();
const lastShotAt = new Map();

// Positions the bots perceive: the player plus every bot, as live objects updated in
// place once a step, so perception never allocates.
const positions = [{ position: player.body.position, velocity: player.body.velocity, alive: true, team: 'ember', isPlayer: true, bot: null }];
for (const bot of bots.list) {
  positions.push({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), alive: true, team: bot.team, isPlayer: false, bot });
}

function syncPositions() {
  positions[0].alive = player.health > 0;
  for (let i = 0; i < bots.list.length; i += 1) {
    const bot = bots.list[i];
    const entry = positions[i + 1];
    entry.position.copy(bot.body.state.position);
    entry.velocity.copy(bot.body.state.velocity);
    entry.alive = bot.alive;
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.showHint(true);
    audio.unlock();
  } else if (!buyOpen && rounds.state.phase !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'start');
    hud.showHint(false);
  }
}

function onGrenadeExplode(position) {
  effects.explosion(position);
  audio.explode();
  const distanceToPlayer = Math.hypot(player.body.position.x - position.x, player.body.position.z - position.z);
  if (player.health > 0 && distanceToPlayer < GRENADE.radius) {
    const amount = GRENADE.maxDamage * (1 - distanceToPlayer / GRENADE.radius);
    hurtPlayer(amount, null, position);
  }
  for (const bot of bots.list) {
    if (!bot.alive) continue;
    const distance = Math.hypot(bot.body.state.position.x - position.x, bot.body.state.position.z - position.z);
    if (distance >= GRENADE.radius) continue;
    const amount = GRENADE.maxDamage * (1 - distance / GRENADE.radius);
    killBot(bot, amount, null, false);
  }
  bots.hearNoise(position, 30);
}

// A smoke burst blooms: the visible cloud, the hiss, and the bots' reaction — the
// nearest ones re-route around the cloud instead of walking through it blind.
function onSmokeBloom(position, radius) {
  effects.smokeBurst(position, radius);
  audio.smokeHiss();
  bots.hearSmoke(position);
}

// One shot, resolved against the world, every bot body and the player's capsule.
// Returns the hit, if any: { point, distance, bot, part, player }.
function resolveShot(from, dir, shooterBot) {
  raycaster.set(from, dir);
  const hits = raycaster.intersectObjects(world.shootables.concat(bots.hitMeshes), false);
  let best = null;
  if (hits.length > 0) {
    const hit = hits[0];
    best = { point: hit.point, distance: hit.distance, bot: hit.object.userData.bot ?? null, part: hit.object.userData.part ?? null, player: false };
  }
  // The player is a capsule, not a mesh: test the ray against the standing segment.
  if (player.health > 0 && shooterBot) {
    ray.origin.copy(from);
    ray.direction.copy(dir);
    segA.set(player.body.position.x, 0, player.body.position.z);
    segB.set(player.body.position.x, 1.72, player.body.position.z);
    const distSq = ray.distanceSqToSegment(segA, segB, closest, null);
    if (distSq < 0.34 * 0.34) {
      const t = closest.distanceTo(from);
      if (t > 0 && (!best || t < best.distance)) {
        best = { point: closest, distance: t, bot: null, part: closest.y > 1.45 ? 'head' : 'torso', player: true };
      }
    }
  }
  return best;
}

function shootFrom(from, dir, weaponDef, shooter, isPlayer) {
  const hit = resolveShot(from, dir, shooter);
  const end = hit ? hit.point : hitPoint.copy(from).addScaledVector(dir, 42);
  effects.fireTracer(muzzle.copy(from), end);
  if (!hit) {
    effects.spark(hitPoint.copy(from).addScaledVector(dir, 42));
    return null;
  }
  if (hit.bot) {
    const amount = weaponDef.damage * (hit.part === 'head' ? weaponDef.headMult : 1);
    if (isPlayer) {
      hud.hitMarker(false);
      audio.hit();
    }
    killBot(hit.bot, amount, shooter, hit.part === 'head');
    return hit;
  }
  if (hit.player) {
    const amount = weaponDef.damage * (hit.part === 'head' ? weaponDef.headMult : 1);
    hurtPlayer(amount, shooter, from);
    return hit;
  }
  effects.spark(hit.point);
  return hit;
}

function playerShoot() {
  if (!weapons.takeRound()) {
    audio.dryFire();
    weapons.reload();
    return;
  }
  camera.getWorldDirection(direction);
  const spread = shot ? 0 : weapons.spread(player.groundSpeed());
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  origin.copy(camera.position);
  shootFrom(origin, direction, weapons.def(), null, true);
  weapons.pullTrigger();
  player.recoil(weapons.def().recoil * (0.9 + random() * 0.2), (random() * 2 - 1) * weapons.def().recoil * 0.4);
  audio.shot(weapons.def().kind, 0);
  bots.hearNoise(player.body.position, 26);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve);
}

function botShoot(bot, error) {
  const target = bot.target;
  if (!target || !target.alive) return;
  origin.set(bot.body.state.position.x, bot.body.state.position.y + 1.5, bot.body.state.position.z);
  direction.set(target.position.x - origin.x, target.position.y + 1.15 - origin.y, target.position.z - origin.z).normalize();
  direction.x += (random() * 2 - 1) * error;
  direction.y += (random() * 2 - 1) * error;
  direction.z += (random() * 2 - 1) * error;
  direction.normalize();
  muzzle.copy(origin).addScaledVector(direction, 0.5);
  muzzle.y -= 0.15;
  const def = WEAPONS[bot.weapon];
  const distance = Math.hypot(player.body.position.x - origin.x, player.body.position.z - origin.z);
  shootFrom(origin, direction, def, bot, false);
  audio.shot(def.kind, distance);
  lastShotAt.set(bot.index, elapsed);
}

function killBot(bot, amount, shooter, headshot) {
  if (!bot.alive) return;
  const died = bots.damage(bot, amount);
  if (!died) return;
  const killerName = shooter === null ? 'You' : shooter.name;
  const killerTeam = shooter === null ? 'ember' : shooter.team;
  hud.killfeed(killerName, killerTeam, bot.name, bot.team, headshot);
  if (shooter === null) {
    rounds.awardKill();
    hud.hitMarker(true);
    audio.kill();
    hud.setMoney(rounds.state.money);
  }
  if (bot.carrier) {
    const next = bots.list.find((entry) => entry.team === 'ember' && entry.alive && !entry.carrier);
    if (next) next.carrier = true;
  }
  checkElimination();
}

// from is the shot's origin (or the explosion's centre): the damage-direction arc
// points from the player's facing toward it.
function hurtPlayer(amount, shooter, from) {
  const died = player.damage(amount);
  hud.setHealth(player.health);
  hud.damageFlash();
  audio.hurt();
  if (from) {
    const dx = from.x - player.body.position.x;
    const dz = from.z - player.body.position.z;
    const worldAngle = Math.atan2(dx, dz);
    const relative = worldAngle - player.body.yaw;
    hud.damageFrom((relative * 180) / Math.PI);
  }
  if (!died) return;
  rounds.awardDeath();
  const killerName = shooter ? shooter.name : 'The yard';
  hud.killfeed(killerName, shooter ? shooter.team : 'slate', 'You', 'ember', false);
  if (document.pointerLockElement) document.exitPointerLock();
  checkElimination();
}

function checkElimination() {
  if (rounds.state.phase !== 'live') return;
  const emberAlive = (player.health > 0 ? 1 : 0) + bots.aliveCount('ember');
  const slateAlive = bots.aliveCount('slate');
  if (rounds.state.planted) {
    if (slateAlive === 0) rounds.endRound('ember', 'Defenders eliminated');
  } else if (emberAlive === 0) {
    rounds.endRound('slate', 'Ember eliminated');
  } else if (slateAlive === 0) {
    rounds.endRound('ember', 'Slate eliminated');
  }
}

function startMatch() {
  rounds.state.scoreEmber = 0;
  rounds.state.scoreSlate = 0;
  rounds.state.round = 1;
  rounds.state.money = 800;
  rounds.state.kills = 0;
  rounds.state.deaths = 0;
  rounds.state.matchWinner = null;
  weapons.refill();
  rounds.startRound();
}

function beginRound() {
  player.reset(world.spawns.ember[2]);
  bots.resetRound(rounds.state.round, null);
  weapons.restock();
  effects.hideCharge();
  lastShotAt.clear();
  hud.setHealth(player.health);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.scoreEmber, rounds.state.scoreSlate, rounds.state.round, 'buy');
  hud.setAlive(1 + bots.aliveCount('ember'), bots.aliveCount('slate'));
  hud.setCharge(false, 0);
  hud.setChannel(0, 'plant');
  hud.setPlan(bots.planLine());
  syncCamera();
}

function syncCamera() {
  camera.position.set(player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z);
  camera.rotation.set(player.body.pitch, player.body.yaw, 0, 'YXZ');
  // ADS zoom follows the weapon's aim blend; the scope overlay shows only once the
  // Longbow-8 is fully sighted in.
  const fov = weapons.fov(BASE_FOV);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  hud.setScope(weapons.state.aiming && weapons.def().scope && weapons.state.aimBlend > 0.9);
}

function aimAt(point) {
  const dx = point.x - player.body.position.x;
  const dy = point.y - (player.body.position.y + player.body.eye);
  const dz = point.z - player.body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.body.yaw = Math.atan2(-dx, -dz);
  player.body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function pressed(code) {
  return pressedSet.has(code);
}

function throwGrenade(kind) {
  const count = kind === 'smoke' ? weapons.state.smokes : weapons.state.grenades;
  if (count <= 0) return;
  camera.getWorldDirection(direction);
  origin.copy(camera.position).addScaledVector(direction, 0.6);
  if (grenades.throwFrom(origin, direction, kind)) {
    if (kind === 'smoke') weapons.state.smokes -= 1;
    else weapons.state.grenades -= 1;
    audio.grenadePin();
  }
}

function buy(id) {
  if (!rounds.canBuy()) return;
  if (id === 'grenade') {
    if (weapons.state.grenades >= 1) return;
    if (!rounds.buyGrenade()) return;
    weapons.buyGrenade();
    audio.buy();
  } else if (id === 'smoke') {
    if (weapons.state.smokes >= 1) return;
    if (!rounds.buySmoke()) return;
    weapons.buySmoke();
    audio.buy();
  } else {
    if (weapons.state.owned[id]) {
      weapons.equip(id);
    } else {
      if (!rounds.buyWeapon(id)) return;
      weapons.buy(id);
      audio.buy();
    }
  }
  hud.setMoney(rounds.state.money);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.showBuy(true, rounds.state.money, weapons.state.owned, weapons.state.current, weapons.state.grenades, weapons.state.smokes);
}

function setBuyOpen(open) {
  if (open && !rounds.canBuy()) return;
  buyOpen = open;
  hud.showBuy(open, rounds.state.money, weapons.state.owned, weapons.state.current, weapons.state.grenades, weapons.state.smokes);
  if (open && document.pointerLockElement) document.exitPointerLock();
  if (!open && started) input.requestLock();
}

const rounds = createRounds((type, data) => {
  if (type === 'roundStart') {
    beginRound();
    hud.showBanner(`Round ${data.round}`, 'Buy phase — press B to spend your credits', 2200);
  } else if (type === 'live') {
    setBuyOpen(false);
    hud.showBanner(`Round ${data.round}`, 'Plant the charge on Site A or B', 2200);
    audio.roundStart();
  } else if (type === 'planted') {
    effects.showCharge(world.sites[data.site].center);
    hud.setCharge(true, 35);
    audio.plantTick();
    hud.showBanner('Charge planted', `Site ${data.site} — hold it`, 2200);
  } else if (type === 'defused') {
    effects.hideCharge();
    hud.setCharge(false, 0);
  } else if (type === 'exploded') {
    effects.explosion(world.sites[data.site].center);
    effects.hideCharge();
    hud.setCharge(false, 0);
    audio.explode();
  } else if (type === 'roundEnd') {
    setBuyOpen(false);
    const won = data.winner === 'ember';
    hud.showBanner(won ? 'Ember takes the round' : 'Slate takes the round', `${data.reason} · ${data.scoreEmber} — ${data.scoreSlate}`, 3400);
    if (won) audio.roundWin();
    else audio.roundLose();
    hud.setScore(data.scoreEmber, data.scoreSlate, data.round, 'ended');
  } else if (type === 'matchEnd') {
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showOverlay('matchEnd', { winner: data.winner, scoreEmber: rounds.state.scoreEmber, scoreSlate: rounds.state.scoreSlate });
  }
});

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'matchEnd') startMatch();
  input.requestLock();
});
hud.onBuy((id) => buy(id));

function step(dt) {
  elapsed += dt;
  pressedSet = input.takePressed();
  const phase = rounds.state.phase;
  const live = phase === 'live';
  const playing = phase === 'buy' || live;

  // ADS: right mouse held. The player slows, the view zooms, the spread tightens.
  const aiming = input.state.aiming && !buyOpen && player.health > 0;
  if (aiming !== wasAiming) {
    if (aiming) audio.scopeClick();
    wasAiming = aiming;
  }
  weapons.state.aiming = aiming;
  player.setAiming(aiming);

  // The player moves in buy and live; the dead watch from where they fell.
  if (playing && player.health > 0 && (input.state.locked || shot)) {
    player.step(dt, input.state.keys);
  }

  // Bots walk their routes in buy and live, but only shoot once the round is live.
  if (playing) {
    syncPositions();
    bots.step(dt, elapsed, {
      positions,
      planted: rounds.state.planted,
      plantedSite: rounds.state.plantSite,
      combatAllowed: live,
      blocksSight: (from, to) => grenades.blocksSight(from, to),
      fireShot: botShoot,
      onPlant: (bot) => {
        if (rounds.plant(bot.site)) {
          hud.killfeed(bot.name, 'ember', `Site ${bot.site}`, 'ember', false);
        }
      },
      onDefuse: () => {
        rounds.defuse();
      },
    });
    // Drain the radio queue into the HUD feed, newest first.
    for (const call of bots.drainRadio()) {
      hud.radio(call.name, call.team, call.text);
      audio.radioBlip();
    }
  }

  weapons.step(dt);
  grenades.step(dt);
  effects.step(dt, elapsed);

  // The player's fire: held for automatics, one press for semi-automatics.
  if (live && player.health > 0 && (input.state.locked || shot)) {
    const firing = input.state.firing;
    const def = weapons.def();
    if (firing && weapons.ready() && (def.auto || !wasFiring)) playerShoot();
    if (firing && !weapons.ready() && weapons.state.mag === 0 && weapons.state.reloadLeft === 0) {
      weapons.reload();
      audio.reload();
    }
    wasFiring = firing;
    if (pressed('KeyR')) {
      if (weapons.reload()) audio.reload();
    }
    if (pressed('KeyG')) throwGrenade('frag');
    if (pressed('KeyF')) throwGrenade('smoke');
    // Planting: hold E inside a site while the round is live.
    const inSite = !rounds.state.planted && (world.sites.A.box.containsPoint(player.body.position) || world.sites.B.box.containsPoint(player.body.position));
    if (inSite && input.state.keys.has('KeyE')) {
      const result = rounds.channel(dt, 'plant', true);
      if (result === 'planted') {
        rounds.plant(player.body.position.x < 0 ? 'A' : 'B');
        hud.setChannel(0, 'plant');
      } else {
        hud.setChannel(result, 'plant');
      }
    } else {
      rounds.channel(dt, 'plant', false);
      hud.setChannel(rounds.state.plantProgress, 'plant');
    }
  }

  // Buy menu: B toggles it in the buy phase; 1-7 buy straight from the keyboard.
  if (pressed('KeyB')) setBuyOpen(!buyOpen);
  if (buyOpen) {
    if (pressed('Digit1')) buy('pistol');
    if (pressed('Digit2')) buy('smg');
    if (pressed('Digit3')) buy('rifle');
    if (pressed('Digit4')) buy('scoped');
    if (pressed('Digit5')) buy('dmr');
    if (pressed('Digit6')) buy('grenade');
    if (pressed('Digit7')) buy('smoke');
  }

  rounds.update(dt);

  // HUD numbers, every step, cheap because each setter skips unchanged values.
  hud.setHealth(player.health);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.state.timeLeft, phase);
  hud.setScore(rounds.state.scoreEmber, rounds.state.scoreSlate, rounds.state.round, phase);
  hud.setAlive((player.health > 0 ? 1 : 0) + bots.aliveCount('ember'), bots.aliveCount('slate'));
  hud.setCharge(rounds.state.planted, rounds.state.plantTimeLeft);
  hud.setSpread(weapons.spread(player.groundSpeed()) * 900);
  const heard = [];
  for (const bot of bots.list) {
    if (bot.team !== 'slate' || !bot.alive) continue;
    const at = lastShotAt.get(bot.index);
    if (at !== undefined && elapsed - at < 3) heard.push(bot.body.state.position);
  }
  const mates = [];
  for (const bot of bots.list) {
    if (bot.team === 'ember' && bot.alive) mates.push(bot.body.state.position);
  }
  hud.minimap(player.body.position.x, player.body.position.z, player.body.yaw, mates, heard, rounds.state.planted ? world.sites[rounds.state.plantSite].center : null, grenades.volumes);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (input.state.locked) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showHint(false);
  player.body.pitch = 0;
  player.body.yaw = 0;
  if (name === 'start') {
    startMatch();
    player.body.position.set(0, 0, 14);
    settle(20);
    aimAt(new THREE.Vector3(-15, 2.5, -14));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    startMatch();
    settle(30);
    setBuyOpen(true);
    aimAt(new THREE.Vector3(0, 1.2, -14));
    hud.showBanner('Round 1', 'Buy phase — press B to spend your credits', 60000);
  } else if (name === 'play') {
    startMatch();
    // Skip the buy phase and play eight seconds of the round, then stage the
    // action: the charge is planted on Site A, a smoke cloud hangs over Mid Yard,
    // and the player fires one burst at a visible Slate bot with the flash lit.
    rounds.state.phase = 'live';
    rounds.state.timeLeft = 100;
    settle(60 * 8);
    rounds.plant('A');
    effects.showCharge(world.sites.A.center);
    // A short lob, not a flat throw: the smoke lands in Mid Yard by the walkway,
    // in frame, instead of sailing to the north wall.
    grenades.throwFrom(new THREE.Vector3(0, 1.6, -2), new THREE.Vector3(0, 0.3, -0.25), 'smoke');
    settle(60 * 2);
    const enemy = bots.list.find((bot) => bot.team === 'slate' && bot.alive);
    if (enemy) {
      aimAt(new THREE.Vector3(enemy.body.state.position.x, 1.3, enemy.body.state.position.z));
      playerShoot();
      settle(2);
    }
    hud.showBanner('', '', 1);
  } else if (name === 'end') {
    startMatch();
    rounds.state.phase = 'live';
    rounds.state.timeLeft = 100;
    settle(60 * 5);
    // Script the round's end: the player's team clears Slate.
    for (const bot of bots.list) {
      if (bot.team === 'slate' && bot.alive) killBot(bot, 500, null, false);
    }
    settle(30);
  }
  hud.setScore(rounds.state.scoreEmber, rounds.state.scoreSlate, rounds.state.round, rounds.state.phase);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.setHealth(player.health);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.state.timeLeft, rounds.state.phase);
  hud.setAlive((player.health > 0 ? 1 : 0) + bots.aliveCount('ember'), bots.aliveCount('slate'));
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) {
  runShot(shot);
} else {
  startMatch();
  requestAnimationFrame(frame);
}

// A small handle for the play-test: state, not a cheat — it only reads.
window.__ember = {
  rounds,
  bots,
  player,
  weapons,
  grenades,
  world,
  hud,
  camera,
  state() {
    return {
      phase: rounds.state.phase,
      round: rounds.state.round,
      timeLeft: rounds.state.timeLeft,
      scoreEmber: rounds.state.scoreEmber,
      scoreSlate: rounds.state.scoreSlate,
      money: rounds.state.money,
      planted: rounds.state.planted,
      plantSite: rounds.state.plantSite,
      playerHealth: player.health,
      playerAlive: player.health > 0,
      playerPos: [player.body.position.x, player.body.position.y, player.body.position.z],
      emberAlive: (player.health > 0 ? 1 : 0) + bots.aliveCount('ember'),
      slateAlive: bots.aliveCount('slate'),
      smokes: grenades.volumes.length,
      weapon: weapons.def().id,
      botPositions: bots.list.map((bot) => ({ name: bot.name, team: bot.team, alive: bot.alive, x: bot.body.state.position.x, z: bot.body.state.position.z, state: bot.state, target: bot.target ? bot.target.bot?.name ?? 'player' : null })),
    };
  },
};
