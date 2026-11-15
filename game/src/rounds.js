// Rounds and the economy: the state machine a match walks — buy phase, live round,
// round end, next round — plus the money that makes the buy menu matter. First to five
// rounds takes the match. A round ends by elimination, by the charge exploding, by a
// defuse, or by the clock running out with no plant (defenders win the clock).
// The player plants by holding E inside a site; a defender defuses the same way.
// v2: the smoke grenade joins the economy as its own buy (buySmoke), priced below the
// frag so a smoke-first buy is a real opening-round choice.
import { GRENADE, SMOKE, WEAPONS } from './weapons.js';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const ROUNDS_TO_WIN = 5;
export const START_MONEY = 800;
export const WIN_MONEY = 300;
export const LOSS_MONEY = 150;
export const KILL_MONEY = 100;
export const PLANT_MONEY = 300;
export const DEFUSE_MONEY = 300;

export function createRounds(emit) {
  const state = {
    phase: 'buy',
    round: 1,
    timeLeft: BUY_SECONDS,
    scoreEmber: 0,
    scoreSlate: 0,
    money: START_MONEY,
    planted: false,
    plantSite: null,
    plantTimeLeft: 0,
    plantProgress: 0,
    defuseProgress: 0,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    kills: 0,
    deaths: 0,
  };

  function startRound() {
    state.phase = 'buy';
    state.timeLeft = BUY_SECONDS;
    state.planted = false;
    state.plantSite = null;
    state.plantTimeLeft = 0;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.roundWinner = null;
    state.roundReason = '';
    emit('roundStart', { round: state.round });
  }

  function endRound(winner, reason) {
    if (state.phase === 'ended' || state.phase === 'matchEnd') return;
    state.phase = 'ended';
    state.timeLeft = 4;
    state.roundWinner = winner;
    state.roundReason = reason;
    if (winner === 'ember') {
      state.scoreEmber += 1;
      state.money += WIN_MONEY;
    } else {
      state.scoreSlate += 1;
      state.money += LOSS_MONEY;
    }
    emit('roundEnd', { winner, reason, round: state.round, scoreEmber: state.scoreEmber, scoreSlate: state.scoreSlate });
  }

  function plant(site) {
    if (state.planted || state.phase !== 'live') return false;
    state.planted = true;
    state.plantSite = site;
    state.plantTimeLeft = PLANT_SECONDS;
    state.money += PLANT_MONEY;
    emit('planted', { site });
    return true;
  }

  function defuse() {
    if (!state.planted) return false;
    state.planted = false;
    state.money += DEFUSE_MONEY;
    endRound('slate', 'Charge defused');
    emit('defused', {});
    return true;
  }

  function explode() {
    if (!state.planted) return;
    state.planted = false;
    emit('exploded', { site: state.plantSite });
    endRound('ember', 'Charge detonated');
  }

  // The player's plant/defuse channel: holding E inside the right place. Returns the
  // progress 0..1; reaching 1 plants or defuses. Letting go drains it.
  function channel(dt, mode, active) {
    if (mode === 'plant') {
      state.plantProgress = active ? Math.min(1, state.plantProgress + dt / PLANT_TIME) : Math.max(0, state.plantProgress - dt / 1.5);
      if (state.plantProgress >= 1) {
        state.plantProgress = 0;
        return 'planted';
      }
      return state.plantProgress;
    }
    state.defuseProgress = active ? Math.min(1, state.defuseProgress + dt / DEFUSE_TIME) : Math.max(0, state.defuseProgress - dt / 1.5);
    if (state.defuseProgress >= 1) {
      state.defuseProgress = 0;
      return 'defused';
    }
    return state.defuseProgress;
  }

  function update(dt) {
    if (state.phase === 'buy' || state.phase === 'live') {
      state.timeLeft -= dt;
      if (state.phase === 'buy' && state.timeLeft <= 0) {
        state.phase = 'live';
        state.timeLeft = ROUND_SECONDS;
        emit('live', { round: state.round });
      } else if (state.phase === 'live' && state.timeLeft <= 0) {
        if (state.planted) {
          // The clock stops mattering once the charge is down; the fuse decides.
          state.timeLeft = 0;
        } else {
          endRound('slate', 'Time expired — site held');
        }
      }
      if (state.planted) {
        state.plantTimeLeft -= dt;
        if (state.plantTimeLeft <= 0) explode();
      }
    } else if (state.phase === 'ended') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        if (state.scoreEmber >= ROUNDS_TO_WIN || state.scoreSlate >= ROUNDS_TO_WIN) {
          state.phase = 'matchEnd';
          state.matchWinner = state.scoreEmber > state.scoreSlate ? 'ember' : 'slate';
          emit('matchEnd', { winner: state.matchWinner });
        } else {
          state.round += 1;
          startRound();
        }
      }
    }
  }

  function awardKill() {
    state.kills += 1;
    state.money += KILL_MONEY;
  }

  function awardDeath() {
    state.deaths += 1;
  }

  function buyWeapon(id) {
    const def = WEAPONS[id];
    if (!def || state.money < def.price) return false;
    state.money -= def.price;
    return true;
  }

  function buyGrenade() {
    if (state.money < GRENADE.price) return false;
    state.money -= GRENADE.price;
    return true;
  }

  function buySmoke() {
    if (state.money < SMOKE.price) return false;
    state.money -= SMOKE.price;
    return true;
  }

  return {
    state,
    startRound,
    endRound,
    plant,
    defuse,
    explode,
    channel,
    update,
    awardKill,
    awardDeath,
    buyWeapon,
    buyGrenade,
    buySmoke,
    canBuy() {
      return state.phase === 'buy';
    },
  };
}
