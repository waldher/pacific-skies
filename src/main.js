// Game loop: flight, combat, surface patrols, conquest, camera and rendering.
import { recordSession, sessionSummary } from './session-report.js';
import { updateGuidance } from './objectives.js';
import { updateIntelligence } from './intelligence.js';
import { initOperations, drawOperations } from './operations.js';
import { CONFIG } from './config.js';
import { game, startGame, recoverPilot, resumeCampaign } from './state.js';
import { updateCampaignSave, hasSavedCampaign, saveCampaign } from './persistence.js';
import { cvs, ctx, view } from './canvas.js';
import { keys, stick, fireTouch, initInput } from './input.js';
import { updatePlayer, damagePlayer } from './player.js';
import { spawnDefenders, updateEnemies } from './enemies.js';
import { explosion, updateParticles, splash } from './particles.js';
import { updateCampaign } from './campaign.js';
import { updateShips } from './ships.js';
import { updateAirWar } from './airwar.js';
import { updateTorpedoes, launchTorpedo } from './torpedoes.js';
import { launchBomb, updateBombs } from './bombs.js';
import { updateStrikes } from './strikes.js';
import { updateConvoys, spawnConvoy, damageTransport } from './convoys.js';
import { hitsShip } from './ships.js';
import { selectSortie } from './bases.js';
import { requestCarrier } from './carrier.js';
import { createRenderer } from './renderer.js';
import { drawHud, drawMenus } from './hud.js';
import { lerp, angDiff, rand, setSeed } from './util.js';

window.addEventListener('pagehide', () => saveCampaign(game));
document.addEventListener?.('visibilitychange', () => { if (document.hidden) saveCampaign(game); });
let graphics;
let contextLost = false;

function update(dt) {
  if (game.paused) return;
  if (game.mode !== 'play') return;
  game.time += dt;

  if (game.player.flight === 'flying') game.flightSeconds += dt;
  updatePlayer(dt);
  updateAirWar(dt);
  updateEnemies(dt);
  updateStrikes(game, dt);
  updateShips(dt);
  updateConvoys(game, dt);
  updateTorpedoes(dt);
  updateBombs(game, dt);
  game.messageTime = Math.max(0, game.messageTime - dt);

  // bullets
  for (const b of game.bullets) { b.prevX = b.x; b.prevY = b.y; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
  for (const b of game.ebullets) { b.prevX = b.x; b.prevY = b.y; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
  // Rounds that run out of range hit the sea.
  for (const b of game.bullets) if (b.life <= 0) splash(b.x, b.y);
  for (const b of game.ebullets) if (b.life <= 0) splash(b.x, b.y);

  for (const b of game.bullets) {
    if (b.life <= 0) continue;
    for (const e of game.enemies) {
      if (e.hp <= 0) continue;
      if (Math.hypot(b.x - e.x, b.y - e.y) < 18) {
        b.life = 0; e.hp--;
        game.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.2, max: 0.2, size: 3, kind: 'fire' });
        if (e.hp <= 0) {
          if (e.rescue) game.rescue.intercepts = (game.rescue.intercepts || 0) + 1;
          game.score += e.ace ? CONFIG.score.aceKill : CONFIG.score.kill;
          if (!b.fromAlly && !b.fromShip) {
            game.playerMerit = (game.playerMerit || 0) + 1;
            if (e.strike) game.raidIntercepts = (game.raidIntercepts || 0) + 1;
          }
          explosion(e.x, e.y, false);
        }
        break;
      }
    }
  }
  // Transports are soft targets: any round that crosses a hull counts.
  for (const b of game.bullets) {
    if (b.life <= 0) continue;
    for (const s of game.convoys) {
      if (s.hp <= 0 || !hitsShip(b, s)) continue;
      b.life = 0; damageTransport(game, s, 1);
      game.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.2, max: 0.2, size: 3, kind: 'fire' });
      break;
    }
  }
  for (const b of game.ebullets) {
    if (b.life <= 0) continue;
    if (game.player.flight === 'flying' && Math.hypot(b.x - game.player.x, b.y - game.player.y) < 15) {
      b.life = 0;
      damagePlayer(b.damage ?? CONFIG.enemy.bulletDamage);
    }
    if (b.life > 0) for (const ally of game.allies) {
      if (ally.hp <= 0 || Math.hypot(b.x - ally.x, b.y - ally.y) >= 15) continue;
      b.life = 0; ally.hp -= b.damage ?? CONFIG.enemy.bulletDamage; ally.hitFlash = .25;
      if (ally.hp <= 0) explosion(ally.x, ally.y, false);
      break;
    }
  }

  game.bullets = game.bullets.filter(b => b.life > 0);
  game.ebullets = game.ebullets.filter(b => b.life > 0);
  game.enemies = game.enemies.filter(e => e.hp > 0);
  game.allies = game.allies.filter(f => f.hp > 0);

  updateParticles(dt);

  if (game.mode === 'play') updateCampaign(game, dt, spawnDefenders);

  updateIntelligence(game, dt);
  updateGuidance(game);
  recordSession(game);
  updateCampaignSave(game);

  // camera: lead slightly ahead of the nose
  const player = game.player, lead = player.flight === 'flying' ? CONFIG.camera.lead : 0;
  game.cam.x = lerp(game.cam.x, player.x + Math.cos(player.a) * lead, 1 - Math.pow(0.005, dt));
  game.cam.y = lerp(game.cam.y, player.y + Math.sin(player.a) * lead, 1 - Math.pow(0.005, dt));
  game.shake = Math.max(0, game.shake - 30 * dt);
}

function render(dt) {
  const shakeX = game.shake > 0 ? rand(-game.shake, game.shake) * .5 : 0;
  const shakeY = game.shake > 0 ? rand(-game.shake, game.shake) * .5 : 0;
  graphics.render(game, view, game.paused ? 0 : dt, shakeX, shakeY);
  ctx.clearRect(0, 0, view.W, view.H);
  ctx.save();
  ctx.translate(shakeX, shakeY);
  if (game.player) drawHud();
  ctx.restore();
  drawMenus();
  drawOperations(game);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (!contextLost) {
    update(dt);
    render(dt);
  }
  requestAnimationFrame(frame);
}
// Debug/test API: the playtest harness (and console tinkering) reads
// live state and drives input through this handle.
window.__game = { sessionSummary: () => sessionSummary(game), game, CONFIG, startGame, recoverPilot, resumeCampaign, hasSavedCampaign, setSeed, keys, stick, fireTouch, view, angDiff, update, launchTorpedo, launchBomb: () => launchBomb(game), selectSortie: options => selectSortie(game, options), requestCarrier: () => requestCarrier(game), spawnConvoy: () => spawnConvoy(game) };


const status = document.getElementById('loading');
const statusText = document.getElementById('loading-text');
const retry = document.getElementById('retry');
retry.addEventListener('click', () => location.reload());
window.__game.rendering = { ready: false, error: null };
const worldCanvas = document.getElementById('world');
worldCanvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  contextLost = true;
  for (const key of Object.keys(keys)) keys[key] = false;
  stick.active = fireTouch.active = false;
  statusText.textContent = 'Graphics paused. Waiting for your device to recover…';
  status.hidden = false;
  retry.hidden = false;
});
worldCanvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  status.hidden = true;
  retry.hidden = true;
});

async function boot() {
  try {
    graphics = await createRenderer(worldCanvas);
    window.__game.graphics = graphics;
    window.__game.rendering = graphics.diagnostics;
    status.hidden = true;
    initInput(cvs);
    initOperations(game);
    last = performance.now();
    requestAnimationFrame(frame);
  } catch (error) {
    window.__game.rendering.error = String(error);
    statusText.textContent = 'Unable to load the 3D game. Check your connection and that WebGL 2 is enabled, then retry.';
    retry.hidden = false;
    console.error('Pacific Skies could not start:', error);
  }
}
boot();
