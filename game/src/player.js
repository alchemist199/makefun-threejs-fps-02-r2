// The player: movement with acceleration, friction, gravity, crouch and jump, over
// the shared physics body; look and recoil; health. The body owns collision, this
// module owns the feel — walk speed, crouch speed, eye height and the jump.
// v2: aiming down sights slows the walk a touch (the ADS multiplier lives here so the
// slowdown and the spread bonus in weapons.js can never drift apart), and the eye
// height eases instead of snapping when the player crouches or stands.
import * as THREE from 'three';
import { createBody } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const ADS_SPEED = 3.1;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders, spawn) {
  const mover = createBody(colliders, spawn[0], spawn[1], STAND_HEIGHT);
  const body = mover.state;
  const wish = new THREE.Vector3();
  body.eye = STAND_EYE;
  let health = 100;
  let speed = 0;
  let aiming = false;

  function look(dx, dy, sensitivity = 0.0022) {
    // ADS steadies the mouse: half sensitivity while sighted in.
    const scale = aiming ? 0.55 : 1;
    body.yaw -= dx * sensitivity * scale;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity * scale));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function setAiming(value) {
    aiming = value;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    mover.setCrouch(crouching, STAND_HEIGHT, CROUCH_HEIGHT);
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wx = 0;
    let wz = 0;
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wx = -sin * forward + cos * strafe;
      wz = -cos * forward - sin * strafe;
      const length = Math.hypot(wx, wz) || 1;
      wx /= length;
      wz /= length;
    }
    wish.set(wx, 0, wz);
    const targetSpeed = body.crouching ? CROUCH_SPEED : aiming ? ADS_SPEED : WALK_SPEED;
    speed = mover.step(dt, wish, targetSpeed, body.onGround ? GROUND_ACCEL : AIR_ACCEL, FRICTION);
    if (keys.has('Space')) mover.jump(JUMP_SPEED);
  }

  function damage(amount) {
    if (health <= 0) return true;
    health = Math.max(0, health - amount);
    return health <= 0;
  }

  function reset(spawnPoint) {
    body.position.set(spawnPoint[0], 0, spawnPoint[1]);
    body.velocity.set(0, 0, 0);
    body.yaw = 0;
    body.pitch = 0;
    body.eye = STAND_EYE;
    body.height = STAND_HEIGHT;
    body.crouching = false;
    aiming = false;
    health = 100;
    speed = 0;
  }

  return {
    body,
    step,
    look,
    recoil,
    damage,
    reset,
    setAiming,
    groundSpeed() {
      return speed;
    },
    get aiming() {
      return aiming;
    },
    get health() {
      return health;
    },
  };
}
