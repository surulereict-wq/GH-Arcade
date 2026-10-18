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
/** The walkable floor of the motor park (feet y). Everything stands somewhere between these two. */
const FLOOR_TOP = 405;
const FLOOR_BOTTOM = 566;
/** Where the market stalls stand (feet y), just behind the walkable floor. */
const STALL_Y = 398;
/** Fighting above this line, right in front of the stalls, wrecks them. */
const STALL_ZONE = 448;
const STALL_HP = 60;

const PLAYER_HP = 100;
const PLAYER_SPEED_X = 200;
const PLAYER_SPEED_Y = 140;
const PUNCH_TIME = 0.28;
const KICK_TIME = 0.52;
const COMBO_WINDOW = 1.4;
const MAX_MULT = 5;
const SHOUT_COST = 100;

type EnemyKind = 'grunt' | 'speedy' | 'bruiser' | 'boss' | 'looter' | 'drunk';

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
  looter: { name: 'LOOTER', hp: 26, speed: 92, dmg: 7, reach: 44, wind: 0.4, scale: 0.95, shirt: 0xf1c40f, pants: 0x3b2f1e },
  drunk: { name: 'DRUNK', hp: 44, speed: 40, dmg: 14, reach: 56, wind: 0.75, scale: 1.1, shirt: 0x16a085, pants: 0x2c3e50 },
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
  /** Looters ignore the player (and wreck stalls) until they are hit. */
  aggro: boolean;
  target: number;
  smashT: number;
  smash: number;
}

type PickupKind = 'zobo' | 'naira' | 'suya' | 'amala' | 'sachet';

interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  age: number;
}

type PropKind = 'bottle' | 'chair';

interface Prop {
  kind: PropKind;
  x: number;
  y: number;
}

interface Shot {
  kind: PropKind;
  x: number;
  y: number;
  vx: number;
  life: number;
  spin: number;
}

interface Walker {
  kind: 'customer' | 'hawker';
  x: number;
  y: number;
  homeX: number;
  vx: number;
  face: 1 | -1;
  walk: number;
  wait: number;
  flee: boolean;
  shirt: number;
  pants: number;
  skin: number;
  cap: number;
  scale: number;
}

interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
}

type StallKind = 'beer' | 'food' | 'water' | 'suya' | 'zobo';

interface Stall {
  x: number;
  w: number;
  name: string;
  kind: StallKind;
  hp: number;
  maxHp: number;
  accent: number;
  awnA: number;
  awnB: number;
  shake: number;
  label: Phaser.GameObjects.Text | null;
}

const STALL_DEFS = [
  { x: 82, name: 'STAR BEER', kind: 'beer', accent: 0x3dff8a, awnA: 0x1e8449, awnB: 0xf4f1de },
  { x: 246, name: 'MAMA PUT', kind: 'food', accent: 0xffe45e, awnA: 0xe67e22, awnB: 0xfff3d6 },
  { x: 410, name: 'PURE WATER', kind: 'water', accent: 0x5ec8ff, awnA: 0x2e86de, awnB: 0xeaf6ff },
  { x: 574, name: 'SUYA SPOT', kind: 'suya', accent: 0xff7a3d, awnA: 0xc0392b, awnB: 0xf8e0c8 },
  { x: 736, name: 'ZOBO & KUNU', kind: 'zobo', accent: 0xff2e97, awnA: 0x8e1b55, awnB: 0xf5d6e6 },
] as const;

function makeStalls(): Stall[] {
  return STALL_DEFS.map((d) => ({
    x: d.x,
    w: 120,
    name: d.name,
    kind: d.kind,
    hp: STALL_HP,
    maxHp: STALL_HP,
    accent: d.accent,
    awnA: d.awnA,
    awnB: d.awnB,
    shake: 0,
    label: null,
  }));
}

const POW = ['POW!', 'WHAM!', 'KPAI!', 'OYA!', 'BAM!'];

/** The string of bulbs hanging across the park. */
function wireY(x: number): number {
  const u = (x - 30) / 740;
  return 206 + 104 * u * (1 - u);
}
const BULBS: ReadonlyArray<readonly [number, number]> = [90, 170, 250, 330, 410, 490, 570, 650, 730].map(
  (x) => [x, wireY(x) + 5] as const,
);

/* ------------------------------------------------------------------ helpers */

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** Darkens (f below 1) or lightens (f above 1) a colour. */
function shade(c: number, f: number): number {
  return f <= 1 ? mix(0x000000, c, f) : mix(c, 0xffffff, f - 1);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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
  /** 0 when standing; otherwise the opacity of the knocked-out body. */
  down: number;
  t: number;
  lean: number;
  shades: boolean;
  chain: boolean;
  hold: PropKind | null;
}

function limb(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, w: number, color: number): void {
  g.lineStyle(w, color, 1).lineBetween(x1, y1, x2, y2);
  g.fillStyle(color, 1).fillCircle(x1, y1, w / 2).fillCircle(x2, y2, w / 2);
}

/** A Lagos fighter built from rounded limbs. (x, y) is the point between the feet; facing is 1 for right, -1 for left. */
function drawFighter(g: Phaser.GameObjects.Graphics, x: number, y: number, facing: 1 | -1, p: Pose): void {
  const s = p.scale;
  const white = 0xffffff;
  const shirt = p.flash ? white : p.shirt;
  const pants = p.flash ? white : p.pants;
  const skin = p.flash ? white : p.skin;
  const cap = p.flash ? white : p.cap;
  const X = (cx: number): number => x + facing * cx * s;
  const Y = (cy: number): number => y + cy * s;
  const box = (cx: number, cy: number, cw: number, ch: number, color: number, r = 0, a = 1): void => {
    const x0 = Math.min(X(cx), X(cx + cw));
    g.fillStyle(color, a);
    if (r > 0) g.fillRoundedRect(x0, Y(cy), cw * s, ch * s, r * s);
    else g.fillRect(x0, Y(cy), cw * s, ch * s);
  };

  g.fillStyle(0x000000, 0.38).fillEllipse(x, y, 46 * s, 11 * s);
  if (p.down > 0) {
    // Knocked out: lying flat, fading with p.down (1 to 0).
    const a = p.down;
    box(4, -14, 28, 11, pants, 4, a);
    box(-26, -17, 32, 15, shirt, 5, a);
    box(30, -8, 8, 5, 0x111111, 2, a);
    g.fillStyle(skin, a).fillCircle(X(-33), Y(-10), 8 * s);
    box(-38, -17, 10, 5, cap, 2, a);
    return;
  }

  const stride = Math.sin(p.walk);
  const bob = Math.abs(Math.cos(p.walk)) * -2 + Math.sin(p.t * 3) * 0.8;
  const lean = p.lean;
  const uX = (cx: number): number => X(cx + lean);
  const uY = (cy: number): number => Y(cy + bob);

  // Legs.
  const backFoot = { x: -4 - stride * 10, y: -2 - Math.max(0, -Math.cos(p.walk)) * 5 };
  limb(g, X(-3), Y(-30), X(backFoot.x), Y(backFoot.y), 11 * s, shade(pants, 0.78));
  g.fillStyle(0x111111, 1).fillEllipse(X(backFoot.x + 3), Y(backFoot.y), 14 * s, 6 * s);
  if (p.kick > 0) {
    const fx = 14 + 46 * p.kick;
    const fy = -34 - 6 * p.kick;
    limb(g, X(4), Y(-30), X(fx), Y(fy), 11 * s, pants);
    g.fillStyle(0x111111, 1).fillEllipse(X(fx + 4), Y(fy), 15 * s, 8 * s);
  } else {
    const fx = 6 + stride * 10;
    const fy = -2 - Math.max(0, Math.cos(p.walk)) * 5;
    limb(g, X(4), Y(-30), X(fx), Y(fy), 11 * s, pants);
    g.fillStyle(0x111111, 1).fillEllipse(X(fx + 3), Y(fy), 14 * s, 6 * s);
  }

  // Back arm, then torso.
  limb(g, uX(-6), uY(-55), uX(-9 - stride * 7), uY(-36), 8 * s, shade(skin, 0.85));
  box(-11 + lean, -62 + bob, 22, 34, shirt, 6);
  box(-11 + lean, -62 + bob, 6, 34, shade(shirt, 0.78), 6);
  box(5 + lean, -60 + bob, 3, 28, shade(shirt, 1.18), 1);
  box(-11 + lean, -33 + bob, 22, 5, 0x1a1a1a);
  box(-2 + lean, -33 + bob, 5, 5, 0xd4af37);
  box(-3 + lean, -66 + bob, 7, 6, skin);
  if (p.chain) {
    g.lineStyle(2, 0xffd166, 1).lineBetween(uX(-5), uY(-60), uX(1), uY(-50)).lineBetween(uX(1), uY(-50), uX(7), uY(-60));
    g.fillStyle(0xffd166, 1).fillCircle(uX(1), uY(-49), 3 * s);
  }

  // Front arm and fist.
  const hx = p.punch > 0 ? 20 + 38 * p.punch : 20;
  const hy = p.punch > 0 ? -54 : -49 + Math.sin(p.t * 4);
  limb(g, uX(7), uY(-55), uX(hx), uY(hy), 8 * s, skin);
  g.fillStyle(shade(skin, 0.9), 1).fillCircle(uX(hx + 2), uY(hy), 5.5 * s);
  g.fillStyle(shirt, 1).fillCircle(uX(1), uY(-56), 7 * s);

  // Head.
  g.fillStyle(skin, 1).fillCircle(uX(2), uY(-71), 9 * s);
  g.fillStyle(shade(skin, 0.8), 1).fillCircle(uX(-4), uY(-70), 3 * s);
  g.fillStyle(0x140c0c, 1).fillCircle(uX(7), uY(-72), 1.7 * s);
  g.lineStyle(1.5 * s, 0x140c0c, 1).lineBetween(uX(4), uY(-76), uX(10), uY(-74));
  if (p.shades) box(3 + lean, -75 + bob, 10, 4, 0x000000, 1);
  box(-8 + lean, -83 + bob, 20, 8, cap, 4);
  box(8 + lean, -77 + bob, 10, 3, shade(cap, 0.8), 1);

  if (p.hold === 'bottle') {
    box(-3 + lean, -108 + bob, 7, 16, 0x2e7d32, 2);
    box(-1 + lean, -114 + bob, 3, 7, 0x2e7d32, 1);
  } else if (p.hold === 'chair') {
    box(-10 + lean, -110 + bob, 4, 18, 0xf2f2f2, 1);
    box(-10 + lean, -96 + bob, 20, 4, 0xf2f2f2, 1);
    box(-8 + lean, -92 + bob, 2, 8, 0xdcdcdc, 0);
    box(6 + lean, -92 + bob, 2, 8, 0xdcdcdc, 0);
  }
}

function drawWheel(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  g.fillStyle(0x0a0a10, 1).fillCircle(x, y, r + 3);
  g.fillStyle(0x1b1b24, 1).fillCircle(x, y, r);
  g.fillStyle(0x9a9ab8, 1).fillCircle(x, y, r * 0.45);
  g.fillStyle(0x30303c, 1).fillCircle(x, y, r * 0.18);
}

function drawDanfo(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x000000, 0.35).fillEllipse(x, y, 170, 13);
  g.fillStyle(0xd4a90a, 1).fillRoundedRect(x - 78, y - 56, 156, 46, 6);
  g.fillStyle(0xf6c90e, 1).fillRoundedRect(x - 78, y - 62, 156, 40, 7);
  g.fillStyle(0xffe27a, 1).fillRect(x - 74, y - 61, 148, 3);
  g.fillStyle(0x111111, 1).fillRect(x - 78, y - 36, 156, 7);
  g.fillStyle(0x6fb1d6, 1);
  for (let i = 0; i < 5; i++) g.fillRect(x - 70 + i * 28, y - 56, 22, 16);
  g.fillStyle(0xffffff, 0.35);
  for (let i = 0; i < 5; i++) g.fillTriangle(x - 70 + i * 28, y - 56, x - 62 + i * 28, y - 56, x - 70 + i * 28, y - 44);
  g.lineStyle(1, 0x8a6a00, 1);
  for (const dx of [-30, 26]) g.lineBetween(x + dx, y - 40, x + dx, y - 14);
  g.lineStyle(2, 0x333333, 1).lineBetween(x - 64, y - 66, x + 64, y - 66);
  for (const dx of [-60, 0, 60]) g.lineBetween(x + dx, y - 66, x + dx, y - 62);
  g.fillStyle(0x111111, 1).fillRect(x + 36, y - 74, 30, 7);
  g.fillStyle(0xffe45e, 1).fillRect(x + 40, y - 72, 4, 3).fillRect(x + 48, y - 72, 4, 3).fillRect(x + 56, y - 72, 4, 3);
  g.fillStyle(0xffe9a0, 1).fillRoundedRect(x + 72, y - 34, 8, 9, 2);
  g.fillStyle(0xff3b30, 1).fillRect(x - 81, y - 34, 4, 9);
  g.fillStyle(0x222222, 1).fillRect(x - 80, y - 16, 160, 5);
  for (const wx of [-48, 48]) drawWheel(g, x + wx, y - 10, 13);
}

function drawKorope(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x000000, 0.35).fillEllipse(x, y, 150, 12);
  g.fillStyle(0xbac4d0, 1).fillRoundedRect(x - 66, y - 62, 132, 50, 8);
  g.fillStyle(0xe8eef5, 1).fillRoundedRect(x - 66, y - 74, 132, 54, 9);
  g.fillStyle(0xffffff, 0.7).fillRect(x - 60, y - 73, 120, 3);
  g.fillStyle(0xd62828, 1).fillRect(x - 66, y - 36, 132, 7);
  g.fillStyle(0x4a90c2, 1);
  for (let i = 0; i < 4; i++) g.fillRect(x - 58 + i * 28, y - 68, 22, 18);
  g.fillStyle(0xffffff, 0.35);
  for (let i = 0; i < 4; i++) g.fillTriangle(x - 58 + i * 28, y - 68, x - 50 + i * 28, y - 68, x - 58 + i * 28, y - 56);
  g.lineStyle(1, 0x8a96a6, 1);
  for (const dx of [-24, 24]) g.lineBetween(x + dx, y - 50, x + dx, y - 14);
  g.fillStyle(0xffe9a0, 1).fillRoundedRect(x + 62, y - 34, 7, 9, 2);
  g.fillStyle(0x222222, 1).fillRect(x - 66, y - 16, 132, 5);
  for (const wx of [-40, 40]) drawWheel(g, x + wx, y - 10, 13);
}

function drawKeke(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x000000, 0.35).fillEllipse(x, y, 96, 10);
  g.fillStyle(0x146b3a, 1).fillRoundedRect(x - 38, y - 40, 76, 30, 8);
  g.fillStyle(0x1f8a4c, 1).fillRoundedRect(x - 38, y - 44, 76, 28, 8);
  g.fillStyle(0xf6c90e, 1).fillRoundedRect(x - 34, y - 64, 68, 24, 8);
  g.fillStyle(0xffe27a, 1).fillRect(x - 28, y - 63, 56, 3);
  g.fillStyle(0x111111, 1).fillRect(x - 30, y - 42, 60, 4);
  g.fillStyle(0x6fb1d6, 1).fillRect(x + 12, y - 58, 18, 13);
  g.fillStyle(0x1b1b24, 1).fillRect(x - 26, y - 58, 34, 14);
  g.fillStyle(0xffe9a0, 1).fillCircle(x + 38, y - 30, 4);
  for (const wx of [-26, 30]) drawWheel(g, x + wx, y - 8, 10);
}

function drawPalm(g: Phaser.GameObjects.Graphics, x: number, baseY: number, h: number, lean: number): void {
  g.lineStyle(7, 0x4a3524, 1);
  let px = x;
  let py = baseY;
  for (let i = 1; i <= 8; i++) {
    const nx = x + lean * (i / 8) * (i / 8) * 40;
    const ny = baseY - (h * i) / 8;
    g.lineBetween(px, py, nx, ny);
    px = nx;
    py = ny;
  }
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.95 + (i * Math.PI * 0.9) / 6;
    const len = 46 + (i % 2) * 10;
    const tx = px + Math.cos(a) * len;
    const ty = py + Math.sin(a) * len * 0.55 + 14;
    g.fillStyle(i % 2 === 0 ? 0x1f5f3a : 0x2a7a4a, 1).fillTriangle(px, py, tx, ty, px + Math.cos(a) * len * 0.5, py + Math.sin(a) * len * 0.5 + 16);
  }
}

/** Paints the whole motor park backdrop once: dusk sky, skyline, wall, parked vehicles and the dusty floor. */
function drawGarage(scene: Phaser.Scene): void {
  const g = scene.add.graphics().setDepth(0);
  const r = rng(2026);

  // Dusk sky.
  for (let i = 0; i < 30; i++) {
    g.fillStyle(mix(0x1a1038, 0xff8c5a, Math.pow(i / 29, 1.7)), 1).fillRect(0, i * 10, WIDTH, 11);
  }
  // Sun and haze.
  for (const [rad, a] of [[96, 0.08], [72, 0.12], [54, 0.2]] as const) g.fillStyle(0xffc27a, a).fillCircle(610, 268, rad);
  g.fillStyle(0xffe0a0, 1).fillCircle(610, 268, 40);
  // Clouds.
  g.fillStyle(0xffb38a, 0.3);
  for (const [cx, cy, cw] of [[120, 92, 190], [380, 140, 240], [660, 80, 170], [560, 180, 200], [60, 190, 150]] as const) {
    g.fillEllipse(cx, cy, cw, 16).fillEllipse(cx + 28, cy - 8, cw * 0.6, 14);
  }

  // Skyline: far and near buildings with lit windows.
  const skyline = (color: number, minH: number, maxH: number, lit: number): void => {
    let bx = -10;
    while (bx < WIDTH) {
      const bw = 34 + Math.floor(r() * 44);
      const bh = minH + Math.floor(r() * (maxH - minH));
      g.fillStyle(color, 1).fillRect(bx, 300 - bh, bw, bh + 2);
      for (let wy = 300 - bh + 8; wy < 292; wy += 11) {
        for (let wx = bx + 5; wx < bx + bw - 6; wx += 9) {
          if (r() < lit) g.fillStyle(0xffd98a, 0.85).fillRect(wx, wy, 4, 5);
        }
      }
      bx += bw + Math.floor(r() * 6);
    }
  };
  skyline(0x35264f, 50, 150, 0.12);
  skyline(0x241a3d, 28, 100, 0.2);
  // A radio tower with a red beacon.
  g.lineStyle(3, 0x1a1230, 1).lineBetween(120, 300, 120, 120);
  g.lineStyle(2, 0x1a1230, 1).lineBetween(112, 300, 120, 160).lineBetween(128, 300, 120, 160);
  g.fillStyle(0xff3b30, 1).fillCircle(120, 118, 4);

  // Palms behind the wall.
  drawPalm(g, 22, 302, 120, 1);
  drawPalm(g, 782, 302, 134, -1);

  // Perimeter wall of corrugated zinc, with election posters.
  g.fillStyle(0x3b3249, 1).fillRect(0, 300, WIDTH, 66);
  g.fillStyle(0x4a415a, 1).fillRect(0, 300, WIDTH, 5);
  g.lineStyle(2, 0x2f283c, 1);
  for (let x = 0; x < WIDTH; x += 9) g.lineBetween(x, 305, x, 366);
  g.fillStyle(0x000000, 0.25).fillRect(0, 300, WIDTH, 66);
  for (const [px, col] of [[44, 0x2e9e57], [214, 0xe74c3c], [356, 0xf1c40f], [520, 0x2980b9], [690, 0x2e9e57]] as const) {
    g.fillStyle(0xf4f1de, 0.85).fillRect(px, 318, 22, 28);
    g.fillStyle(col, 0.9).fillRect(px + 3, 321, 16, 11);
  }

  // Parked vehicles along the back.
  drawDanfo(g, 100, 352);
  drawKorope(g, 268, 358);
  drawKeke(g, 420, 358);
  drawDanfo(g, 580, 352);
  drawKorope(g, 724, 358);
  g.fillStyle(0x1b1030, 0.22).fillRect(0, 270, WIDTH, 100);

  // Floor: dusty ground that darkens toward the camera.
  for (let i = 0; i < 24; i++) {
    g.fillStyle(mix(0x6a5238, 0x33271c, i / 23), 1).fillRect(0, 365 + i * 10, WIDTH, 11);
  }
  g.fillStyle(0x2c231a, 0.7).fillRect(0, 365, WIDTH, 5);
  g.lineStyle(3, 0xf2e6c8, 0.1);
  for (let i = -7; i <= 7; i++) g.lineBetween(400 + i * 46, 372, 400 + i * 150, 600);
  g.lineStyle(2, 0xf2e6c8, 0.08);
  for (const ly of [436, 500, 566]) g.lineBetween(0, ly, WIDTH, ly);
  for (let i = 0; i < 220; i++) {
    g.fillStyle(r() < 0.5 ? 0x24190f : 0x8a7352, 0.35).fillRect(r() * WIDTH, 372 + r() * 228, 2, 2);
  }
  g.fillStyle(0x1e160e, 0.5);
  for (const [sx, sy, sw] of [[90, 470, 80], [330, 522, 100], [620, 452, 70], [700, 540, 90], [200, 556, 56]] as const) {
    g.fillEllipse(sx, sy, sw, sw / 4);
  }
  // Puddles catching the sunset.
  for (const [sx, sy, sw] of [[470, 480, 96], [150, 530, 70]] as const) {
    g.fillStyle(0x6e8bbd, 0.3).fillEllipse(sx, sy, sw, sw / 4);
    g.fillStyle(0xffc27a, 0.35).fillEllipse(sx + sw * 0.1, sy - 1, sw * 0.5, sw / 9);
  }
  // Litter.
  for (const [lx, ly, lc] of [[260, 548, 0xe8e8e8], [530, 508, 0x5ec8ff], [720, 470, 0xf1c40f], [60, 500, 0xe8e8e8]] as const) {
    g.fillStyle(lc, 0.8).fillRect(lx, ly, 7, 3);
  }

  // Wires, poles and the string of bulbs.
  for (const px of [22, 782]) {
    g.lineStyle(6, 0x2a2018, 1).lineBetween(px, 366, px, 188);
    g.lineStyle(5, 0x2a2018, 1).lineBetween(px - 20, 196, px + 20, 196);
  }
  g.lineStyle(2, 0x15101e, 1);
  let wx0 = 30;
  for (let x = 40; x <= 770; x += 10) {
    g.lineBetween(wx0, wireY(wx0), x, wireY(x));
    wx0 = x;
  }
  for (const [bx, by] of BULBS) {
    g.lineStyle(1, 0x15101e, 1).lineBetween(bx, by - 5, bx, by);
    g.fillStyle(0xffe9a0, 1).fillCircle(bx, by + 3, 4);
  }

  // The gate sign.
  g.fillStyle(0x15101e, 1).fillRect(220, 232, 6, 70).fillRect(574, 232, 6, 70);
  g.fillStyle(0x15101e, 1).fillRoundedRect(236, 252, 328, 36, 6);
  g.lineStyle(2, 0xffe45e, 0.9).strokeRoundedRect(236, 252, 328, 36, 6);
  neonText(scene, WIDTH / 2, 270, 'LAGOS MOTOR PARK', 14, NEON.yellow).setDepth(1);
}

function stallOffset(s: Stall, t: number): number {
  return s.shake > 0 ? Math.sin(t * 90) * 3 * (s.shake / 0.25) : 0;
}

/** Draws one market stall. s.hp decides how battered it looks, from fresh to a heap of rubble. */
function drawStall(g: Phaser.GameObjects.Graphics, s: Stall, t: number): void {
  const d = 1 - s.hp / s.maxHp;
  const alive = s.hp > 0;
  const x = s.x + stallOffset(s, t);
  const y = STALL_Y;
  const vis = Math.max(0, Math.ceil(8 * (1 - d)));

  g.fillStyle(0x000000, 0.36).fillEllipse(x, y + 2, s.w + 30, 14);

  // Back wall and the trader behind the counter.
  const wallH = alive ? 62 : 28;
  g.fillStyle(0x2b2236, 1).fillRect(x - 54, y - 18 - wallH, 108, wallH);
  g.lineStyle(1, 0x1c1526, 1);
  for (let i = 1; i < 6; i++) g.lineBetween(x - 54 + i * 18, y - 18 - wallH, x - 54 + i * 18, y - 18);
  if (alive && d < 0.7) {
    const hx = x + (s.x % 3 === 0 ? 34 : -34);
    const by = Math.sin(t * 3 + s.x) * 1.5;
    g.fillStyle(shade(s.awnA, 0.8), 1).fillRoundedRect(hx - 9, y - 54 + by, 18, 22, 4);
    g.fillStyle(0x7a4a26, 1).fillCircle(hx, y - 60 + by, 7);
    g.fillStyle(0xf4f1de, 1).fillRect(hx - 7, y - 68 + by, 14, 3);
  }

  // Goods.
  if (alive) {
    if (s.kind === 'beer') {
      g.fillStyle(0x6b4a2a, 1).fillRect(x - 54, y - 44, 108, 9);
      for (let i = 0; i < 8; i++) {
        if (i >= vis) break;
        const bx = x - 50 + i * 13;
        g.fillStyle(i % 2 === 0 ? 0x2e7d32 : 0x8d5a2b, 1).fillRoundedRect(bx, y - 62, 7, 18, 2);
        g.fillRect(bx + 2, y - 69, 3, 8);
        g.fillStyle(0xffd166, 1).fillRect(bx + 1, y - 70, 5, 2);
        g.fillStyle(0xf4f1de, 0.85).fillRect(bx + 1, y - 54, 5, 5);
      }
    } else if (s.kind === 'food') {
      if (vis >= 3) {
        g.fillStyle(0xb0b7c3, 1).fillRoundedRect(x - 46, y - 58, 38, 24, 7);
        g.fillStyle(0xe8ecf2, 1).fillRect(x - 44, y - 58, 34, 4);
        g.fillStyle(0xe67e22, 1).fillEllipse(x - 27, y - 59, 30, 5);
      }
      if (vis >= 6) {
        g.fillStyle(0xc0392b, 1).fillRoundedRect(x + 6, y - 56, 38, 22, 7);
        g.fillStyle(0xf1c40f, 1).fillEllipse(x + 25, y - 57, 30, 5);
      }
      for (let i = 0; i < 3; i++) {
        const ph = t * 1.4 + i * 1.7;
        g.fillStyle(0xffffff, 0.16 * (1 - (ph % 1))).fillCircle(x - 27 + Math.sin(ph * 4) * 5, y - 66 - (ph % 1) * 24, 6 + (ph % 1) * 4);
      }
    } else if (s.kind === 'water') {
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 4; i++) {
          if (row * 4 + i >= vis) continue;
          const bx = x - 50 + i * 25;
          g.fillStyle(0xcfeaff, 1).fillRoundedRect(bx, y - 52 - row * 12, 23, 11, 4);
          g.fillStyle(0x5ec8ff, 1).fillRect(bx + 3, y - 49 - row * 12, 17, 3);
        }
      }
    } else if (s.kind === 'suya') {
      g.fillStyle(0x1c1c22, 1).fillRect(x - 48, y - 44, 96, 11);
      g.fillStyle(0xff7a3d, 1).fillRect(x - 44, y - 44, 88, 3);
      for (let i = 0; i < 8; i++) {
        if (i >= vis) break;
        const bx = x - 42 + i * 11;
        g.lineStyle(1, 0xd8c9a0, 1).lineBetween(bx, y - 58, bx + 2, y - 44);
        g.fillStyle(0x8a4b2a, 1).fillRoundedRect(bx - 2, y - 54, 6, 10, 2);
      }
      for (let i = 0; i < 4; i++) {
        const ph = t * 0.9 + i * 0.55;
        g.fillStyle(0xb8b8c8, 0.22 * (1 - (ph % 1))).fillCircle(x - 20 + i * 14 + Math.sin(ph * 5) * 5, y - 70 - (ph % 1) * 34, 5 + (ph % 1) * 6);
      }
    } else {
      g.fillStyle(0x8e1b55, 1).fillRoundedRect(x - 48, y - 62, 34, 28, 7);
      g.fillStyle(0xd96ab0, 1).fillRect(x - 46, y - 62, 30, 4);
      g.fillStyle(0x6a1b9a, 1).fillRoundedRect(x - 8, y - 62, 34, 28, 7);
      g.fillStyle(0xb07ad8, 1).fillRect(x - 6, y - 62, 30, 4);
      for (let i = 0; i < 6; i++) {
        if (i >= vis) break;
        g.fillStyle(0xf4f1de, 1).fillRect(x + 30 + i * 3, y - 46, 3, 9);
      }
    }
  }

  // Counter, tilting as the stall is battered.
  const tilt = d * d * 12;
  g.fillStyle(0x8a5a2e, 1);
  g.fillTriangle(x - 58, y - 32, x + 58, y - 32 + tilt, x + 58, y - 6);
  g.fillTriangle(x - 58, y - 32, x + 58, y - 6, x - 58, y - 6);
  g.fillStyle(shade(s.awnA, 0.9), 1).fillRect(x - 54, y - 26 + tilt * 0.3, 108, 14);
  g.lineStyle(5, 0xb07a44, 1).lineBetween(x - 58, y - 34, x + 58, y - 34 + tilt);
  g.fillStyle(0x3a2616, 1).fillRect(x - 56, y - 6, 6, 8).fillRect(x + 50, y - 6, 6, 8);
  g.lineStyle(2, 0x1c1010, 0.9);
  for (let i = 0; i < Math.floor(d * 6); i++) {
    const cx = x - 46 + i * 18;
    g.lineBetween(cx, y - 30, cx + 6, y - 22).lineBetween(cx + 6, y - 22, cx + 1, y - 14);
  }

  // Awning: sags and tears with damage, or collapses over the counter once wrecked.
  if (alive) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      if (d > 0.25 && ((i * 5 + Math.floor(s.x)) % 7) / 7 < d * 0.7) continue;
      const sag = d * d * 22 * (0.4 + (0.6 * ((i * 3) % n)) / n);
      const sx = x - 63 + i * 18;
      const col = i % 2 === 0 ? s.awnA : s.awnB;
      g.fillStyle(col, 1).fillRect(sx, y - 88 + sag, 18, 17);
      g.fillCircle(sx + 9, y - 71 + sag, 9);
    }
    g.fillStyle(0x000000, 0.18).fillRect(x - 63, y - 71, 126, 3);
  } else {
    g.fillStyle(s.awnA, 1).fillTriangle(x - 62, y - 8, x + 4, y - 44, x + 60, y - 8);
    g.fillStyle(s.awnB, 1).fillTriangle(x - 30, y - 8, x + 4, y - 44, x + 20, y - 8);
    g.fillStyle(0x3a2616, 1).fillRect(x - 70, y - 12, 26, 5).fillRect(x + 36, y - 14, 30, 5);
    g.fillStyle(s.accent, 0.9).fillRect(x - 22, y - 8, 8, 5).fillRect(x + 22, y - 10, 6, 6);
    for (let i = 0; i < 3; i++) {
      const ph = t * 0.7 + i * 0.4;
      g.fillStyle(0x9a9aa8, 0.25 * (1 - (ph % 1))).fillCircle(x - 18 + i * 18, y - 40 - (ph % 1) * 40, 7 + (ph % 1) * 8);
    }
  }

  // Sign board with a health bar once it takes damage.
  g.fillStyle(0x15101e, 1).fillRoundedRect(x - 48, y - 108 + (alive ? d * d * 18 : 24), 96, 17, 4);
  g.lineStyle(2, s.accent, alive ? 0.9 : 0.35).strokeRoundedRect(x - 48, y - 108 + (alive ? d * d * 18 : 24), 96, 17, 4);
  if (alive && d > 0) {
    g.fillStyle(0x000000, 0.6).fillRect(x - 30, y - 116, 60, 5);
    g.fillStyle(d > 0.6 ? NEON.pink : NEON.yellow, 1).fillRect(x - 30, y - 116, 60 * (1 - d), 5);
  }
}

function drawProp(g: Phaser.GameObjects.Graphics, p: Prop): void {
  g.fillStyle(0x000000, 0.3).fillEllipse(p.x, p.y, 28, 7);
  if (p.kind === 'chair') {
    g.fillStyle(0xf2f2f2, 1).fillRoundedRect(p.x - 11, p.y - 34, 5, 22, 2);
    g.fillRoundedRect(p.x - 11, p.y - 18, 22, 5, 2);
    g.fillStyle(0xcfcfcf, 1).fillRect(p.x - 9, p.y - 13, 3, 12).fillRect(p.x + 6, p.y - 13, 3, 12);
  } else {
    g.fillStyle(0x2e7d32, 1).fillRoundedRect(p.x - 4, p.y - 18, 8, 16, 3);
    g.fillRect(p.x - 2, p.y - 25, 4, 8);
    g.fillStyle(0xffd166, 1).fillRect(p.x - 3, p.y - 26, 6, 2);
  }
}

/* -------------------------------------------------------------------- scenes */

function addStallLabels(scene: Phaser.Scene, stalls: Stall[]): void {
  for (const s of stalls) {
    s.label = scene.add
      .text(s.x, STALL_Y - 99, s.name, { fontFamily: PIXEL_FONT, fontSize: '8px', color: `#${s.accent.toString(16).padStart(6, '0')}` })
      .setOrigin(0.5)
      .setDepth(4);
  }
}

class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    drawGarage(this);
    const stalls = makeStalls();
    const sg = this.add.graphics().setDepth(1);
    for (const s of stalls) drawStall(sg, s, 0);
    addStallLabels(this, stalls);
    for (const s of stalls) s.label?.setDepth(1);
    this.add.rectangle(0, 0, WIDTH, HEIGHT, NEON.bg, 0.62).setOrigin(0).setDepth(2);
    buildMenu(this, {
      gameId: GAME_ID,
      title: ['AGBERO', 'RUMBLE'],
      colors: [NEON.yellow, NEON.green],
      help: 'Move: arrows / WASD / stick    Punch: Space    Kick: Shift or X    Oya Shout: C\nFight away from the stalls or the park shuts down!  Punch near a chair or bottle to grab it, punch to throw.    Pause: P / Start',
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
  private held: PropKind | null = null;
  private peace = 100;
  private peaceStage = 0;
  private lastStallHit = -99;
  private loss = 0;
  private income = 0;
  private freeze = 0;
  private waveCleared = false;
  private walkerT = 0;
  private dustT = 0;

  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];
  private props: Prop[] = [];
  private shots: Shot[] = [];
  private walkers: Walker[] = [];
  private dust: Dust[] = [];
  private stalls: Stall[] = [];

  private stallGfx!: Phaser.GameObjects.Graphics;
  private gfx!: Phaser.GameObjects.Graphics;
  private glow!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private dim!: Phaser.GameObjects.Rectangle;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private lossText!: Phaser.GameObjects.Text;
  private heldText!: Phaser.GameObjects.Text;
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
    this.held = null;
    this.peace = 100;
    this.peaceStage = 0;
    this.lastStallHit = -99;
    this.loss = 0;
    this.income = 0;
    this.freeze = 0;
    this.waveCleared = false;
    this.walkerT = 4;
    this.dustT = 0;
    this.enemies = [];
    this.pickups = [];
    this.shots = [];
    this.dust = [];
    this.walkers = [];
    this.stalls = makeStalls();
    this.props = [
      { kind: 'chair', x: 330, y: 500 },
      { kind: 'chair', x: 590, y: 520 },
    ];
  }

  create(): void {
    this.cameras.main.fadeIn(250, 5, 5, 13);
    drawGarage(this);
    this.stallGfx = this.add.graphics().setDepth(3);
    addStallLabels(this, this.stalls);
    this.gfx = this.add.graphics().setDepth(5);
    this.glow = this.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    this.burst = burstEmitter(this, 280, 500);

    // Soft dark edges, and a night-time overlay that deepens as the park falls apart.
    const vg = this.add.graphics().setDepth(10);
    for (let i = 0; i < 7; i++) {
      vg.lineStyle(16, 0x05030a, 0.09).strokeRect(i * 9 - 8, i * 9 - 8, WIDTH - i * 18 + 16, HEIGHT - i * 18 + 16);
    }
    this.dim = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x05030f, 0).setOrigin(0).setDepth(11);

    this.hud = this.add.graphics().setDepth(20);
    const label = { fontFamily: PIXEL_FONT, fontSize: '11px', color: '#e8e8ff' };
    this.scoreText = this.add.text(WIDTH - 20, 16, '', { ...label, fontSize: '16px' }).setOrigin(1, 0).setDepth(21);
    this.waveText = this.add.text(WIDTH / 2, 46, '', { ...label, color: '#ffe45e' }).setOrigin(0.5, 0).setDepth(21);
    this.comboText = this.add.text(WIDTH - 20, 42, '', { ...label, color: '#3dff8a' }).setOrigin(1, 0).setDepth(21);
    this.lossText = this.add.text(WIDTH - 20, 80, '', { ...label, fontSize: '9px', color: '#ff2e97' }).setOrigin(1, 0).setDepth(21);
    this.heldText = this.add.text(20, 578, '', { ...label, fontSize: '9px', color: '#ffffff' }).setDepth(21);
    this.add.text(20, 62, 'OYA SHOUT', { ...label, fontSize: '9px', color: '#8a8ab8' }).setDepth(21);
    this.add.text(WIDTH / 2, 32, 'PARK PEACE', { ...label, fontSize: '8px', color: '#8a8ab8' }).setOrigin(0.5, 0).setDepth(21);
    this.add.text(WIDTH - 20, 64, `BEST ${getHighScore(GAME_ID).toLocaleString()}`, { ...label, fontSize: '9px', color: '#8a8ab8' }).setOrigin(1, 0).setDepth(21);
    const tip = this.add
      .text(WIDTH / 2, 586, 'Fight AWAY from the stalls or the park shuts down!', { ...label, fontSize: '9px', color: '#ffe45e' })
      .setOrigin(0.5)
      .setDepth(21);
    this.tweens.add({ targets: tip, alpha: 0, delay: 6000, duration: 900 });

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

    for (let i = 0; i < 3; i++) this.spawnWalker('customer', false);
    for (let i = 0; i < 2; i++) this.spawnWalker('hawker', false);
  }

  update(_time: number, deltaMs: number): void {
    if (this.pause.isPaused || this.over) return;
    let dt = Math.min(deltaMs, 50) / 1000;
    if (this.freeze > 0) {
      this.freeze -= dt;
      dt *= 0.12;
    }
    this.elapsed += dt;
    this.updatePlayer(dt);
    this.updateWaves(dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.separate();
    this.enemies = this.enemies.filter((e) => e.dying < 1);
    this.updateShots(dt);
    this.updateWalkers(dt);
    this.updatePeace(dt);
    this.updatePickups(dt);
    this.updateDust(dt);
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
    const moving = Math.abs(ax) + Math.abs(ay) > 0.2;
    this.walk += (moving ? 14 : 0) * dt;
    if (moving && !attacking) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.13;
        this.spawnDust(this.px - this.facing * 10, this.py - 2, 1);
      }
    }

    if (!attacking) {
      if (this.controls.justPressed('action')) {
        if (this.held) this.throwHeld();
        else {
          const i = this.propNear();
          if (i >= 0) this.grab(i);
          else this.startAttack('punch');
        }
      } else if (this.controls.justPressed('alt')) this.startAttack('kick');
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

  private propNear(): number {
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (Math.abs(p.x - this.px) < 46 && Math.abs(p.y - this.py) < 26) return i;
    }
    return -1;
  }

  private grab(i: number): void {
    const p = this.props[i];
    this.held = p.kind;
    this.props.splice(i, 1);
    floatText(this, this.px, this.py - 100, p.kind === 'chair' ? 'GOT A CHAIR!' : 'GOT A BOTTLE!', NEON.cyan, 10);
    tone({ freq: 500, toFreq: 800, duration: 0.08 });
  }

  private throwHeld(): void {
    if (!this.held) return;
    this.shots.push({ kind: this.held, x: this.px + this.facing * 26, y: this.py, vx: this.facing * 560, life: 1, spin: 0 });
    this.held = null;
    this.startAttack('punch');
    this.atkHit = true;
    tone({ freq: 300, toFreq: 700, duration: 0.12, type: 'sawtooth', volume: 0.05 });
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
      const smashing = e.kind === 'looter' && !e.aggro;
      e.hp -= damage;
      e.stun = kick ? 0.6 : 0.28;
      e.vx = this.facing * (kick ? 340 : 150);
      e.flash = 0.14;
      e.windup = 0;
      e.aggro = true;
      this.combo++;
      this.comboT = COMBO_WINDOW;
      this.score += 10 * this.multiplier();
      this.meter = Math.min(SHOUT_COST, this.meter + (kick ? 9 : 5));
      this.burst.setParticleTint(kick ? NEON.pink : NEON.yellow);
      this.burst.explode(kick ? 14 : 8, e.x, e.y - 50);
      floatText(this, e.x, e.y - 90, POW[Phaser.Math.Between(0, POW.length - 1)], kick ? NEON.pink : NEON.yellow, 12);
      this.spawnDust(e.x, e.y - 2, kick ? 4 : 2);
      if (!smashing) this.collateral(e.x, e.y, kick ? 8 : 5);
      if (e.hp <= 0) this.kill(e);
    }
    for (const w of this.walkers) {
      const dx = (w.x - this.px) * this.facing;
      if (w.flee || dx < -8 || dx > reach || Math.abs(w.y - this.py) > 24) continue;
      this.peace = Math.max(0, this.peace - 6);
      this.score = Math.max(0, this.score - 100);
      floatText(this, w.x, w.y - 90, 'NO HIT CUSTOMER!', NEON.pink, 10);
      this.violence(w.x, 40);
    }
    if (landed) {
      this.violence(this.px, 150);
      noise(kick ? 0.14 : 0.08, kick ? 0.12 : 0.08);
      if (kick && !reducedMotion()) {
        this.cameras.main.shake(90, 0.004);
        this.freeze = 0.05;
      }
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
      e.aggro = true;
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
    this.violence(this.px, 150);
    this.collateral(this.px, this.py, 5);
    if (this.hp <= 0) {
      this.hp = 0;
      this.finish(`WAVE ${this.wave}   ${this.kills} KO`);
    }
  }

  private finish(detail: string): void {
    if (this.over) return;
    this.over = true;
    this.cameras.main.flash(180, 255, 46, 151);
    this.time.delayedCall(800, () => this.scene.start('GameOver', { gameId: GAME_ID, score: this.score, detail }));
  }

  /* ----------------------------------------------------------------- stalls */

  private stallIndexAt(x: number): number {
    for (let i = 0; i < this.stalls.length; i++) {
      const s = this.stalls[i];
      if (s.hp > 0 && Math.abs(s.x - x) < s.w / 2 + 12) return i;
    }
    return -1;
  }

  private nearestStall(x: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.stalls.length; i++) {
      const s = this.stalls[i];
      if (s.hp <= 0) continue;
      const dist = Math.abs(s.x - x);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
    return best;
  }

  /** Fighting close to the stalls breaks them. */
  private collateral(x: number, y: number, amount: number): void {
    if (y > STALL_ZONE) return;
    const i = this.stallIndexAt(x);
    if (i >= 0) this.damageStall(this.stalls[i], amount);
  }

  private damageStall(s: Stall, amount: number): void {
    if (s.hp <= 0) return;
    s.hp = Math.max(0, s.hp - amount);
    s.shake = 0.25;
    this.peace = Math.max(0, this.peace - amount * 0.45);
    this.lastStallHit = this.elapsed;
    this.loss += Math.round(amount * 1200);
    this.violence(s.x, 170);
    noise(0.1, 0.09);
    this.burst.setParticleTint(s.accent);
    this.burst.explode(6, s.x + Phaser.Math.Between(-30, 30), STALL_Y - 40);
    if (s.hp <= 0) this.wreck(s);
    else floatText(this, s.x, STALL_Y - 120, 'CRASH!', NEON.pink, 11);
  }

  private wreck(s: Stall): void {
    this.peace = Math.max(0, this.peace - 8);
    this.loss += 15000;
    floatText(this, s.x, STALL_Y - 120, `${s.name} WRECKED!`, NEON.pink, 11);
    tone({ freq: 200, toFreq: 50, duration: 0.35, type: 'sawtooth', volume: 0.08 });
    if (!reducedMotion()) this.cameras.main.shake(200, 0.008);
    this.burst.setParticleTint(s.accent);
    this.burst.explode(22, s.x, STALL_Y - 40);
    const y = FLOOR_TOP + 12;
    if (s.kind === 'beer') {
      this.props.push({ kind: 'bottle', x: s.x - 22, y });
      this.props.push({ kind: 'bottle', x: s.x + 22, y: y + 6 });
    } else if (s.kind === 'food') this.pickups.push({ kind: 'amala', x: s.x, y, age: -4 });
    else if (s.kind === 'water') this.pickups.push({ kind: 'sachet', x: s.x, y, age: -4 });
    else if (s.kind === 'suya') this.pickups.push({ kind: 'suya', x: s.x, y, age: -4 });
    else this.pickups.push({ kind: 'zobo', x: s.x, y, age: -4 });
  }

  /** After each wave one battered stall gets patched up and the park calms down. */
  private repairStalls(): void {
    let worst: Stall | null = null;
    for (const s of this.stalls) {
      if (s.hp >= s.maxHp) continue;
      if (!worst || s.hp / s.maxHp < worst.hp / worst.maxHp) worst = s;
    }
    this.score += 100 * this.wave;
    if (!worst) return;
    const wasWrecked = worst.hp <= 0;
    worst.hp = Math.min(worst.maxHp, worst.hp + (wasWrecked ? 36 : 30));
    this.peace = Math.min(100, this.peace + 15);
    floatText(this, worst.x, STALL_Y - 120, wasWrecked ? `${worst.name} REOPENS!` : `${worst.name} FIXED`, NEON.green, 10);
    tone({ freq: 440, toFreq: 660, duration: 0.18 });
  }

  /** Customers and hawkers close to a fight run away. */
  private violence(x: number, radius: number): void {
    for (const w of this.walkers) {
      if (w.flee || Math.abs(w.x - x) > radius) continue;
      w.flee = true;
      w.vx = (w.x >= x ? 1 : -1) * (130 + Math.random() * 60);
      w.face = w.vx > 0 ? 1 : -1;
    }
  }

  private updatePeace(dt: number): void {
    for (const s of this.stalls) if (s.shake > 0) s.shake -= dt;
    if (this.elapsed - this.lastStallHit > 3.5) this.peace = Math.min(100, this.peace + 1.5 * dt);
    const customers = this.walkers.filter((w) => !w.flee).length;
    this.income += customers * 0.6 * dt;
    if (this.income >= 1) {
      this.score += Math.floor(this.income);
      this.income -= Math.floor(this.income);
    }
    const stage = this.peace < 30 ? 2 : this.peace < 60 ? 1 : 0;
    if (stage > this.peaceStage) {
      showBanner(this, stage === 2 ? 'TRADERS PACKING UP!' : 'HAWKERS RUNNING!', stage === 2 ? NEON.pink : NEON.yellow, 200);
      tone({ freq: 160, toFreq: 90, duration: 0.3, type: 'sawtooth', volume: 0.07 });
    }
    this.peaceStage = stage;
    if (this.peace <= 0) {
      this.finish(`PARK SHUT   WAVE ${this.wave}`);
      showBanner(this, 'PARK SHUT DOWN!', NEON.pink, 230);
    }
  }

  /* ----------------------------------------------------------------- shots */

  private updateShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.x += s.vx * dt;
      s.life -= dt;
      s.spin += 18 * dt;
      if (s.life <= 0 || s.x < -20 || s.x > WIDTH + 20) {
        this.shots.splice(i, 1);
        continue;
      }
      for (const e of this.enemies) {
        if (e.dying > 0) continue;
        if (Math.abs(e.x - s.x) > 22 + 8 * e.stats.scale || Math.abs(e.y - s.y) > 24) continue;
        const dmg = s.kind === 'chair' ? 30 : 22;
        const smashing = e.kind === 'looter' && !e.aggro;
        e.hp -= dmg;
        e.stun = 0.55;
        e.vx = Math.sign(s.vx) * 260;
        e.flash = 0.16;
        e.windup = 0;
        e.aggro = true;
        this.combo++;
        this.comboT = COMBO_WINDOW;
        this.score += 15 * this.multiplier();
        this.meter = Math.min(SHOUT_COST, this.meter + 6);
        this.burst.setParticleTint(s.kind === 'chair' ? 0xffffff : 0x3dff8a);
        this.burst.explode(12, e.x, e.y - 50);
        floatText(this, e.x, e.y - 90, s.kind === 'chair' ? 'CHAIR!' : 'SMASH!', NEON.cyan, 12);
        noise(0.12, 0.1);
        if (!smashing) this.collateral(e.x, e.y, 6);
        this.violence(e.x, 150);
        if (e.hp <= 0) this.kill(e);
        this.shots.splice(i, 1);
        break;
      }
    }
  }

  /* --------------------------------------------------------------- walkers */

  private pickHome(kind: 'customer' | 'hawker'): number {
    if (kind === 'customer') {
      const alive = this.stalls.filter((s) => s.hp > 0);
      if (alive.length > 0) return alive[Phaser.Math.Between(0, alive.length - 1)].x + Phaser.Math.Between(-40, 40);
    }
    return Phaser.Math.Between(40, WIDTH - 40);
  }

  private spawnWalker(kind: 'customer' | 'hawker', fromEdge: boolean): void {
    const shirts = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xecf0f1, 0xe67e22];
    const skins = [0x6b3f1d, 0x8d5524, 0x4a2c12, 0xa0693a];
    const x = fromEdge ? (Math.random() < 0.5 ? -30 : WIDTH + 30) : Phaser.Math.Between(60, WIDTH - 60);
    this.walkers.push({
      kind,
      x,
      y: kind === 'customer' ? STALL_Y + 14 + Phaser.Math.Between(0, 10) : FLOOR_TOP + 8 + Phaser.Math.Between(0, 36),
      homeX: this.pickHome(kind),
      vx: 0,
      face: 1,
      walk: Math.random() * 6,
      wait: Math.random() * 2,
      flee: false,
      shirt: shirts[Phaser.Math.Between(0, shirts.length - 1)],
      pants: kind === 'hawker' ? 0x2c3e50 : 0x34495e,
      skin: skins[Phaser.Math.Between(0, skins.length - 1)],
      cap: kind === 'hawker' ? 0xf4f1de : 0x2c2c34,
      scale: kind === 'hawker' ? 0.85 : 0.82,
    });
  }

  private updateWalkers(dt: number): void {
    this.walkerT -= dt;
    if (this.walkerT <= 0) {
      this.walkerT = 4;
      if (this.peace > 55 && this.walkers.length < 6) this.spawnWalker(Math.random() < 0.5 ? 'customer' : 'hawker', true);
    }
    if (this.peace < 60 && Math.random() < dt * 0.8) {
      const calm = this.walkers.filter((w) => !w.flee);
      if (calm.length > 0) this.violence(calm[0].x, 5);
    }
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (w.flee) {
        w.x += w.vx * dt;
        w.walk += 16 * dt;
        if (w.x < -60 || w.x > WIDTH + 60) this.walkers.splice(i, 1);
        continue;
      }
      if (w.wait > 0) {
        w.wait -= dt;
        continue;
      }
      const dx = w.homeX - w.x;
      if (Math.abs(dx) < 4) {
        w.wait = 1.5 + Math.random() * 3;
        w.homeX = this.pickHome(w.kind);
      } else {
        w.x += Math.sign(dx) * (w.kind === 'hawker' ? 42 : 28) * dt;
        w.walk += 8 * dt;
        w.face = dx > 0 ? 1 : -1;
      }
    }
  }

  /* ---------------------------------------------------------------- dust */

  private spawnDust(x: number, y: number, n: number): void {
    if (reducedMotion()) return;
    for (let i = 0; i < n && this.dust.length < 70; i++) {
      this.dust.push({ x, y, vx: (Math.random() - 0.5) * 50, vy: -10 - Math.random() * 22, life: 0.5, max: 0.5, r: 4 + Math.random() * 4 });
    }
  }

  private updateDust(dt: number): void {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.dust.splice(i, 1);
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.r += 8 * dt;
    }
  }

  /* ----------------------------------------------------------------- waves */

  private updateWaves(dt: number): void {
    if (this.queue.length === 0 && this.enemies.length === 0) {
      if (this.wave > 0 && !this.waveCleared) {
        this.waveCleared = true;
        this.repairStalls();
      }
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
    this.waveCleared = false;
    const n = this.wave;
    const list: EnemyKind[] = [];
    for (let i = 0; i < 1 + n; i++) list.push('grunt');
    for (let i = 0; i < Math.min(4, 1 + Math.floor((n - 1) / 2)); i++) list.push('looter');
    if (n >= 2) for (let i = 0; i < Math.floor(n / 2) + 1; i++) list.push('speedy');
    if (n >= 3) for (let i = 0; i < Math.floor((n - 1) / 2); i++) list.push('bruiser');
    if (n >= 3) for (let i = 0; i < Math.floor(n / 3); i++) list.push('drunk');
    if (n % 5 === 0) list.push('boss');
    this.queue = Phaser.Utils.Array.Shuffle(list) as EnemyKind[];
    this.spawnT = 0;
    this.nextWaveT = 2;
    if (this.props.length < 3) this.props.push({ kind: 'chair', x: Phaser.Math.Between(120, 680), y: Phaser.Math.Between(450, 550) });
    showBanner(this, n % 5 === 0 ? `WAVE ${n}: OGA BOSS!` : `WAVE ${n}`, n % 5 === 0 ? NEON.pink : NEON.cyan, 230);
    tone({ freq: 392, toFreq: 587, duration: 0.2 });
  }

  private spawn(kind: EnemyKind): void {
    const stats = ENEMIES[kind];
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? -30 : WIDTH + 30;
    const alive = this.stalls.map((s, i) => (s.hp > 0 ? i : -1)).filter((i) => i >= 0);
    const target = alive.length > 0 ? alive[Phaser.Math.Between(0, alive.length - 1)] : -1;
    this.enemies.push({
      x,
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
      aggro: kind !== 'looter' || target < 0,
      target,
      smashT: 0.4,
      smash: 0,
    });
  }

  private kill(e: Enemy): void {
    if (e.dying > 0) return;
    e.dying = 0.001;
    this.kills++;
    this.score += (e.kind === 'boss' ? 500 : 50) * this.multiplier();
    this.meter = Math.min(SHOUT_COST, this.meter + 8);
    if (!reducedMotion()) this.freeze = Math.max(this.freeze, 0.07);
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
    if (e.smash > 0) e.smash -= dt;
    if (e.stun > 0) {
      e.stun -= dt;
      e.x = Phaser.Math.Clamp(e.x + e.vx * dt, -40, WIDTH + 40);
      e.vx *= Math.pow(0.02, dt);
      return;
    }
    if (e.kind === 'looter' && !e.aggro) {
      this.updateLooter(e, dt);
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
    if (e.kind === 'drunk') {
      e.x += Math.sin(this.elapsed * 3 + e.slot) * 34 * dt;
      e.y += Math.cos(this.elapsed * 2.3 + e.slot) * 20 * dt;
    }
    e.y = Phaser.Math.Clamp(e.y, FLOOR_TOP, FLOOR_BOTTOM);
    if (e.cooldown <= 0 && Math.abs(dx) < e.stats.reach && Math.abs(dy) < 20) e.windup = e.stats.wind;
  }

  /** A looter walks to the nearest stall and starts smashing it up until somebody stops him. */
  private updateLooter(e: Enemy, dt: number): void {
    let s: Stall | undefined = this.stalls[e.target];
    if (!s || s.hp <= 0) {
      const t = this.nearestStall(e.x);
      if (t < 0) {
        e.aggro = true;
        return;
      }
      e.target = t;
      s = this.stalls[t];
    }
    const mx = s.x + e.slot * 1.5 - e.x;
    const my = FLOOR_TOP + 6 - e.y;
    if (Math.abs(mx) > 8 || Math.abs(my) > 6) {
      e.facing = mx >= 0 ? 1 : -1;
      e.x += Math.sign(mx) * Math.min(Math.abs(mx), e.stats.speed * dt);
      e.y += Math.sign(my) * Math.min(Math.abs(my), e.stats.speed * 0.8 * dt);
      e.walk += 10 * dt;
      return;
    }
    e.facing = s.x >= e.x ? 1 : -1;
    e.smashT -= dt;
    if (e.smashT <= 0) {
      e.smashT = 0.8;
      e.smash = 0.25;
      this.damageStall(s, 9);
    }
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
        } else if (p.kind === 'suya') {
          this.hp = Math.min(PLAYER_HP, this.hp + 25);
          floatText(this, p.x, p.y - 50, 'SUYA! +25', NEON.pink, 12);
        } else if (p.kind === 'amala') {
          this.hp = Math.min(PLAYER_HP, this.hp + 35);
          floatText(this, p.x, p.y - 50, 'AMALA! +35', NEON.pink, 12);
        } else if (p.kind === 'sachet') {
          this.meter = Math.min(SHOUT_COST, this.meter + 30);
          floatText(this, p.x, p.y - 50, 'PURE WATER! +OYA', NEON.cyan, 11);
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

  private paintPickup(g: Phaser.GameObjects.Graphics, p: Pickup): void {
    const bob = Math.sin(p.age * 6) * 3;
    g.fillStyle(0x000000, 0.3).fillEllipse(p.x, p.y, 26, 7);
    if (p.kind === 'zobo') {
      g.fillStyle(0xb5179e, 1).fillRoundedRect(p.x - 7, p.y - 30 + bob, 14, 24, 3);
      g.fillStyle(0xffffff, 1).fillRect(p.x - 5, p.y - 36 + bob, 10, 7);
    } else if (p.kind === 'naira') {
      g.fillStyle(0x2e9e57, 1).fillRoundedRect(p.x - 16, p.y - 22 + bob, 32, 18, 3);
      g.fillStyle(0xd8ffe0, 1).fillRect(p.x - 5, p.y - 16 + bob, 10, 3).fillRect(p.x - 5, p.y - 10 + bob, 10, 3);
    } else if (p.kind === 'suya') {
      g.lineStyle(2, 0xd8c9a0, 1).lineBetween(p.x - 12, p.y - 10 + bob, p.x + 12, p.y - 26 + bob);
      g.fillStyle(0x8a4b2a, 1).fillRoundedRect(p.x - 8, p.y - 24 + bob, 8, 10, 3).fillRoundedRect(p.x + 1, p.y - 28 + bob, 8, 10, 3);
    } else if (p.kind === 'amala') {
      g.fillStyle(0xf4f1de, 1).fillEllipse(p.x, p.y - 8 + bob, 30, 10);
      g.fillStyle(0x4a2c12, 1).fillCircle(p.x, p.y - 14 + bob, 10);
      g.fillStyle(0x2e9e57, 1).fillEllipse(p.x + 10, p.y - 10 + bob, 12, 6);
    } else {
      g.fillStyle(0xcfeaff, 1).fillRoundedRect(p.x - 12, p.y - 22 + bob, 24, 14, 5);
      g.fillStyle(0x5ec8ff, 1).fillRect(p.x - 8, p.y - 18 + bob, 16, 4);
    }
  }

  private draw(): void {
    // Stalls and their sign boards.
    const sg = this.stallGfx.clear();
    for (const s of this.stalls) {
      drawStall(sg, s, this.elapsed);
      if (s.label) {
        const d = 1 - s.hp / s.maxHp;
        const alive = s.hp > 0;
        s.label.setPosition(s.x + stallOffset(s, this.elapsed), STALL_Y - 99 + (alive ? d * d * 18 : 24));
        s.label.setAlpha(alive ? 1 : 0.4);
        s.label.setAngle(d > 0.5 ? (s.x % 2 === 0 ? 5 : -5) : 0);
      }
    }

    const g = this.gfx.clear();
    type Item = { y: number; paint: () => void };
    const items: Item[] = [];

    for (const p of this.props) items.push({ y: p.y, paint: () => drawProp(g, p) });
    for (const p of this.pickups) if (p.age >= 0 || Math.floor(this.elapsed * 8) % 2 === 0) items.push({ y: p.y, paint: () => this.paintPickup(g, p) });

    for (const w of this.walkers) {
      items.push({
        y: w.y,
        paint: () => {
          drawFighter(g, w.x, w.y, w.face, {
            scale: w.scale,
            shirt: w.shirt,
            pants: w.pants,
            skin: w.skin,
            cap: w.cap,
            walk: w.walk,
            punch: 0,
            kick: 0,
            flash: false,
            down: 0,
            t: this.elapsed + w.x,
            lean: w.flee ? 4 : 0,
            shades: false,
            chain: false,
            hold: null,
          });
          if (w.kind === 'hawker') {
            const ty = w.y - 98 * w.scale;
            g.fillStyle(0xc9a66b, 1).fillEllipse(w.x, ty, 40, 8);
            for (let i = 0; i < 5; i++) {
              g.fillStyle([0xe74c3c, 0xf1c40f, 0x5ec8ff, 0x2ecc71, 0xffffff][i], 1).fillRect(w.x - 17 + i * 7, ty - 9, 6, 9);
            }
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
            cap: e.kind === 'boss' ? 0xffd166 : e.kind === 'looter' ? 0x111111 : 0x222222,
            walk: e.walk,
            punch: (winding && t > 0.7 ? 1 : 0) || (e.smash > 0 ? Math.sin((1 - e.smash / 0.25) * Math.PI) : 0),
            kick: 0,
            flash: e.flash > 0 || (winding && Math.floor(this.elapsed * 20) % 2 === 0),
            down: e.dying > 0 ? Math.max(0, 1 - e.dying) : 0,
            t: this.elapsed + e.slot,
            lean: winding ? (t > 0.7 ? 4 : -3) : e.kind === 'drunk' ? Math.sin(this.elapsed * 3 + e.slot) * 4 : 0,
            shades: e.kind === 'boss',
            chain: e.kind === 'boss' || e.kind === 'bruiser',
            hold: e.kind === 'looter' && !e.aggro ? 'bottle' : null,
          });
          if (e.dying === 0) {
            const w = 38 * e.stats.scale;
            const top = e.y - 98 * e.stats.scale;
            g.fillStyle(0x000000, 0.6).fillRect(e.x - w / 2, top, w, 5);
            g.fillStyle(e.kind === 'looter' ? NEON.yellow : NEON.pink, 1).fillRect(e.x - w / 2, top, w * Math.max(0, e.hp / e.maxHp), 5);
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
          t: this.elapsed,
          lean: punchP > 0 ? 4 * punchP : kickP > 0 ? -2 * kickP : 0,
          shades: false,
          chain: false,
          hold: this.held,
        });
      },
    });

    for (const s of this.shots) {
      items.push({
        y: s.y + 30,
        paint: () => {
          const cx = s.x;
          const cy = s.y - 50;
          const a = s.spin;
          const c = Math.cos(a);
          const sn = Math.sin(a);
          if (s.kind === 'chair') {
            g.lineStyle(5, 0xf2f2f2, 1).lineBetween(cx - 12 * c, cy - 12 * sn, cx + 12 * c, cy + 12 * sn);
            g.lineStyle(4, 0xdcdcdc, 1).lineBetween(cx - 12 * sn, cy + 12 * c, cx + 12 * sn, cy - 12 * c);
          } else {
            g.lineStyle(7, 0x2e7d32, 1).lineBetween(cx - 10 * c, cy - 10 * sn, cx + 10 * c, cy + 10 * sn);
            g.fillStyle(0xffd166, 1).fillCircle(cx + 11 * c, cy + 11 * sn, 3);
          }
          g.fillStyle(0x000000, 0.3).fillEllipse(s.x, s.y, 22, 6);
        },
      });
    }

    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.paint();

    // Dust puffs.
    for (const d of this.dust) g.fillStyle(0xcdb79a, (d.life / d.max) * 0.32).fillCircle(d.x, d.y, d.r);

    this.drawLights();
    this.drawHud();
  }

  /** Warm glow from the bulbs, stall lamps and suya coals. It flickers when the park is in trouble. */
  private drawLights(): void {
    const gl = this.glow.clear();
    const flick = this.peace < 30 && Math.random() < 0.18 ? 0.25 : 1;
    for (const [bx, by] of BULBS) {
      gl.fillStyle(0xffd98a, 0.05 * flick).fillCircle(bx, by, 50);
      gl.fillStyle(0xffd98a, 0.08 * flick).fillCircle(bx, by, 26);
      gl.fillStyle(0xfff1c2, 0.25 * flick).fillCircle(bx, by + 3, 9);
    }
    for (const s of this.stalls) {
      if (s.hp <= 0) continue;
      const k = (s.hp / s.maxHp) * flick;
      gl.fillStyle(0xffc46b, 0.07 * k).fillEllipse(s.x, FLOOR_TOP + 34, 200, 64);
      gl.fillStyle(0xffc46b, 0.1 * k).fillCircle(s.x, STALL_Y - 64, 34);
      if (s.kind === 'suya') gl.fillStyle(0xff7a3d, (0.12 + 0.05 * Math.sin(this.elapsed * 9)) * k).fillCircle(s.x, STALL_Y - 40, 40);
    }
    this.dim.setAlpha(Math.max(0, (70 - this.peace) / 70) * 0.45);
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
    // Park peace.
    const pc = this.peace > 60 ? NEON.green : this.peace > 30 ? NEON.yellow : NEON.pink;
    h.fillStyle(0x000000, 0.55).fillRect(300, 14, 200, 14);
    h.fillStyle(pc, 1).fillRect(302, 16, 196 * (this.peace / 100), 10);
    h.lineStyle(2, 0xffffff, 0.5).strokeRect(300, 14, 200, 14);
    this.scoreText.setText(this.score.toLocaleString());
    this.waveText.setText(this.wave > 0 ? `WAVE ${this.wave}` : '');
    const mult = this.multiplier();
    this.comboText.setText(this.combo > 1 ? `${this.combo} HITS${mult > 1 ? `  x${mult}` : ''}` : '');
    this.lossText.setText(this.loss > 0 ? `LOSS N${this.loss.toLocaleString()}` : '');
    this.heldText.setText(this.held ? `HOLDING ${this.held.toUpperCase()}  (PUNCH TO THROW)` : '');
  }
}

void startArcadeGame({
  width: WIDTH,
  height: HEIGHT,
  scenes: [MenuScene, GameScene, ArcadeGameOverScene],
});
