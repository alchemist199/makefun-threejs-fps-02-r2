// Bots: nine opponents and teammates with one job each — walk the waypoint graph to
// their objective, hold and scan, and shoot back when they see you. Perception is a
// line-of-sight ray against the map plus a field of view; hearing is a noise event a
// gunshot registers, which pulls nearby bots to investigate. Attackers push a site and
// plant the charge; defenders hold the sites and rotate to defuse.
// A bot is a box-built body with a torso and a head mesh, so the player's hitscan can
// tell a headshot from a body shot, and it falls over when it dies.
// v2: bots talk. Every bot queues radio callouts — the round plan at spawn ("Ash:
// push A"), a contact call the first time it sees an enemy ("Reed: contact Mid Yard"),
// a plant/defuse call and a smoke call ("smoke on Mid — holding"). main.js drains the
// queue into the HUD feed, so the team plan is visible, not just simulated.
// v2: smoke blinds bots. canSee() fails when a smoke volume crosses the sightline,
// and a bot whose target vanishes into smoke either holds its angle or re-routes
// around the cloud instead of firing into it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './physics.js';
import { range } from './rng.js';
import { WEAPONS } from './weapons.js';

const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Soot'];
const SLATE_NAMES = ['Heron', 'Moss', 'Pike', 'Reed', 'Wren'];
const BOT_SPEED = 3.7;
const BOT_ACCEL = 30;
const BOT_FRICTION = 8;
const HEALTH = 100;
const SCAN_INTERVAL = 0.12;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;

export function createBots(scene, world, random) {
  const raycaster = new THREE.Raycaster();
  const bots = [];
  const hitMeshes = [];
  const radio = [];
  const scratch = new THREE.Vector3();
  const wishScratch = new THREE.Vector3();
  const eyeScratch = new THREE.Vector3();
  const toScratch = new THREE.Vector3();

  const teamMaterials = {
    ember: {
      torso: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.65, metalness: 0.05 }),
      dark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a2c17'), roughness: 0.85 }),
      visor: new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffd9a0'), roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.5 }),
    },
    slate: {
      torso: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.slate), roughness: 0.65, metalness: 0.05 }),
      dark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#16262a'), roughness: 0.85 }),
      visor: new THREE.MeshStandardMaterial({ color: new THREE.Color('#bff5e8'), roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(PALETTE.slate), emissiveIntensity: 0.5 }),
    },
  };
  const legGeometry = new THREE.BoxGeometry(0.16, 0.78, 0.18);
  const torsoGeometry = new THREE.BoxGeometry(0.54, 0.72, 0.32);
  const headGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const visorGeometry = new THREE.BoxGeometry(0.32, 0.08, 0.05);
  const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.55);

  function buildBot(index, team, name) {
    const materials = teamMaterials[team];
    const group = new THREE.Group();
    const legL = new THREE.Mesh(legGeometry, materials.dark);
    legL.position.set(-0.13, 0.39, 0);
    const legR = new THREE.Mesh(legGeometry, materials.dark);
    legR.position.set(0.13, 0.39, 0);
    const torso = new THREE.Mesh(torsoGeometry, materials.torso);
    torso.position.y = 1.12;
    const head = new THREE.Mesh(headGeometry, materials.dark);
    head.position.y = 1.66;
    const visor = new THREE.Mesh(visorGeometry, materials.visor);
    visor.position.set(0, 1.68, 0.17);
    const gun = new THREE.Mesh(gunGeometry, materials.dark);
    gun.position.set(0.28, 1.15, -0.2);
    group.add(legL, legR, torso, head, visor, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      index,
      team,
      name,
      group,
      torso,
      head,
      health: HEALTH,
      alive: true,
      weapon: 'rifle',
      state: 'move',
      yaw: 0,
      pitch: 0,
      target: null,
      targetLost: 0,
      reaction: 0,
      burstLeft: 0,
      burstPause: 0,
      fireCooldown: 0,
      scanAt: 0,
      path: [],
      pathIndex: 0,
      holdAt: 0,
      holdUntil: 0,
      site: 'A',
      carrier: false,
      channel: 0,
      channelKind: null,
      investigate: null,
      strafeDir: 1,
      strafeAt: 0,
      skill: range(random, 0.75, 1),
      body: null,
      calledContact: false,
      smokeHoldUntil: 0,
    };
    torso.userData = { bot, part: 'torso' };
    head.userData = { bot, part: 'head' };
    hitMeshes.push(torso, head);
    return bot;
  }

  for (let i = 0; i < EMBER_NAMES.length; i += 1) bots.push(buildBot(i, 'ember', EMBER_NAMES[i]));
  for (let i = 0; i < SLATE_NAMES.length; i += 1) bots.push(buildBot(EMBER_NAMES.length + i, 'slate', SLATE_NAMES[i]));

  function isEnemy(bot, other) {
    return other.team !== bot.team;
  }

  function eyeOf(bot) {
    return eyeScratch.set(bot.body.state.position.x, bot.body.state.position.y + 1.55, bot.body.state.position.z);
  }

  // Line of sight: nothing solid between the bot's eye and the point, and no smoke
  // volume crossing the segment. ctx.blocksSight is the grenade module's test.
  function canSee(bot, point, ctx) {
    const from = eyeOf(bot);
    toScratch.copy(point).sub(from);
    const distance = toScratch.length();
    if (distance > 46) return false;
    if (ctx.blocksSight && ctx.blocksSight(from, point)) return false;
    raycaster.set(from, toScratch.normalize());
    raycaster.far = distance - 0.4;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  function faceTowards(bot, x, z) {
    const dx = x - bot.body.state.position.x;
    const dz = z - bot.body.state.position.z;
    bot.yaw = Math.atan2(-dx, -dz);
  }

  function setPath(bot, goalIndex) {
    const start = world.nearestWaypoint(bot.body.state.position.x, bot.body.state.position.z);
    bot.path = world.findPath(start, goalIndex);
    bot.pathIndex = 0;
  }

  function waypointNear(x, z, radius) {
    const candidates = [];
    for (let i = 0; i < world.waypoints.length; i += 1) {
      const [wx, wz] = world.waypoints[i];
      const dx = wx - x;
      const dz = wz - z;
      if (dx * dx + dz * dz < radius * radius) candidates.push(i);
    }
    return candidates.length > 0 ? candidates[Math.floor(random() * candidates.length)] : world.nearestWaypoint(x, z);
  }

  // The radio queue: short team-plan lines, drained by main.js into the HUD feed.
  function say(bot, text) {
    if (radio.length > 24) radio.shift();
    radio.push({ name: bot.name, team: bot.team, text });
  }

  function drainRadio() {
    return radio.splice(0, radio.length);
  }

  // The round plan, in words: who pushes which site, who holds mid. main.js shows
  // the first line as the HUD plan; the rest go to the radio feed.
  function planLine() {
    const pushA = bots.filter((bot) => bot.team === 'ember' && bot.alive && bot.site === 'A').map((bot) => bot.name);
    const pushB = bots.filter((bot) => bot.team === 'ember' && bot.alive && bot.site === 'B').map((bot) => bot.name);
    const parts = [];
    if (pushA.length > 0) parts.push(`${pushA.join(' + ')} push A`);
    if (pushB.length > 0) parts.push(`${pushB.join(' + ')} push B`);
    return parts.join(' · ') || 'Ember pushes';
  }

  function assignObjective(bot, site) {
    bot.site = site;
    const center = world.sites[site].center;
    const goal = waypointNear(center.x, center.z, 6);
    setPath(bot, goal);
    bot.state = 'move';
    bot.holdUntil = 0;
  }

  function resetRound(roundNumber, plantSite) {
    const emberSpawns = world.spawns.ember;
    const slateSpawns = world.spawns.slate;
    let emberIndex = 0;
    let slateIndex = 0;
    // Attackers split across the two sites; defenders hold one site each, one roams mid.
    const emberSites = ['A', 'A', 'B', 'B'];
    const slateSites = ['A', 'A', 'B', 'B', 'A'];
    for (const bot of bots) {
      const spawn = bot.team === 'ember' ? emberSpawns[emberIndex % emberSpawns.length] : slateSpawns[slateIndex % slateSpawns.length];
      if (bot.team === 'ember') emberIndex += 1;
      else slateIndex += 1;
      if (!bot.body) bot.body = createBody(world.colliders, spawn[0], spawn[1]);
      bot.body.state.position.set(spawn[0], 0, spawn[1]);
      bot.body.state.velocity.set(0, 0, 0);
      bot.body.state.yaw = bot.team === 'ember' ? 0 : Math.PI;
      bot.yaw = bot.body.state.yaw;
      bot.health = HEALTH;
      bot.alive = true;
      bot.group.visible = true;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.copy(bot.body.state.position);
      bot.weapon = bot.index % 4 === 3 ? 'dmr' : bot.index % 3 === 1 ? 'smg' : 'rifle';
      bot.target = null;
      bot.channel = 0;
      bot.channelKind = null;
      bot.investigate = null;
      bot.carrier = false;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.fireCooldown = 0;
      bot.calledContact = false;
      bot.smokeHoldUntil = 0;
      if (bot.team === 'ember') assignObjective(bot, emberSites[(bot.index + roundNumber) % emberSites.length]);
      else assignObjective(bot, slateSites[(bot.index + roundNumber) % slateSites.length]);
      if (bot.team === 'slate' && bot.index === EMBER_NAMES.length + 4) {
        // The fifth defender roams the mid yard instead of holding a site.
        setPath(bot, waypointNear(0, 0, 8));
        bot.state = 'move';
      }
    }
    // One Ember bot carries the charge this round.
    const carriers = bots.filter((bot) => bot.team === 'ember');
    carriers[Math.floor(random() * carriers.length)].carrier = true;
    // The round plan, announced once per round so the player hears the team think.
    const carrier = carriers.find((bot) => bot.carrier);
    if (carrier) say(carrier, `pushing ${carrier.site} with the charge`);
    const roamer = bots.find((bot) => bot.team === 'slate' && bot.index === EMBER_NAMES.length + 4);
    if (roamer) say(roamer, 'holding Mid Yard');
    return plantSite;
  }

  function nearestLivingEnemy(bot, positions) {
    let best = null;
    let bestDistance = Infinity;
    for (const entry of positions) {
      if (!entry.alive || entry.team === bot.team) continue;
      const dx = entry.position.x - bot.body.state.position.x;
      const dz = entry.position.z - bot.body.state.position.z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    return best;
  }

  function step(dt, time, ctx) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const body = bot.body.state;

      // --- Perception, throttled: pick the nearest enemy with a clear line of sight.
      if (time >= bot.scanAt) {
        bot.scanAt = time + SCAN_INTERVAL;
        const enemy = nearestLivingEnemy(bot, ctx.positions);
        let seen = null;
        if (enemy) {
          const chest = scratch.set(enemy.position.x, enemy.position.y + 1.15, enemy.position.z);
          const forwardX = -Math.sin(bot.yaw);
          const forwardZ = -Math.cos(bot.yaw);
          const dx = enemy.position.x - body.position.x;
          const dz = enemy.position.z - body.position.z;
          const length = Math.hypot(dx, dz) || 1;
          const facing = (forwardX * dx + forwardZ * dz) / length;
          // Only engage inside 28 m: farther than that the bot keeps pushing its
          // route instead of strafing in place at spawn, trading pot-shots.
          if (length < 28 && facing > -0.2 && canSee(bot, chest, ctx)) seen = enemy;
        }
        if (seen) {
          if (bot.target !== seen) {
            bot.target = seen;
            bot.reaction = time + range(random, 0.3, 0.7) / bot.skill;
            bot.burstLeft = 0;
            if (!bot.calledContact) {
              bot.calledContact = true;
              const lane = world.laneAt(seen.position.x, seen.position.z);
              say(bot, `contact ${lane}`);
            }
          }
          bot.targetLost = 0;
        } else if (bot.target) {
          bot.targetLost += SCAN_INTERVAL;
          if (bot.targetLost > 1.2) {
            // The target vanished — if smoke sits between us, say so and hold the
            // angle instead of chasing a ghost through the cloud.
            if (ctx.blocksSight && ctx.blocksSight(eyeOf(bot), scratch.set(bot.target.position.x, bot.target.position.y + 1.15, bot.target.position.z))) {
              say(bot, `smoke on ${world.laneAt(bot.target.position.x, bot.target.position.z)} — holding`);
              bot.smokeHoldUntil = time + range(random, 1.5, 3);
            }
            bot.target = null;
          }
        }
      }

      // --- Smoke hold: a bot that lost its target to smoke waits out the cloud
      // instead of walking blind into it.
      if (bot.smokeHoldUntil > time && !bot.target) {
        bot.group.position.copy(body.position);
        continue;
      }

      // --- Channel: planting or defusing. Standing still, head down, counting.
      if (bot.channelKind) {
        bot.channel += dt;
        const needed = bot.channelKind === 'plant' ? PLANT_TIME : DEFUSE_TIME;
        if (bot.channel >= needed) {
          const kind = bot.channelKind;
          bot.channel = 0;
          bot.channelKind = null;
          if (kind === 'plant') {
            say(bot, `planting Site ${bot.site}`);
            ctx.onPlant(bot);
          } else {
            say(bot, 'defusing the charge');
            ctx.onDefuse(bot);
          }
        }
        bot.group.position.copy(body.position);
        continue;
      }

      // --- Combat: face the target, strafe, fire in bursts with an aim error that
      // grows with distance and with how fast the target moves. Only once the round
      // is live: the buy phase is for positioning, not shooting.
      if (bot.target && time >= bot.reaction && ctx.combatAllowed) {
        const target = bot.target;
        if (!target.alive) {
          bot.target = null;
        } else {
          faceTowards(bot, target.position.x, target.position.z);
          const distanceToTarget = Math.hypot(target.position.x - body.position.x, target.position.z - body.position.z);
          const wish = wishScratch.set(0, 0, 0);
          let moveSpeed = BOT_SPEED * 0.45;
          if (distanceToTarget > 18) {
            // Too far to trade shots: close the distance along the sightline.
            wish.set((target.position.x - body.position.x) / distanceToTarget, 0, (target.position.z - body.position.z) / distanceToTarget);
            moveSpeed = BOT_SPEED * 0.65;
          } else {
            // In range: strafe so the bot is a moving target while it fires.
            if (time >= bot.strafeAt) {
              bot.strafeAt = time + range(random, 0.7, 1.4);
              bot.strafeDir = random() < 0.5 ? -1 : 1;
            }
            const strafeX = Math.cos(bot.yaw) * bot.strafeDir;
            const strafeZ = -Math.sin(bot.yaw) * bot.strafeDir;
            wish.set(strafeX, 0, strafeZ);
          }
          body.yaw = bot.yaw;
          bot.body.step(dt, wish, moveSpeed, BOT_ACCEL, BOT_FRICTION);
          bot.fireCooldown -= dt;
          if (bot.burstLeft > 0 && bot.fireCooldown <= 0) {
            bot.burstLeft -= 1;
            bot.fireCooldown = WEAPONS[bot.weapon].gap;
            const distance = Math.hypot(target.position.x - body.position.x, target.position.z - body.position.z);
            const targetSpeed = Math.hypot(target.velocity?.x ?? 0, target.velocity?.z ?? 0);
            const error = (0.028 + distance * 0.0011 + targetSpeed * 0.006) / bot.skill;
            ctx.fireShot(bot, error);
          } else if (bot.burstLeft === 0) {
            bot.burstPause -= dt;
            if (bot.burstPause <= 0) {
              bot.burstLeft = 3 + Math.floor(random() * 3);
              bot.burstPause = range(random, 0.45, 0.85);
            }
          }
          bot.group.position.copy(body.position);
          bot.group.rotation.y = bot.yaw;
          continue;
        }
      }

      // --- Planting: the carrier walks into its site and starts the channel once the
      // site looks clear. Defusing: defenders walk to a planted site and channel.
      // Both wait for the live round, like the shooting does.
      if (ctx.combatAllowed && ctx.planted && bot.team === 'slate') {
        const site = world.sites[ctx.plantedSite];
        if (site.box.containsPoint(body.position)) {
          bot.channelKind = 'defuse';
          bot.channel = 0;
          bot.state = 'defuse';
          continue;
        }
        if (bot.state !== 'move' || bot.site !== ctx.plantedSite) {
          assignObjective(bot, ctx.plantedSite);
          say(bot, `rotating to Site ${ctx.plantedSite}`);
        }
      } else if (ctx.combatAllowed && bot.carrier && bot.team === 'ember' && !ctx.planted) {
        const site = world.sites[bot.site];
        if (site.box.containsPoint(body.position)) {
          const nearEnemy = nearestLivingEnemy(bot, ctx.positions);
          const clear = !nearEnemy || Math.hypot(nearEnemy.position.x - body.position.x, nearEnemy.position.z - body.position.z) > 9;
          if (clear) {
            bot.channelKind = 'plant';
            bot.channel = 0;
            bot.state = 'plant';
            continue;
          }
        }
      }

      // --- Investigation: a heard shot pulls a bot off its route for one look.
      if (bot.investigate && bot.state !== 'move') {
        setPath(bot, world.nearestWaypoint(bot.investigate.x, bot.investigate.z));
        bot.state = 'move';
        bot.investigate = null;
      }

      // --- Movement: follow the path, hold at the end and scan, then pick a new
      // nearby waypoint so a hold never turns into a statue.
      const wish = wishScratch.set(0, 0, 0);
      if (bot.pathIndex < bot.path.length) {
        const [wx, wz] = world.waypoints[bot.path[bot.pathIndex]];
        const dx = wx - body.position.x;
        const dz = wz - body.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.9) {
          bot.pathIndex += 1;
        } else {
          wish.set(dx / distance, 0, dz / distance);
          faceTowards(bot, wx, wz);
          body.yaw = bot.yaw;
        }
      } else if (time >= bot.holdUntil) {
        // Reached the objective: hold and scan, then shuffle to a nearby waypoint.
        if (bot.holdUntil === 0) bot.holdUntil = time + range(random, 2.5, 5);
        else {
          const center = world.sites[bot.site].center;
          const goal = waypointNear(center.x + range(random, -4, 4), center.z + range(random, -4, 4), 7);
          setPath(bot, goal);
          bot.holdUntil = 0;
        }
      }
      bot.body.step(dt, wish, BOT_SPEED, BOT_ACCEL, BOT_FRICTION);
      bot.group.position.copy(body.position);
      bot.group.rotation.y = bot.yaw;
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.target = null;
    bot.channelKind = null;
    bot.group.rotation.x = -Math.PI / 2;
    bot.group.position.y = 0.25;
    return true;
  }

  function hearNoise(position, radius) {
    for (const bot of bots) {
      if (!bot.alive || bot.target) continue;
      const dx = bot.body.state.position.x - position.x;
      const dz = bot.body.state.position.z - position.z;
      if (dx * dx + dz * dz < radius * radius) bot.investigate = { x: position.x, z: position.z };
    }
  }

  // Smoke landing near a bot: the nearest bots re-route around it instead of
  // walking through a cloud they cannot see through.
  function hearSmoke(position) {
    for (const bot of bots) {
      if (!bot.alive || bot.target) continue;
      const dx = bot.body.state.position.x - position.x;
      const dz = bot.body.state.position.z - position.z;
      if (dx * dx + dz * dz < 12 * 12) {
        const goal = waypointNear(bot.body.state.position.x + (bot.body.state.position.x - position.x), bot.body.state.position.z + (bot.body.state.position.z - position.z), 8);
        setPath(bot, goal);
        bot.state = 'move';
        say(bot, 'smoke — re-routing');
      }
    }
  }

  function aliveCount(team) {
    return bots.filter((bot) => bot.team === team && bot.alive).length;
  }

  function carrierBot() {
    return bots.find((bot) => bot.carrier && bot.alive) ?? null;
  }

  return {
    list: bots,
    hitMeshes,
    resetRound,
    step,
    damage,
    hearNoise,
    hearSmoke,
    drainRadio,
    planLine,
    aliveCount,
    carrierBot,
  };
}
