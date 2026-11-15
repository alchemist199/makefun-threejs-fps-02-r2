// Shared movement physics: one box against the world's colliders, resolved one axis at
// a time, so a wall never swallows a body and standing on the floor is never read as
// walking into a wall. The player and every bot are bodies built by createBody; the
// caller owns speed, gravity and wish direction, this module owns collision.
// All scratch vectors are allocated once here and reused, so stepping never allocates.
// v2 note: the walkway and the crate stacks are ordinary colliders, so standing on a
// crate or on the low walkway is the same code path as standing on the floor — a body
// lands on any collider top whose height it can reach by jumping, and walks off its edge.
import * as THREE from 'three';

const RADIUS = 0.34;
const GRAVITY = 20;

export function createBody(colliders, x, z, height = 1.72) {
  const body = {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: 1.6,
    onGround: true,
    crouching: false,
    height,
  };
  const probe = new THREE.Box3();

  function overlaps(xPos, yPos, zPos, bodyHeight, lift) {
    probe.min.set(xPos - RADIUS, yPos + lift, zPos - RADIUS);
    probe.max.set(xPos + RADIUS, yPos + bodyHeight - lift, zPos + RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  // wish is a unit XZ direction (or zero); speed is the target ground speed; accel is
  // the blend rate. Returns the ground speed after the step.
  function step(dt, wish, speed, accel, friction) {
    const blend = Math.min(1, (accel * dt) / Math.max(1, speed));
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - friction * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
    return Math.hypot(body.velocity.x, body.velocity.z);
  }

  function jump(speed) {
    if (!body.onGround) return false;
    body.velocity.y = speed;
    body.onGround = false;
    return true;
  }

  function setCrouch(crouched, standHeight, crouchHeight) {
    if (crouched && !body.crouching) {
      body.crouching = true;
      body.height = crouchHeight;
      return true;
    }
    if (!crouched && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, standHeight, 0.02)) {
      body.crouching = false;
      body.height = standHeight;
      return true;
    }
    return false;
  }

  return { state: body, step, jump, setCrouch, overlaps };
}
