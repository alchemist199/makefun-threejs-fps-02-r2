// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// a live minimap, the buy menu and the overlays. It never touches the simulation;
// main.js pushes numbers in and reads the buy and play callbacks out.
// The minimap is one canvas: the yard's colliders drawn once as a static layer, then
// the moving dots each frame.
// v2: the HUD grows three things the study asked for — a radio feed (bot callouts,
// newest on top, five lines max), a team-plan line under the top bar, and a scope
// overlay that replaces the crosshair when the Longbow-8 is sighted in. It also gains
// a damage-direction arc: when a shot lands on the player, a red arc flashes on the
// side the shot came from. The buy menu lists the scoped rifle and both grenades,
// and the minimap now carries the lane names.
import { GRENADE, SMOKE, WEAPON_ORDER, WEAPONS } from './weapons.js';

const COPY = {
  start: {
    title: 'EMBER<span class="ember">LINE</span> <span class="v2">v2</span>',
    copy: 'Rustyard at dusk. Five on five: plant the spark charge on Site A (Warehouse) or B (Dock), or wipe out Slate. Right-click to aim down sights. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Paused',
    copy: 'The yard waits. Click to go back in.',
    action: 'Click to resume',
  },
  matchEnd: {
    title: '',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(world) {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const ammo = document.getElementById('ammo');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const weaponName = document.getElementById('weapon-name');
  const healthValue = document.getElementById('health-value');
  const healthFill = document.getElementById('health-fill');
  const moneyValue = document.getElementById('money-value');
  const timerEl = document.getElementById('timer');
  const roundLabel = document.getElementById('round-label');
  const scoreEmber = document.getElementById('score-ember');
  const scoreSlate = document.getElementById('score-slate');
  const aliveEmber = document.getElementById('alive-ember');
  const aliveSlate = document.getElementById('alive-slate');
  const hitmarker = document.getElementById('hitmarker');
  const crosshair = document.getElementById('crosshair');
  const damage = document.getElementById('damage');
  const damageDir = document.getElementById('damage-dir');
  const killfeed = document.getElementById('killfeed');
  const radioFeed = document.getElementById('radio');
  const planLine = document.getElementById('plan');
  const scopeOverlay = document.getElementById('scope');
  const chargeStatus = document.getElementById('charge-status');
  const chargeTimer = document.getElementById('charge-timer');
  const channel = document.getElementById('channel');
  const channelLabel = document.getElementById('channel-label');
  const channelFill = document.getElementById('channel-fill');
  const banner = document.getElementById('banner');
  const bannerTitle = document.getElementById('banner-title');
  const bannerSub = document.getElementById('banner-sub');
  const hint = document.getElementById('hint');
  const buyMenu = document.getElementById('buymenu');
  const buyItems = document.getElementById('buy-items');
  const buyMoney = document.getElementById('buy-money');
  const minimap = document.getElementById('minimap');
  const mapCtx = minimap.getContext('2d');

  let hitTimer = 0;
  let damageTimer = 0;
  let damageDirTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastAlive = '';
  let lastPlan = '';
  let buyHandler = null;

  // Minimap static layer: the yard's walls and cover as rectangles, the sites as
  // letters, the lanes as names. World x [-22,22] and z [-18,18] map onto the 150x132 canvas.
  const SCALE = 3.3;
  const OX = 75;
  const OZ = 66;
  function toMap(x, z) {
    return [OX + x * SCALE, OZ + z * SCALE];
  }
  function drawStatic() {
    mapCtx.fillStyle = '#181d26';
    mapCtx.fillRect(0, 0, 150, 132);
    mapCtx.fillStyle = '#39424e';
    for (const box of world.colliders) {
      const [x0, z0] = toMap(box.min.x, box.min.z);
      const [x1, z1] = toMap(box.max.x, box.max.z);
      mapCtx.fillRect(x0, z0, Math.max(1, x1 - x0), Math.max(1, z1 - z0));
    }
    mapCtx.font = 'bold 11px monospace';
    mapCtx.textAlign = 'center';
    mapCtx.textBaseline = 'middle';
    const [ax, az] = toMap(-15, -14);
    mapCtx.fillStyle = '#f5a52e';
    mapCtx.fillText('A', ax, az);
    const [bx, bz] = toMap(15, -14);
    mapCtx.fillStyle = '#45c4b2';
    mapCtx.fillText('B', bx, bz);
    mapCtx.font = '7px monospace';
    mapCtx.fillStyle = '#93a0ad';
    mapCtx.fillText('WEST', ...toMap(-14, 12));
    mapCtx.fillText('MID', ...toMap(0, 12));
    mapCtx.fillText('EAST', ...toMap(14, 12));
  }
  drawStatic();
  const staticLayer = mapCtx.getImageData(0, 0, 150, 132);

  // The buy menu is built once from the weapon table; prices and ownership refresh.
  const buyButtons = {};
  for (const id of WEAPON_ORDER) {
    const def = WEAPONS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.dataset.id = id;
    button.innerHTML = `<span class="key"></span><span class="name">${def.name}${def.scope ? ' · scoped' : ''}</span><span class="stat">${def.damage} dmg · ${def.mag} rnd</span><span class="price"></span>`;
    button.addEventListener('click', () => buyHandler?.(id));
    buyItems.appendChild(button);
    buyButtons[id] = button;
  }
  const grenadeButton = document.createElement('button');
  grenadeButton.type = 'button';
  grenadeButton.className = 'buy-item';
  grenadeButton.dataset.id = 'grenade';
  grenadeButton.innerHTML = `<span class="key">6</span><span class="name">${GRENADE.name} grenade</span><span class="stat">blast ${GRENADE.radius}m</span><span class="price"></span>`;
  grenadeButton.addEventListener('click', () => buyHandler?.('grenade'));
  buyItems.appendChild(grenadeButton);
  buyButtons.grenade = grenadeButton;
  const smokeButton = document.createElement('button');
  smokeButton.type = 'button';
  smokeButton.className = 'buy-item';
  smokeButton.dataset.id = 'smoke';
  smokeButton.innerHTML = `<span class="key">7</span><span class="name">${SMOKE.name}</span><span class="stat">blocks sight ${SMOKE.life}s</span><span class="price"></span>`;
  smokeButton.addEventListener('click', () => buyHandler?.('smoke'));
  buyItems.appendChild(smokeButton);
  buyButtons.smoke = smokeButton;
  WEAPON_ORDER.forEach((id, i) => {
    buyButtons[id].querySelector('.key').textContent = String(i + 1);
  });

  function formatTime(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(value) {
      const hp = Math.max(0, Math.round(value));
      if (hp === lastHealth) return;
      lastHealth = hp;
      healthValue.textContent = String(hp);
      healthFill.style.width = `${hp}%`;
      healthFill.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
      if (name) weaponName.textContent = name;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = String(value);
      buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      const text = formatTime(seconds);
      const label = phase === 'buy' ? `BUY ${text}` : text;
      if (label === lastTimer) return;
      lastTimer = label;
      timerEl.textContent = label;
      timerEl.classList.toggle('low', phase === 'live' && seconds <= 10);
    },
    setScore(ember, slate, round, phase) {
      const text = `${ember}|${slate}|${round}|${phase}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreEmber.textContent = String(ember);
      scoreSlate.textContent = String(slate);
      roundLabel.textContent = phase === 'buy' ? `ROUND ${round} · BUY` : `ROUND ${round}`;
    },
    setAlive(ember, slate) {
      const text = `${ember}|${slate}`;
      if (text === lastAlive) return;
      lastAlive = text;
      aliveEmber.textContent = String(ember);
      aliveSlate.textContent = String(slate);
    },
    setPlan(text) {
      if (text === lastPlan) return;
      lastPlan = text;
      planLine.textContent = text ? `PLAN — ${text}` : '';
      planLine.hidden = !text;
    },
    setSpread(px) {
      const scale = 1 + Math.min(14, px) / 22;
      crosshair.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), 130);
    },
    // A red arc on the side the damage came from: angle 0 is straight ahead, and
    // the arc rotates around the screen centre to match it.
    damageFrom(angleDeg) {
      damageDir.style.transform = `translate(-50%, -50%) rotate(${angleDeg.toFixed(0)}deg)`;
      damageDir.classList.add('on');
      clearTimeout(damageDirTimer);
      damageDirTimer = setTimeout(() => damageDir.classList.remove('on'), 450);
    },
    killfeed(killer, killerTeam, victim, victimTeam, headshot) {
      const line = document.createElement('div');
      line.innerHTML = `<b class="${killerTeam}">${killer}</b> ${headshot ? '◉' : '→'} <b class="${victimTeam}">${victim}</b>`;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 5000);
    },
    radio(name, team, text) {
      const line = document.createElement('div');
      line.innerHTML = `<b class="${team}">${name}</b> ${text}`;
      radioFeed.prepend(line);
      while (radioFeed.children.length > 5) radioFeed.lastChild.remove();
      setTimeout(() => line.remove(), 7000);
    },
    setCharge(planted, seconds) {
      chargeStatus.hidden = !planted;
      if (planted) chargeTimer.textContent = String(Math.max(0, Math.ceil(seconds)));
    },
    setChannel(progress, kind) {
      if (progress <= 0) {
        channel.hidden = true;
        return;
      }
      channel.hidden = false;
      channelLabel.textContent = kind === 'plant' ? 'Planting charge…' : 'Defusing charge…';
      channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showBanner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, ms);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showHint(show) {
      hint.hidden = !show;
    },
    setScope(show) {
      scopeOverlay.hidden = !show;
      crosshair.style.visibility = show ? 'hidden' : 'visible';
    },
    showBuy(open, money, owned, current, grenades, smokes) {
      buyMenu.hidden = !open;
      if (!open) return;
      buyMoney.textContent = `$${money}`;
      for (const id of WEAPON_ORDER) {
        const def = WEAPONS[id];
        const button = buyButtons[id];
        const isOwned = Boolean(owned[id]);
        const isCurrent = current === id;
        button.disabled = isOwned || money < def.price;
        button.classList.toggle('owned', isOwned);
        button.querySelector('.price').textContent = isCurrent ? 'EQUIPPED' : isOwned ? 'OWNED' : `$${def.price}`;
      }
      grenadeButton.disabled = grenades >= 1 || money < GRENADE.price;
      grenadeButton.querySelector('.price').textContent = grenades >= 1 ? 'CARRIED' : `$${GRENADE.price}`;
      smokeButton.disabled = smokes >= 1 || money < SMOKE.price;
      smokeButton.querySelector('.price').textContent = smokes >= 1 ? 'CARRIED' : `$${SMOKE.price}`;
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    buyVisible() {
      return !buyMenu.hidden;
    },
    showOverlay(mode, data = {}) {
      if (mode === 'matchEnd') {
        const won = data.winner === 'ember';
        title.innerHTML = won ? 'Ember takes Rustyard' : 'Slate takes Rustyard';
        copy.textContent = `${data.scoreEmber} — ${data.scoreSlate}. ${won ? 'The yard is yours.' : 'Run it back.'}`;
      } else {
        const text = COPY[mode];
        title.innerHTML = text.title;
        copy.textContent = text.copy;
      }
      play.textContent = COPY[mode]?.action ?? 'Play again';
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    minimap(px, pz, yaw, teammates, heard, charge, smokes) {
      mapCtx.putImageData(staticLayer, 0, 0);
      if (charge) {
        const [cx, cz] = toMap(charge.x, charge.z);
        mapCtx.fillStyle = '#e5484d';
        mapCtx.beginPath();
        mapCtx.arc(cx, cz, 4, 0, Math.PI * 2);
        mapCtx.fill();
      }
      for (const smoke of smokes ?? []) {
        const [sx, sz] = toMap(smoke.position.x, smoke.position.z);
        mapCtx.fillStyle = 'rgba(184, 191, 198, 0.8)';
        mapCtx.beginPath();
        mapCtx.arc(sx, sz, 6, 0, Math.PI * 2);
        mapCtx.fill();
      }
      for (const enemy of heard) {
        const [ex, ez] = toMap(enemy.x, enemy.z);
        mapCtx.fillStyle = '#e5484d';
        mapCtx.beginPath();
        mapCtx.arc(ex, ez, 2.5, 0, Math.PI * 2);
        mapCtx.fill();
      }
      for (const mate of teammates) {
        const [mx, mz] = toMap(mate.x, mate.z);
        mapCtx.fillStyle = '#f5a52e';
        mapCtx.beginPath();
        mapCtx.arc(mx, mz, 2.5, 0, Math.PI * 2);
        mapCtx.fill();
      }
      const [mapX, mapZ] = toMap(px, pz);
      mapCtx.save();
      mapCtx.translate(mapX, mapZ);
      mapCtx.rotate(-yaw);
      mapCtx.fillStyle = '#ece7db';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -5);
      mapCtx.lineTo(3.5, 4);
      mapCtx.lineTo(-3.5, 4);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
  };
}
