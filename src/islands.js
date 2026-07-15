// Key islands: ownership, AA fire, recapture progress, resupply
// zones, and drawing. The four islands come from CONFIG.islands and
// are built in state.js; everything at runtime lives on game.islands.
import { CONFIG } from './config.js';
import { game, setBanner } from './state.js';
import { ctx, view, w2s } from './canvas.js';
import { hash2, TAU } from './util.js';
import { sfxDing, sfxAlarm } from './audio.js';

export function nearestEnemyIsland(x, y) {
  let best = null, bd = Infinity;
  for (const isl of game.islands) {
    if (isl.owner !== 'enemy') continue;
    const d = Math.hypot(isl.x - x, isl.y - y);
    if (d < bd) { bd = d; best = isl; }
  }
  return best;
}

// last structure down → the island is yours
export function captureIsland(isl) {
  isl.owner = 'player';
  isl.capture = 0;
  game.score += CONFIG.score.capture;
  setBanner(isl.name + ' SECURED', 2.6);
  sfxDing();
}

// raiders held it long enough → it flips back, defenses partially rebuilt
function loseIsland(isl) {
  isl.owner = 'enemy';
  isl.capture = 0;
  isl.stock = isl.cap * 2;
  isl.defT = 0;
  for (const s of isl.structures) s.hp = Math.ceil(s.max * 0.6);
  setBanner(isl.name + ' LOST', 2.6);
  sfxAlarm();
}

export function updateIslands(dt) {
  const I = CONFIG.island, P = CONFIG.player, player = game.player;
  for (const isl of game.islands) {
    isl.alert = Math.max(0, isl.alert - dt);

    if (isl.owner === 'enemy') {
      // AA guns fire at the player with a simple lead
      const pd = Math.hypot(player.x - isl.x, player.y - isl.y);
      if (player.phase === 'air' && pd < isl.r + I.aa.range) {
        for (const s of isl.structures) {
          if (s.kind !== 'aa' || s.hp <= 0) continue;
          s.fireCd -= dt;
          if (s.fireCd > 0) continue;
          const gx = isl.x + s.dx, gy = isl.y + s.dy;
          const d = Math.hypot(player.x - gx, player.y - gy);
          if (d > I.aa.range) continue;
          s.fireCd = I.aa.cooldown;
          const t = d / I.aa.bulletSpeed;
          const a = Math.atan2(
            player.y + Math.sin(player.a) * player.speed * t - gy,
            player.x + Math.cos(player.a) * player.speed * t - gx
          );
          game.ebullets.push({
            x: gx, y: gy,
            vx: Math.cos(a) * I.aa.bulletSpeed,
            vy: Math.sin(a) * I.aa.bulletSpeed,
            life: (I.aa.range / I.aa.bulletSpeed) * 1.15,
            dmg: I.aa.damage,
          });
        }
      }
    } else {
      // raiders orbiting a friendly island wind its capture clock
      let raiders = 0;
      for (const e of game.enemies) {
        if (e.role === 'raider' && e.target === isl &&
            Math.hypot(e.x - isl.x, e.y - isl.y) < isl.r + 180) raiders++;
      }
      if (raiders > 0) {
        isl.capture = Math.min(1, isl.capture + dt / I.captureTime);
        isl.alert = 1;
        if (isl.capture >= 1) loseIsland(isl);
      } else {
        isl.capture = Math.max(0, isl.capture - I.captureRegen * dt);
      }

      // friendly resupply zone: ammo trickles back overhead
      if (player.phase === 'air' && player.ammo < P.ammoMax &&
          Math.hypot(player.x - isl.x, player.y - isl.y) < isl.r * I.rearmRadius) {
        player.ammo = Math.min(P.ammoMax, player.ammo + P.ammoMax * I.rearmRate * dt);
      }
    }
  }
}

function drawStructure(isl, s) {
  const [sx, sy] = w2s(isl.x + s.dx, isl.y + s.dy);
  if (s.kind === 'aa') {
    if (s.hp > 0) {
      ctx.fillStyle = '#4c5145';
      ctx.beginPath(); ctx.arc(sx, sy, 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2e3129'; ctx.lineWidth = 3;
      const a = Math.atan2(game.player.y - (isl.y + s.dy), game.player.x - (isl.x + s.dx));
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * 13, sy + Math.sin(a) * 13); ctx.stroke();
      // hp pips
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(sx - 8, sy - 14, 16 * (s.hp / s.max), 2);
    } else {
      ctx.fillStyle = 'rgba(40,42,38,0.7)';
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,20,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 5); ctx.lineTo(sx + 5, sy + 5);
      ctx.moveTo(sx + 5, sy - 5); ctx.lineTo(sx - 5, sy + 5);
      ctx.stroke();
    }
  } else { // hq
    if (s.hp > 0) {
      ctx.fillStyle = '#c9b98a';
      ctx.fillRect(sx - 10, sy - 7, 20, 14);
      ctx.fillStyle = '#8a7a55';
      ctx.fillRect(sx - 10, sy - 7, 20, 4);
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(sx - 10, sy - 12, 20 * (s.hp / s.max), 2);
    } else {
      ctx.fillStyle = 'rgba(70,64,50,0.8)';
      ctx.fillRect(sx - 9, sy - 6, 18, 12);
    }
  }
}

function drawFlag(x, y, owner) {
  const [sx, sy] = w2s(x, y);
  ctx.strokeStyle = '#eee'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 22); ctx.stroke();
  const wave = Math.sin(game.time * 6) * 2;
  ctx.fillStyle = owner === 'player' ? '#33597d' : '#c43a2f';
  ctx.beginPath();
  ctx.moveTo(sx, sy - 22);
  ctx.lineTo(sx + 15, sy - 19 + wave);
  ctx.lineTo(sx, sy - 14);
  ctx.closePath(); ctx.fill();
}

export function drawKeyIslands() {
  const { W, H } = view;
  for (const isl of game.islands) {
    const [sx, sy] = w2s(isl.x, isl.y);
    const R = isl.r;
    if (sx < -R * 2 || sx > W + R * 2 || sy < -R * 2 || sy > H + R * 2) continue;

    // terrain blobs, same style as the procedural islands
    const seed = 101 + isl.idx * 17;
    const blob = (rad, jit, s2) => {
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * TAU;
        const r = rad * (1 - jit + hash2(seed * 9 + i + s2, isl.idx * 9 + i) * jit * 2);
        const px = sx + Math.cos(a) * r, py = sy + Math.sin(a) * r * 0.85;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    };
    ctx.fillStyle = 'rgba(120,200,210,0.35)'; blob(R * 1.25, 0.18, 1);
    ctx.fillStyle = '#e3d49b'; blob(R, 0.22, 2);
    ctx.fillStyle = '#4f8a4a'; blob(R * 0.62, 0.3, 3);
    ctx.fillStyle = '#3b6e39';
    for (let i = 0; i < 5; i++) {
      const a = hash2(seed + i * 13, isl.idx + i * 7) * TAU;
      const r = hash2(isl.idx + i, seed + i * 3) * R * 0.45;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.8, R * 0.09, 0, TAU);
      ctx.fill();
    }

    // ownership ring
    ctx.strokeStyle = isl.owner === 'player' ? 'rgba(127,195,107,0.35)' : 'rgba(255,123,107,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.35, R * 1.35 * 0.85, 0, 0, TAU); ctx.stroke();

    // recapture progress arc + alert pulse
    if (isl.capture > 0) {
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(sx, sy, R * 1.35, R * 1.35 * 0.85, 0, -Math.PI / 2, -Math.PI / 2 + isl.capture * TAU);
      ctx.stroke();
    }
    if (isl.alert > 0) {
      const pulse = 0.25 + 0.2 * Math.sin(game.time * 10);
      ctx.strokeStyle = `rgba(255,90,70,${pulse.toFixed(3)})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.5, R * 1.5 * 0.85, 0, 0, TAU); ctx.stroke();
    }

    for (const s of isl.structures) drawStructure(isl, s);
    if (isl.owner === 'player') drawFlag(isl.x, isl.y - 20, 'player');

    // name plate
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '700 13px "Courier New", monospace';
    ctx.fillStyle = isl.owner === 'player' ? 'rgba(170,220,150,0.9)' : 'rgba(255,160,145,0.9)';
    ctx.fillText(isl.name, sx, sy + R * 0.95 + 8);
  }
}
