import '../../shared/game-shell.css';
import Phaser from 'phaser';
import { ArcadeControls } from '../../shared/controls';
import { PauseController } from '../../shared/pause';
import { startArcadeGame } from '../../shared/phaser-config';
import { ArcadeGameOverScene, buildMenu } from '../../shared/scenes';
import { noise, tone } from '../../shared/sfx';
import { getHighScore } from '../../shared/storage';
import { isTouchDevice, VirtualButton, VirtualStick } from '../../shared/touch';
import { burstEmitter, floatText, NEON, neonText, PIXEL_FONT, reducedMotion, showBanner } from '../../shared/ui';

const GAME_ID = 'agbero';
const WIDTH = 800;
const HEIGHT = 600;
/** The walkable floor of the garage (feet y). Everything stands somewhere between these two. */
const FLOOR_TOP = 405;
const FLOOR_BOTTOM = 566;

const PLAYER_HP = 100;
const PLAYER_SPEED_X = 200;
const PLAYER_SPEED_Y = 140;
const PUNCH_TIME = 0.28;
const KICK_TIME = 0.52;
const COMBO_WINDOW = 1.4;
const MAX_MULT = 5;
const SHOUT_COST = 100;

type EnemyKind = 'grunt' | 'speedy' | 'bruiser' | 'boss';

interface EnemyStats {
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  reach: number;
  wind: number;
  scale: number;
  shirt: number;
  pants: number;
}

const ENEMIES: Record<EnemyKind, EnemyStats> = {
  grunt: { name: 'RIVAL BOY', hp: 30, speed: 72, dmg: 8, reach: 46, wind: 0.45, scale: 1, shirt: 0xc0392b, pants: 0x2c3e50 },
  speedy: { name: 'SPEEDY', hp: 18, speed: 140, dmg: 6, reach: 42, wind: 0.28, scale: 0.9, shirt: 0x2980b9, pants: 0x1b2a38 },
  bruiser: { name: 'BIG BOBO', hp: 85, speed: 48, dmg: 16, reach: 58, wind: 0.68, scale: 1.25, shirt: 0x8e44ad, pants: 0x2a1a33 },
  boss: { name: 'OGA BOSS', hp: 280, speed: 62, dmg: 22, reach: 68, wind: 0.55, scale: 1.55, shirt: 0x111111, pants: 0x4a1010 },
};

interface Fighter {
  x: number;
  y: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  vx: number;
  stun: number;
  flash: number;
  walk: number;
}

interface Enemy extends Fighter {
  kind: EnemyKind;
  stats: EnemyStats;
  windup: number;
  cooldown: number;
  slot: number;
  dying: number;
}

interface Pickup {
  kind: 'zobo' | 'naira';
  x: number;
  y: number;
  age: number;
}

const POW = ['POW!', 'WHAM!', 'KPAI!', 'OYA!', 'BAM!'];

/* ------------------------------------------------------------------ drawing */

interface Pose {
  scale: number;
  shirt: number;
  pants: number;
  skin: number;
  cap: number;
  walk: number;
  punch: number;
  kick: number;
  flash: boolean;
  down: number;
}

/** A blocky Lagos fighter. (x, y) is the point between the feet; facing is 1 for right, -1 for left. */
function drawFighter(g: Phaser.GameObjects.Graphics, x: number, y: number, facing: 1 | -1, p: Pose): void {
  const s = p.scale;
  const white = 0xffffff;
  const shirt = p.flash ? white : p.shirt;
  const pants = p.flash ? white : p.pants;
  const skin = p.flash ? white : p.skin;
  const cap = p.flash ? white : p.cap;
  const rect = (cx: number, cy: number, w: number, h: number, color: number): void => {
    g.fillStyle(color, 1);
    const left = facing > 0 ? x + cx * s : x - (cx + w) * s;
    g.fillRect(left, y + cy * s, w * s, h * s);
  };

  g.fillStyle(0x000000, 0.35).fillEllipse(x, y, 40 * s, 10 * s);
  if (p.down > 0) {
    // Knocked out: lying flat, fading with p.down (1 to 0).
    g.fillStyle(shirt, p.down).fillRect(x - 24 * s, y - 14 * s, 30 * s, 14 * s);
    g.fillStyle(pants, p.down).fillRect(x + 4 * s, y - 12 * s, 24 * s, 10 * s);
    g.fillStyle(skin, p.down).fillCircle(x - 28 * s, y - 8 * s, 8 * s);
    return;
  }

  const swing = Math.sin(p.walk) * 6;
  rect(-9 + swing, -28, 9, 28, pants);
  if (p.kick > 0) {
    rect(2, -36, 14 + 34 * p.kick, 10, pants);
    rect(14 + 34 * p.kick, -37, 9, 12, 0x111111);
  } else {
    rect(1 - swing, -28, 9, 28, pants);
    rect(1 - swing, -4, 12, 4, 0x111111);
  }
  rect(-9 + swing, -4, 12, 4, 0x111111);
  rect(-11, -58, 22, 32, shirt);
  rect(-4, -56, 8, 22, skin);
  g.fillStyle(skin, 1).fillCircle(x + facing * 2 * s, y - 68 * s, 9 * s);
  rect(-8, -80, 20, 7, cap);
  if (p.punch > 0) {
    rect(6, -54, 10 + 34 * p.punch, 9, skin);
    g.fillStyle(skin, 1).fillCircle(x + facing * (16 + 34 * p.punch) * s, y - 49.5 * s, 6 * s);
  } else {
    rect(6, -56, 9, 22, skin);
  }
}

function drawDanfo(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x000000, 0.3).fillEllipse(x, y, 160, 12);
  g.fillStyle(0xf6c90e, 1).fillRoundedRect(x - 78, y - 62, 156, 50, 6);
  g.fillStyle(0x111111, 1).fillRect(x - 78, y - 38, 156, 8);
  g.fillStyle(0x7bbbe0, 1);
  for (let i = 0; i < 5; i++) g.fillRect(x - 70 + i * 28, y - 58, 22, 16);
  g.fillStyle(0xffe9a0, 1).fillRect(x + 74, y - 34, 6, 8);
  g.fillStyle(0xff3b30, 1).fillRect(x - 80, y - 34, 4, 8);
  for (const wx of [-48, 48]) {
    g.fillStyle(0x15151f, 1).fillCircle(x + wx, y - 10, 13);
    g.fillStyle(0x8a8ab8, 1).fillCircle(x + wx, y - 10, 5);
  }
}

function drawKorope(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x000000, 0.3).fillEllipse(x, y, 140, 12);
  g.fillStyle(0xe8eef5, 1).fillRoundedRect(x - 66, y - 74, 132, 62, 8);
  g.fillStyle(0xd62828, 1).fillRect(x - 66, y - 36, 132, 8);
  g.fillStyle(0x4a90c2, 1);
  for (let i = 0; i < 4; i++) g.fillRect(x - 58 + i * 28, y - 68, 22, 18);
  g.fillStyle(0xffe9a0, 1).fillRect(x + 62, y - 34, 6, 8);
  for (const wx of [-40, 40]) {
    g.fillStyle(0x15151f, 1).fillCircle(x + wx, y - 10, 13);
    g.fillStyle(0xcccccc, 1).fillCircle(x + wx, y - 10, 5);
  }
}

function drawKeke(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x000000, 0.3).fillEllipse(x, y, 90, 10);
  g.fillStyle(0x1f8a4c, 1).fillRoundedRect(x - 38, y - 42, 76, 30, 8);
  g.fillStyle(0xf6c90e, 1).fillRoundedRect(x - 34, y - 62, 68, 22, 8);
  g.fillStyle(0x111111, 1).fillRect(x - 30, y - 42, 60, 4);
  g.fillStyle(0x7bbbe0, 1).fillRect(x + 12, y - 56, 18, 12);
  for (const wx of [-26, 30]) {
    g.fillStyle(0x15151f, 1).fillCircle(x + wx, y - 8, 10);
    g.fillStyle(0xcccccc, 1).fillCircle(x + wx, y - 8, 4);
  }
}

/** Paints the whole garage: back wall, sign, parked vehicles and the dusty floor. Returns the graphics. */
function drawGarage(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(0);
  g.fillStyle(0x1b1325, 1).fillRect(0, 0, WIDTH, FLOOR_TOP - 40);
  // Corrugated zinc roof line and wall planks.
  g.fillStyle(0x3a3347, 1).fillRect(0, 0, WIDTH, 34);
  g.lineStyle(2, 0x2b2538, 1);
  for (let x = 0; x < WIDTH; x += 16) g.lineBetween(x, 0, x, 34);
  g.lineStyle(2, 0x241a30, 1);
  for (let y = 60; y < FLOOR_TOP - 40; y += 30) g.lineBetween(0, y, WIDTH, y);
  // Hanging bulbs.
  for (const bx of [120, 330, 540, 710]) {
    g.lineStyle(2, 0x444444, 1).lineBetween(bx, 34, bx, 62);
    g.fillStyle(0xffe45e, 0.18).fillCircle(bx, 70, 30);
    g.fillStyle(0xffe45e, 1).fillCircle(bx, 68, 7);
  }
  // Parked vehicles along the back.
  drawDanfo(g, 100, 360);
  drawKorope(g, 270, 366);
  drawKeke(g, 400, 366);
  drawDanfo(g, 560, 360);
  drawKorope(g, 720, 366);
  // Floor.
  g.fillStyle(0x4a3b2c, 1).fillRect(0, FLOOR_TOP - 40, WIDTH, HEIGHT - (FLOOR_TOP - 40));
  g.fillStyle(0x3a2e22, 1).fillRect(0, FLOOR_TOP - 40, WIDTH, 6);
  g.fillStyle(0x2c231a, 0.6);
  for (const [sx, sy, sw] of [[90, 470, 70], [330, 520, 90], [610, 450, 60], [700, 540, 80], [200, 555, 50]] as const) {
    g.fillEllipse(sx, sy, sw, sw / 4);
  }
  g.lineStyle(3, 0xf2e6c8, 0.35);
  for (let x = 20; x < WIDTH; x += 120) g.lineBetween(x, FLOOR_BOTTOM + 14, x + 60, FLOOR_BOTTOM + 14);
  neonText(scene, WIDTH / 2, 22, 'LAGOS MOTOR PARK', 14, NEON.yellow).setDepth(1);
  return g;
}

/* -------------------------------------------------------------------- scenes */

class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    drawGarage(this);
    this.add.rectangle(0, 0, WIDTH, HEIGHT, NEON.bg, 0.62).setOrigin(0).setDepth(2);
    buildMenu(this, {
      gameId: GAME_ID,
      title: ['AGBERO', 'RUMBLE'],
      colors: [NEON.yellow, NEON.green],
      help: 'Move: arrows / WASD / stick    Punch: Space    Kick: Shift or X    Oya Shout: C when the meter is full\nRival boys are in your park. Defend it!    Pause: P / Start',
    });
  }
}

class GameScene extends Phaser.Scene {
  private px = 160;
  private py = 480;
  private facing: 1 | -1 = 1;
  private hp = PLAYER_HP;
  private hurtT = 0;
  private walk = 0;
  private atk: 'punch' | 'kick' | null = null;
  private atkT = 0;
  private atkHit = false;
  private meter = 0;
  private combo = 0;
  private comboT = 0;
  private score = 0;
  private kills = 0;
  private wave = 0;
  private queue: EnemyKind[] = [];
  private spawnT = 0;
  private nextWaveT = 0;
  private over = false;
  private elapsed = 0;

  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];

  private gfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private controls!: ArcadeControls<'special'>;
  private pause!: PauseController;

  constructor() {
    super('Game');
  }

  init(): void {
    this.px = 160;
    this.py = 480;
    this.facing = 1;
    this.hp = PLAYER_HP;
    this.hurtT = 0;
    this.walk = 0;
    this.atk = null;
    this.atkT = 0;
    this.atkHit = false;
    this.meter = 0;
    this.combo = 0;
    this.comboT = 0;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.queue = [];
    this.spawnT = 0;
    this.nextWaveT = 0.8;
    this.over = false;
    this.elapsed = 0;
    this.enemies = [];
    this.pickups = [];
  }

  create(): void {
    this.cameras.main.fadeIn(250, 5, 5, 13);
    drawGarage(this);
    this.gfx = this.add.graphics().setDepth(5);
    this.hud = this.add.graphics().setDepth(20);
    this.burst = burstEmitter(this, 280, 500);

    const label = { fontFamily: PIXEL_FONT, fontSize: '11px', color: '#e8e8ff' };
    this.scoreText = this.add.text(WIDTH - 20, 16, '', { ...label, fontSize: '16px' }).setOrigin(1, 0).setDepth(21);
    this.waveText = this.add.text(WIDTH / 2, 48, '', { ...label, color: '#ffe45e' }).setOrigin(0.5, 0).setDepth(21);
    this.comboText = this.add.text(WIDTH - 20, 42, '', { ...label, color: '#3dff8a' }).setOrigin(1, 0).setDepth(21);
    this.add.text(20, 62, 'OYA SHOUT', { ...label, fontSize: '9px', color: '#8a8ab8' }).setDepth(21);
    this.add.text(WIDTH - 20, 64, `BEST ${getHighScore(GAME_ID).toLocaleString()}`, { ...label, fontSize: '9px', color: '#8a8ab8' }).setOrigin(1, 0).setDepth(21);

    this.controls = new ArcadeControls(this, { special: { keys: ['C', 'Z'], buttons: [2] } });
    if (isTouchDevice()) {
      const stick = new VirtualStick(this, new Phaser.Geom.Rectangle(0, 250, 400, 350), 58);
      this.controls.setStick(() => stick.value);
      const punch = new VirtualButton(this, 730, 505, 'PUNCH', NEON.cyan, 42);
      const kick = new VirtualButton(this, 635, 540, 'KICK', NEON.pink, 40);
      const shout = new VirtualButton(this, 735, 410, 'OYA', NEON.yellow, 34);
      this.controls.addVirtual('action', () => punch.isDown);
      this.controls.addVirtual('alt', () => kick.isDown);
      this.controls.addVirtual('special', () => shout.isDown);
    }
    this.pause = new PauseController(this, this.controls, { canPause: () => !this.over });
  }

  update(_time: number, deltaMs: number): void {
    if (this.pause.isPaused || this.over) return;
    const dt = Math.min(deltaMs, 50) / 1000;
    this.elapsed += dt;
    this.updatePlayer(dt);
    this.updateWaves(dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.separate();
    this.enemies = this.enemies.filter((e) => e.dying < 1);
    this.updatePickups(dt);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    this.draw();
  }

  /* ---------------------------------------------------------------- player */

  private multiplier(): number {
    return Math.min(MAX_MULT, 1 + Math.floor(this.combo / 4));
  }

  private updatePlayer(dt: number): void {
    if (this.hurtT > 0) this.hurtT -= dt;
    const attacking = this.atk !== null;
    const ax = this.controls.axisX;
    const ay = this.controls.axisY;
    const slow = attacking ? 0.25 : 1;
    this.px = Phaser.Math.Clamp(this.px + ax * PLAYER_SPEED_X * slow * dt, 30, WIDTH - 30);
    this.py = Phaser.Math.Clamp(this.py + ay * PLAYER_SPEED_Y * slow * dt, FLOOR_TOP, FLOOR_BOTTOM);
    if (!attacking && Math.abs(ax) > 0.2) this.facing = ax > 0 ? 1 : -1;
    this.walk += (Math.abs(ax) + Math.abs(ay) > 0.2 ? 14 : 0) * dt;

    if (!attacking) {
      if (this.controls.justPressed('action')) this.startAttack('punch');
      else if (this.controls.justPressed('alt')) this.startAttack('kick');
      else if (this.controls.justPressed('special') && this.meter >= SHOUT_COST) this.shout();
    } else {
      this.atkT += dt;
      const total = this.atk === 'punch' ? PUNCH_TIME : KICK_TIME;
      const hitAt = this.atk === 'punch' ? 0.09 : 0.2;
      if (!this.atkHit && this.atkT >= hitAt) {
        this.atkHit = true;
        this.resolveAttack();
      }
      if (this.atkT >= total) this.atk = null;
    }
  }

  private startAttack(kind: 'punch' | 'kick'): void {
    this.atk = kind;
    this.atkT = 0;
    this.atkHit = false;
    tone({ freq: kind === 'punch' ? 260 : 180, toFreq: kind === 'punch' ? 140 : 90, duration: 0.07, type: 'square', volume: 0.05 });
  }

  /** Hits every enemy standing in front of the player, close enough in depth. */
  private resolveAttack(): void {
    const kick = this.atk === 'kick';
    const reach = kick ? 86 : 64;
    const damage = kick ? 22 : 11;
    let landed = false;
    for (const e of this.enemies) {
      if (e.dying > 0) continue;
      const dx = (e.x - this.px) * this.facing;
      if (dx < -8 || dx > reach + 10 * e.stats.scale || Math.abs(e.y - this.py) > 26) continue;
      landed = true;
      e.hp -= damage;
      e.stun = kick ? 0.6 : 0.28;
      e.vx = this.facing * (kick ? 340 : 150);
      e.flash = 0.14;
      e.windup = 0;
      this.combo++;
      this.comboT = COMBO_WINDOW;
      this.score += 10 * this.multiplier();
      this.meter = Math.min(SHOUT_COST, this.meter + (kick ? 9 : 5));
      this.burst.setParticleTint(kick ? NEON.pink : NEON.yellow);
      this.burst.explode(kick ? 14 : 8, e.x, e.y - 50);
      floatText(this, e.x, e.y - 90, POW[Phaser.Math.Between(0, POW.length - 1)], kick ? NEON.pink : NEON.yellow, 12);
      if (e.hp <= 0) this.kill(e);
    }
    if (landed) {
      noise(kick ? 0.14 : 0.08, kick ? 0.12 : 0.08);
      if (kick && !reducedMotion()) this.cameras.main.shake(90, 0.004);
    }
  }

  private shout(): void {
    this.meter = 0;
    showBanner(this, 'OYA! OYA! OYA!', NEON.yellow, 200);
    tone({ freq: 220, toFreq: 880, duration: 0.4, type: 'sawtooth', volume: 0.09 });
    if (!reducedMotion()) {
      this.cameras.main.flash(200, 255, 228, 94);
      this.cameras.main.shake(220, 0.01);
    }
    for (const e of this.enemies) {
      if (e.dying > 0) continue;
      e.hp -= 25;
      e.stun = 1;
      e.windup = 0;
      e.vx = Math.sign(e.x - this.px || 1) * 320;
      e.flash = 0.2;
      this.burst.setParticleTint(NEON.yellow);
      this.burst.explode(10, e.x, e.y - 50);
      if (e.hp <= 0) this.kill(e);
    }
  }

  private hurtPlayer(damage: number, fromX: number): void {
    if (this.hurtT > 0) return;
    this.hp -= damage;
    this.hurtT = 0.45;
    this.combo = 0;
    this.comboT = 0;
    this.px = Phaser.Math.Clamp(this.px + Math.sign(this.px - fromX || 1) * 26, 30, WIDTH - 30);
    this.atk = null;
    noise(0.18, 0.12);
    if (!reducedMotion()) this.cameras.main.shake(140, 0.008);
    this.burst.setParticleTint(NEON.pink);
    this.burst.explode(10, this.px, this.py - 50);
    if (this.hp <= 0) {
      this.hp = 0;
      this.over = true;
      this.cameras.main.flash(180, 255, 46, 151);
      this.time.delayedCall(800, () =>
        this.scene.start('GameOver', { gameId: GAME_ID, score: this.score, detail: `WAVE ${this.wave}   ${this.kills} KO` }),
      );
    }
  }

  /* ----------------------------------------------------------------- waves */

  private updateWaves(dt: number): void {
    if (this.queue.length === 0 && this.enemies.length === 0) {
      this.nextWaveT -= dt;
      if (this.nextWaveT <= 0) this.startWave();
      return;
    }
    const maxAlive = Math.min(6, 3 + Math.floor(this.wave / 2));
    this.spawnT -= dt;
    const alive = this.enemies.filter((e) => e.dying === 0).length;
    if (this.queue.length > 0 && alive < maxAlive && this.spawnT <= 0) {
      this.spawn(this.queue.shift() as EnemyKind);
      this.spawnT = 0.9;
    }
  }

  private startWave(): void {
    this.wave++;
    const n = this.wave;
    const list: EnemyKind[] = [];
    for (let i = 0; i < 2 + n; i++) list.push('grunt');
    if (n >= 2) for (let i = 0; i < Math.floor(n / 2) + 1; i++) list.push('speedy');
    if (n >= 3) for (let i = 0; i < Math.floor((n - 1) / 2); i++) list.push('bruiser');
    if (n % 5 === 0) list.push('boss');
    this.queue = Phaser.Utils.Array.Shuffle(list) as EnemyKind[];
    this.spawnT = 0;
    this.nextWaveT = 2;
    showBanner(this, n % 5 === 0 ? `WAVE ${n}: OGA BOSS!` : `WAVE ${n}`, n % 5 === 0 ? NEON.pink : NEON.cyan, 230);
    tone({ freq: 392, toFreq: 587, duration: 0.2 });
  }

  private spawn(kind: EnemyKind): void {
    const stats = ENEMIES[kind];
    const fromLeft = Math.random() < 0.5;
    this.enemies.push({
      x: fromLeft ? -30 : WIDTH + 30,
      y: Phaser.Math.Between(FLOOR_TOP, FLOOR_BOTTOM),
      facing: fromLeft ? 1 : -1,
      hp: stats.hp,
      maxHp: stats.hp,
      vx: 0,
      stun: 0,
      flash: 0,
      walk: 0,
      kind,
      stats,
      windup: 0,
      cooldown: 0.6,
      slot: Phaser.Math.Between(-24, 24),
      dying: 0,
    });
  }

  private kill(e: Enemy): void {
    if (e.dying > 0) return;
    e.dying = 0.001;
    this.kills++;
    this.score += (e.kind === 'boss' ? 500 : 50) * this.multiplier();
    this.meter = Math.min(SHOUT_COST, this.meter + 8);
    const roll = Math.random();
    if (e.kind === 'boss' || roll < 0.2) this.pickups.push({ kind: 'zobo', x: e.x, y: e.y, age: 0 });
    else if (roll < 0.5) this.pickups.push({ kind: 'naira', x: e.x, y: e.y, age: 0 });
    tone({ freq: 330, toFreq: 110, duration: 0.18, type: 'sawtooth', volume: 0.06 });
  }

  /* --------------------------------------------------------------- enemies */

  private updateEnemy(e: Enemy, dt: number): void {
    if (e.dying > 0) {
      e.dying += dt * 1.1;
      return;
    }
    if (e.flash > 0) e.flash -= dt;
    if (e.stun > 0) {
      e.stun -= dt;
      e.x = Phaser.Math.Clamp(e.x + e.vx * dt, -40, WIDTH + 40);
      e.vx *= Math.pow(0.02, dt);
      return;
    }
    const dx = this.px - e.x;
    const dy = this.py - e.y;
    e.facing = dx >= 0 ? 1 : -1;

    if (e.windup > 0) {
      e.windup -= dt;
      if (e.windup <= 0) {
        if (Math.abs(this.px - e.x) < e.stats.reach + 12 && Math.abs(this.py - e.y) < 28) this.hurtPlayer(e.stats.dmg, e.x);
        e.cooldown = 0.9 + Math.random() * 0.9;
      }
      return;
    }
    if (e.cooldown > 0) e.cooldown -= dt;

    const targetX = this.px - e.facing * (e.stats.reach * 0.8) + e.slot * 0.2;
    const mx = targetX - e.x;
    const speed = e.stats.speed;
    if (Math.abs(mx) > 6) {
      e.x += Math.sign(mx) * Math.min(Math.abs(mx), speed * dt);
      e.walk += 10 * dt;
    }
    if (Math.abs(dy) > 6) {
      e.y += Math.sign(dy) * Math.min(Math.abs(dy), speed * 0.7 * dt);
      e.walk += 6 * dt;
    }
    e.y = Phaser.Math.Clamp(e.y, FLOOR_TOP, FLOOR_BOTTOM);
    if (e.cooldown <= 0 && Math.abs(dx) < e.stats.reach && Math.abs(dy) < 20) e.windup = e.stats.wind;
  }

  /** Nudges overlapping enemies apart so the crowd spreads out instead of stacking. */
  private separate(): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.dying > 0 || b.dying > 0) continue;
        const ddx = a.x - b.x;
        const ddy = a.y - b.y;
        if (Math.abs(ddx) < 34 && Math.abs(ddy) < 14) {
          const push = ddy === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(ddy);
          a.y = Phaser.Math.Clamp(a.y + push * 1.2, FLOOR_TOP, FLOOR_BOTTOM);
          b.y = Phaser.Math.Clamp(b.y - push * 1.2, FLOOR_TOP, FLOOR_BOTTOM);
        }
      }
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.age += dt;
      if (p.age > 9) {
        this.pickups.splice(i, 1);
        continue;
      }
      if (Math.abs(p.x - this.px) < 32 && Math.abs(p.y - this.py) < 24) {
        if (p.kind === 'zobo') {
          this.hp = Math.min(PLAYER_HP, this.hp + 30);
          floatText(this, p.x, p.y - 50, 'ZOBO! +30', NEON.pink, 12);
        } else {
          this.score += 100;
          this.meter = Math.min(SHOUT_COST, this.meter + 12);
          floatText(this, p.x, p.y - 50, '+100', NEON.green, 12);
        }
        tone({ freq: 700, toFreq: 1000, duration: 0.1 });
        this.pickups.splice(i, 1);
      }
    }
  }

  /* --------------------------------------------------------------- drawing */

  private draw(): void {
    const g = this.gfx.clear();
    type Item = { y: number; paint: () => void };
    const items: Item[] = [];

    for (const p of this.pickups) {
      items.push({
        y: p.y,
        paint: () => {
          const bob = Math.sin(p.age * 6) * 3;
          if (p.kind === 'zobo') {
            g.fillStyle(0xb5179e, 1).fillRoundedRect(p.x - 7, p.y - 30 + bob, 14, 24, 3);
            g.fillStyle(0xffffff, 1).fillRect(p.x - 5, p.y - 36 + bob, 10, 7);
          } else {
            g.fillStyle(0x2e9e57, 1).fillRoundedRect(p.x - 16, p.y - 22 + bob, 32, 18, 3);
            g.fillStyle(0xd8ffe0, 1).fillRect(p.x - 5, p.y - 16 + bob, 10, 3).fillRect(p.x - 5, p.y - 10 + bob, 10, 3);
          }
        },
      });
    }

    for (const e of this.enemies) {
      items.push({
        y: e.y,
        paint: () => {
          const winding = e.windup > 0;
          const t = winding ? 1 - e.windup / e.stats.wind : 0;
          drawFighter(g, e.x, e.y, e.facing, {
            scale: e.stats.scale,
            shirt: e.stats.shirt,
            pants: e.stats.pants,
            skin: 0x8d5524,
            cap: e.kind === 'boss' ? 0xffd166 : 0x222222,
            walk: e.walk,
            punch: winding && t > 0.7 ? 1 : 0,
            kick: 0,
            flash: e.flash > 0 || (winding && Math.floor(this.elapsed * 20) % 2 === 0),
            down: e.dying > 0 ? Math.max(0, 1 - e.dying) : 0,
          });
          if (e.dying === 0) {
            const w = 38 * e.stats.scale;
            const top = e.y - 92 * e.stats.scale;
            g.fillStyle(0x000000, 0.6).fillRect(e.x - w / 2, top, w, 5);
            g.fillStyle(NEON.pink, 1).fillRect(e.x - w / 2, top, w * Math.max(0, e.hp / e.maxHp), 5);
          }
        },
      });
    }

    items.push({
      y: this.py,
      paint: () => {
        const punchP = this.atk === 'punch' ? Math.sin(Math.min(1, this.atkT / PUNCH_TIME) * Math.PI) : 0;
        const kickP = this.atk === 'kick' ? Math.sin(Math.min(1, this.atkT / KICK_TIME) * Math.PI) : 0;
        const blink = this.hurtT > 0 && Math.floor(this.elapsed * 18) % 2 === 0;
        drawFighter(g, this.px, this.py, this.facing, {
          scale: 1.05,
          shirt: 0xf5f0e1,
          pants: 0x1f6f3f,
          skin: 0x6b3f1d,
          cap: 0xe63946,
          walk: this.walk,
          punch: punchP,
          kick: kickP,
          flash: blink,
          down: 0,
        });
      },
    });

    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.paint();
    this.drawHud();
  }

  private drawHud(): void {
    const h = this.hud.clear();
    h.fillStyle(0x000000, 0.55).fillRect(18, 14, 244, 22);
    h.fillStyle(this.hp > 30 ? NEON.green : NEON.pink, 1).fillRect(20, 16, 240 * (this.hp / PLAYER_HP), 18);
    h.lineStyle(2, 0xffffff, 0.6).strokeRect(18, 14, 244, 22);
    h.fillStyle(0x000000, 0.55).fillRect(18, 42, 154, 14);
    const full = this.meter >= SHOUT_COST;
    h.fillStyle(full && Math.floor(this.elapsed * 6) % 2 === 0 ? 0xffffff : NEON.yellow, 1).fillRect(20, 44, 150 * (this.meter / SHOUT_COST), 10);
    h.lineStyle(2, 0xffffff, 0.5).strokeRect(18, 42, 154, 14);
    this.scoreText.setText(this.score.toLocaleString());
    this.waveText.setText(this.wave > 0 ? `WAVE ${this.wave}` : '');
    const mult = this.multiplier();
    this.comboText.setText(this.combo > 1 ? `${this.combo} HITS${mult > 1 ? `  x${mult}` : ''}` : '');
  }
}

void startArcadeGame({
  width: WIDTH,
  height: HEIGHT,
  scenes: [MenuScene, GameScene, ArcadeGameOverScene],
});
