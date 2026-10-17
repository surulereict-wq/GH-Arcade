import Phaser from 'phaser';
import {
  ACCELERATION,
  BOOST_MS,
  BOOST_SPEED_MUL,
  COMBO_STEP,
  CRASH_SLOWDOWN,
  FARE_POINTS,
  GAME_ID,
  HEIGHT,
  INVULN_MS,
  LANE_Y,
  MAX_MULT,
  MAX_SPEED,
  NAIRA_POINTS,
  PLAYER_H,
  PLAYER_W,
  PLAYER_X,
  PX_PER_METRE,
  ROAD_BOTTOM,
  ROAD_TOP,
  START_LIVES,
  START_SPEED,
  WIDTH,
  ZONES,
} from '../config';
import { ArcadeControls } from '../../../shared/controls';
import { PauseController } from '../../../shared/pause';
import { noise, tone } from '../../../shared/sfx';
import { getHighScore } from '../../../shared/storage';
import { onSwipe } from '../../../shared/touch';
import { burstEmitter, floatText, NEON, PIXEL_FONT, reducedMotion, showBanner } from '../../../shared/ui';

type Kind = 'car' | 'keke' | 'truck' | 'brt' | 'okada' | 'pothole' | 'passenger' | 'naira' | 'boost';

interface KindInfo {
  w: number;
  h: number;
  /** Forward speed in the world (px/s). The road scrolls at the game speed, so slow things come toward you. */
  drive: number;
  harmful: boolean;
}

const KINDS: Record<Kind, KindInfo> = {
  car: { w: 86, h: 40, drive: 140, harmful: true },
  keke: { w: 60, h: 38, drive: 100, harmful: true },
  truck: { w: 130, h: 50, drive: 90, harmful: true },
  brt: { w: 200, h: 46, drive: 120, harmful: true },
  okada: { w: 56, h: 26, drive: 200, harmful: true },
  pothole: { w: 62, h: 26, drive: 0, harmful: true },
  passenger: { w: 26, h: 40, drive: 0, harmful: false },
  naira: { w: 34, h: 22, drive: 0, harmful: false },
  boost: { w: 34, h: 34, drive: 0, harmful: false },
};

const SHOUTS = ['OYA!', 'ONE SEAT!', 'ENTER!', 'CONDUCTOR!'];

const BODY_COLORS = [0xc0392b, 0x2c7be5, 0xe8e8f0, 0x27ae60, 0x8e44ad, 0xe67e22];

interface Thing {
  kind: Kind;
  /** World x: screen x = x - distance + PLAYER_X. */
  x: number;
  lane: number;
  color: number;
  taken: boolean;
}

interface Building {
  x: number;
  w: number;
  h: number;
  shade: number;
}

export class GameScene extends Phaser.Scene {
  private distance = 0;
  private speed = START_SPEED;
  private lane = 1;
  private y: number = LANE_Y[1];
  private lives = START_LIVES;
  private fares = 0;
  private things: Thing[] = [];
  private nextSpawnAt = 0;
  private invuln = 0;
  private alive = true;
  private elapsed = 0;
  private combo = 0;
  private boostMs = 0;
  private zoneIdx = 0;

  private far: Building[] = [];
  private gfx!: Phaser.GameObjects.Graphics;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private zoneText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private controls!: ArcadeControls;
  private pause!: PauseController;

  constructor() {
    super('Game');
  }

  init(): void {
    this.distance = 0;
    this.speed = START_SPEED;
    this.lane = 1;
    this.y = LANE_Y[1];
    this.lives = START_LIVES;
    this.fares = 0;
    this.things = [];
    this.nextSpawnAt = WIDTH;
    this.invuln = 0;
    this.alive = true;
    this.elapsed = 0;
    this.combo = 0;
    this.boostMs = 0;
    this.zoneIdx = 0;
  }

  create(): void {
    this.cameras.main.fadeIn(250, 5, 5, 13);
    this.cameras.main.setBackgroundColor(ZONES[0].sky);
    this.far = this.makeSkyline();
    this.gfx = this.add.graphics();
    this.burst = burstEmitter(this, 320, 600);

    this.scoreText = this.add
      .text(20, 16, '', { fontFamily: PIXEL_FONT, fontSize: '16px', color: '#e8e8ff' })
      .setDepth(10);
    this.livesText = this.add
      .text(WIDTH - 20, 16, '', { fontFamily: PIXEL_FONT, fontSize: '16px', color: '#ff2e97' })
      .setOrigin(1, 0)
      .setDepth(10);
    this.add
      .text(20, 44, `BEST ${getHighScore(GAME_ID).toLocaleString()}`, { fontFamily: PIXEL_FONT, fontSize: '10px', color: '#8a8ab8' })
      .setDepth(10);

    this.zoneText = this.add
      .text(WIDTH / 2, 16, ZONES[0].name, { fontFamily: PIXEL_FONT, fontSize: '11px', color: '#ffe45e' })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.comboText = this.add
      .text(20, 66, '', { fontFamily: PIXEL_FONT, fontSize: '10px', color: '#ffe45e' })
      .setDepth(10);

    this.controls = new ArcadeControls(this);
    this.pause = new PauseController(this, this.controls);

    onSwipe(this, (dir) => {
      if (this.pause.isPaused) return;
      if (dir === 'up') this.changeLane(-1);
      else if (dir === 'down') this.changeLane(1);
      else if (dir === 'tap') {
        const p = this.input.activePointer;
        this.changeLane(p.y < HEIGHT / 2 ? -1 : 1);
      }
    });
    this.refreshHud();
  }

  update(_time: number, deltaMs: number): void {
    if (this.pause.isPaused || !this.alive) return;
    const dt = Math.min(deltaMs, 50) / 1000;
    this.elapsed += dt;

    if (this.controls.justPressed('up')) this.changeLane(-1);
    if (this.controls.justPressed('down')) this.changeLane(1);

    this.speed = Math.min(MAX_SPEED, this.speed + ACCELERATION * dt);
    this.distance += this.speed * dt * (this.boostMs > 0 ? BOOST_SPEED_MUL : 1);
    if (this.boostMs > 0) this.boostMs -= dt * 1000;
    this.checkZone();
    this.y += (LANE_Y[this.lane] - this.y) * Math.min(1, dt * 14);
    if (this.invuln > 0) this.invuln -= dt * 1000;

    this.spawn();
    this.updateThings(dt);
    this.refreshHud();
    this.draw();
  }

  private changeLane(delta: number): void {
    const next = Phaser.Math.Clamp(this.lane + delta, 0, LANE_Y.length - 1);
    if (next === this.lane) return;
    this.lane = next;
    tone({ freq: 300, toFreq: 380, duration: 0.05, volume: 0.04 });
  }

  /** The gap between spawns shrinks as the road gets faster. */
  private spawn(): void {
    while (this.nextSpawnAt < this.distance + WIDTH + 200) {
      const roll = Math.random();
      const lane = Phaser.Math.Between(0, LANE_Y.length - 1);
      if (roll < 0.2) {
        this.add1('passenger', this.nextSpawnAt, lane);
      } else if (roll < 0.34) {
        for (let i = 0; i < 3; i++) this.add1('naira', this.nextSpawnAt + i * 55, lane);
      } else if (roll < 0.375) {
        this.add1('boost', this.nextSpawnAt, lane);
      } else if (roll < 0.52) {
        // Two lanes blocked, one open: forces a decision.
        const open = Phaser.Math.Between(0, LANE_Y.length - 1);
        for (let l = 0; l < LANE_Y.length; l++) {
          if (l !== open) this.add1(this.pickObstacle(), this.nextSpawnAt, l);
        }
      } else {
        this.add1(this.pickObstacle(), this.nextSpawnAt, lane);
      }
      this.nextSpawnAt += Phaser.Math.Between(260, 420) * (1 - 0.35 * (this.speed - START_SPEED) / (MAX_SPEED - START_SPEED));
    }
  }

  private pickObstacle(): Kind {
    const pool: Kind[] = ['car', 'car', 'keke', 'keke', 'truck', 'brt', 'okada', 'pothole', 'pothole'];
    return pool[Phaser.Math.Between(0, pool.length - 1)];
  }

  private add1(kind: Kind, x: number, lane: number): void {
    const color = BODY_COLORS[Phaser.Math.Between(0, BODY_COLORS.length - 1)];
    this.things.push({ kind, x, lane, color, taken: false });
  }

  private updateThings(dt: number): void {
    const busLeft = PLAYER_X - PLAYER_W / 2;
    const busRight = PLAYER_X + PLAYER_W / 2;
    for (let i = this.things.length - 1; i >= 0; i--) {
      const t = this.things[i];
      const info = KINDS[t.kind];
      t.x += info.drive * dt;
      const sx = t.x - this.distance + PLAYER_X;
      if (sx < -200) {
        this.things.splice(i, 1);
        continue;
      }
      if (t.taken) continue;
      const overlapX = sx + info.w / 2 > busLeft + 6 && sx - info.w / 2 < busRight - 6;
      const overlapY = Math.abs(LANE_Y[t.lane] - this.y) < (info.h + PLAYER_H) / 2 - 6;
      if (!overlapX || !overlapY) continue;
      if (info.harmful) {
        if (this.invuln <= 0 && this.boostMs <= 0) this.crash(sx, LANE_Y[t.lane]);
      } else {
        t.taken = true;
        this.collect(t.kind, sx, LANE_Y[t.lane]);
      }
    }
  }

  private collect(kind: Kind, sx: number, sy: number): void {
    if (kind === 'boost') {
      this.boostMs = BOOST_MS;
      floatText(this, sx, sy - 40, 'NEPA BRING LIGHT!', NEON.yellow, 12);
      this.burst.setParticleTint(NEON.yellow);
      this.burst.explode(18, sx, sy);
      tone({ freq: 440, toFreq: 1320, duration: 0.25, type: 'sawtooth' });
      return;
    }
    this.combo++;
    const mult = this.multiplier();
    const points = (kind === 'passenger' ? FARE_POINTS : NAIRA_POINTS) * mult;
    this.fares += points;
    const shout = kind === 'passenger' ? SHOUTS[Phaser.Math.Between(0, SHOUTS.length - 1)] : '';
    floatText(this, sx, sy - 40, `+${points}${mult > 1 ? ` x${mult}` : ''} ${shout}`.trim(), kind === 'passenger' ? NEON.yellow : NEON.green);
    this.burst.setParticleTint(kind === 'passenger' ? NEON.yellow : NEON.green);
    this.burst.explode(10, sx, sy);
    tone({ freq: 660, toFreq: kind === 'passenger' ? 1100 : 880, duration: 0.09 });
    if (this.combo % (COMBO_STEP * 2) === 0) showBanner(this, 'CONDUCTOR: OYA! OYA! OYA!', NEON.yellow, 150);
  }

  private multiplier(): number {
    return Math.min(MAX_MULT, 1 + Math.floor(this.combo / COMBO_STEP));
  }

  /** Moves to the next district when the distance passes its start. */
  private checkZone(): void {
    const metres = Math.floor(this.distance / PX_PER_METRE);
    let idx = this.zoneIdx;
    while (idx + 1 < ZONES.length && metres >= ZONES[idx + 1].fromMetre) idx++;
    if (idx === this.zoneIdx) return;
    this.zoneIdx = idx;
    const zone = ZONES[idx];
    this.cameras.main.setBackgroundColor(zone.sky);
    this.zoneText.setText(zone.name);
    showBanner(this, zone.name, zone.color, 220);
    floatText(this, WIDTH / 2, 280, zone.shout, zone.color, 12);
    tone({ freq: 523, toFreq: 784, duration: 0.2 });
  }

  private crash(sx: number, sy: number): void {
    this.lives--;
    this.combo = 0;
    this.invuln = INVULN_MS;
    this.speed = Math.max(START_SPEED, this.speed * CRASH_SLOWDOWN);
    noise(0.25, 0.12);
    this.burst.setParticleTint(NEON.pink);
    this.burst.explode(22, sx, sy);
    if (!reducedMotion()) this.cameras.main.shake(260, 0.012);
    this.refreshHud();
    if (this.lives > 0) {
      floatText(this, PLAYER_X, this.y - 50, 'OYA STOP!', NEON.pink, 14);
      return;
    }
    this.alive = false;
    this.cameras.main.flash(180, 255, 46, 151);
    const metres = Math.floor(this.distance / PX_PER_METRE);
    const score = metres + this.fares;
    this.time.delayedCall(700, () =>
      this.scene.start('GameOver', { gameId: GAME_ID, score, detail: `${metres}m   N${this.fares} FARES` }),
    );
  }

  private refreshHud(): void {
    const metres = Math.floor(this.distance / PX_PER_METRE);
    this.scoreText.setText(String(metres + this.fares));
    this.livesText.setText('♥'.repeat(Math.max(0, this.lives)));
    const mult = this.multiplier();
    const parts: string[] = [];
    if (this.combo > 0) parts.push(`COMBO ${this.combo}${mult > 1 ? `  x${mult}` : ''}`);
    if (this.boostMs > 0) parts.push('TURBO!');
    this.comboText.setText(parts.join('   '));
  }

  private makeSkyline(): Building[] {
    const out: Building[] = [];
    let x = 0;
    while (x < WIDTH + 400) {
      const w = Phaser.Math.Between(50, 110);
      out.push({ x, w, h: Phaser.Math.Between(60, 200), shade: Phaser.Math.Between(0, 2) });
      x += w + Phaser.Math.Between(4, 16);
    }
    return out;
  }

  private draw(): void {
    const g = this.gfx.clear();

    const zone = ZONES[this.zoneIdx];
    if (zone.night) {
      for (let i = 0; i < 40; i++) {
        const alpha = 0.55 + 0.35 * Math.sin(this.elapsed * 3 + i);
        g.fillStyle(0xffffff, alpha).fillRect((i * 97) % WIDTH, 20 + ((i * 53) % 190), 2, 2);
      }
    }

    // Skyline, scrolling slowly. The bridge district keeps the buildings low and shows the lagoon.
    const heightScale = zone.water ? 0.4 : 1;
    const span = this.far[this.far.length - 1].x + this.far[this.far.length - 1].w + 10;
    const shift = (this.distance * 0.2) % span;
    for (const b of this.far) {
      const bh = b.h * heightScale;
      for (const k of [0, span]) {
        const bx = b.x - shift + k;
        if (bx > WIDTH || bx + b.w < 0) continue;
        g.fillStyle(zone.shades[b.shade], 1).fillRect(bx, ROAD_TOP - bh, b.w, bh);
        g.fillStyle(zone.window, 0.35);
        for (let wy = ROAD_TOP - bh + 10; wy < ROAD_TOP - 14; wy += 22) {
          for (let wx = bx + 8; wx < bx + b.w - 12; wx += 18) g.fillRect(wx, wy, 7, 9);
        }
      }
    }
    if (zone.water) {
      g.fillStyle(0x0b4f8a, 1).fillRect(0, ROAD_TOP - 34, WIDTH, 34);
      g.fillStyle(0x7fd0ff, 0.5);
      const wave = (this.distance * 0.5) % 70;
      for (let x = -70; x < WIDTH + 70; x += 70) g.fillRect(x - wave, ROAD_TOP - 20, 30, 3).fillRect(x - wave + 35, ROAD_TOP - 9, 24, 3);
    }

    // Road, kerbs and dashed lane lines.
    g.fillStyle(0x1a1a2e, 1).fillRect(0, ROAD_TOP, WIDTH, ROAD_BOTTOM - ROAD_TOP);
    g.fillStyle(0x0d0d1c, 1).fillRect(0, ROAD_BOTTOM, WIDTH, HEIGHT - ROAD_BOTTOM);
    g.lineStyle(3, NEON.yellow, 0.9);
    g.lineBetween(0, ROAD_TOP, WIDTH, ROAD_TOP);
    g.lineBetween(0, ROAD_BOTTOM, WIDTH, ROAD_BOTTOM);
    const dash = this.distance % 80;
    g.fillStyle(0xffffff, 0.6);
    for (const y of [(LANE_Y[0] + LANE_Y[1]) / 2, (LANE_Y[1] + LANE_Y[2]) / 2]) {
      for (let x = -80; x < WIDTH + 80; x += 80) g.fillRect(x - dash, y - 2, 40, 4);
    }

    // Everything on the road, then the danfo on top.
    for (const t of this.things) {
      if (t.taken) continue;
      this.drawThing(g, t, t.x - this.distance + PLAYER_X, LANE_Y[t.lane]);
    }
    const flashing = this.invuln > 0 && this.boostMs <= 0 && Math.floor(this.elapsed * 14) % 2 === 0;
    if (this.boostMs > 0) g.fillStyle(NEON.yellow, 0.25).fillEllipse(PLAYER_X, this.y, PLAYER_W + 50, PLAYER_H + 30);
    if (!flashing && (this.alive || this.lives > 0)) this.drawDanfo(g, PLAYER_X, this.y);
  }

  private drawDanfo(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const w = PLAYER_W;
    const h = PLAYER_H;
    g.fillStyle(0x000000, 0.35).fillRect(x - w / 2 + 3, y - h / 2 + 5, w, h);
    g.fillStyle(0xf6c90e, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, 6);
    g.fillStyle(0x111111, 1).fillRect(x - w / 2, y - 3, w, 7); // the black danfo stripe
    g.fillStyle(0x9fd6f2, 1).fillRect(x + w / 2 - 22, y - h / 2 + 5, 16, h - 10); // windscreen
    g.fillStyle(0x7bbbe0, 1);
    for (let i = 0; i < 4; i++) g.fillRect(x - w / 2 + 8 + i * 17, y - h / 2 + 5, 12, 11);
    g.fillStyle(0xffffff, 1).fillRect(x + w / 2 - 4, y - h / 2 + 6, 4, 8).fillRect(x + w / 2 - 4, y + h / 2 - 14, 4, 8);
    g.fillStyle(0xff3b30, 1).fillRect(x - w / 2, y - h / 2 + 6, 4, 8).fillRect(x - w / 2, y + h / 2 - 14, 4, 8);
  }

  private drawThing(g: Phaser.GameObjects.Graphics, t: Thing, x: number, y: number): void {
    const info = KINDS[t.kind];
    const w = info.w;
    const h = info.h;
    switch (t.kind) {
      case 'car':
        g.fillStyle(t.color, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, 6);
        g.fillStyle(0x15151f, 1).fillRect(x - w / 2 + 14, y - h / 2 + 5, w - 36, h - 10);
        g.fillStyle(0xffe9a0, 1).fillRect(x - w / 2, y - h / 2 + 5, 4, 8).fillRect(x - w / 2, y + h / 2 - 13, 4, 8);
        break;
      case 'keke':
        g.fillStyle(0x27ae60, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, 8);
        g.fillStyle(0xf6c90e, 1).fillRect(x - w / 2 + 6, y - h / 2, w - 12, 9);
        g.fillStyle(0x15151f, 1).fillRect(x - w / 2 + 6, y + 2, w - 22, 9);
        break;
      case 'truck':
        g.fillStyle(0xd35400, 1).fillRect(x - w / 2, y - h / 2, w - 34, h);
        g.fillStyle(0x7f8c8d, 1).fillRect(x + w / 2 - 34, y - h / 2 + 4, 34, h - 8);
        g.fillStyle(0xffffff, 0.85).fillRect(x - w / 2 + 10, y - 4, w - 62, 8);
        break;
      case 'brt':
        g.fillStyle(0x1e5aa8, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, 6);
        g.fillStyle(0xffffff, 0.9).fillRect(x - w / 2, y - 3, w, 6);
        g.fillStyle(0x9fd6f2, 1);
        for (let i = 0; i < 6; i++) g.fillRect(x - w / 2 + 12 + i * 29, y - h / 2 + 5, 20, 11);
        g.fillStyle(0xffe9a0, 1).fillRect(x - w / 2, y - h / 2 + 6, 4, 8).fillRect(x - w / 2, y + h / 2 - 14, 4, 8);
        break;
      case 'boost':
        g.fillStyle(NEON.yellow, 0.35).fillCircle(x, y, 20);
        g.fillStyle(NEON.yellow, 1).fillTriangle(x - 8, y - 14, x + 10, y - 14, x + 1, y + 1).fillTriangle(x - 10, y + 2, x + 8, y + 2, x - 1, y + 16);
        break;
      case 'okada':
        g.fillStyle(0x111111, 1).fillRect(x - w / 2, y - 3, w, 6);
        g.fillStyle(0xe67e22, 1).fillCircle(x - 4, y - 2, 9);
        g.fillStyle(0x2980b9, 1).fillCircle(x + 12, y + 1, 8);
        break;
      case 'pothole':
        g.fillStyle(0x05050d, 1).fillEllipse(x, y, w, h);
        g.lineStyle(3, 0x4a3b2a, 1).strokeEllipse(x, y, w, h);
        break;
      case 'passenger':
        g.fillStyle(0xffffff, 1).fillCircle(x, y - 12, 7);
        g.fillStyle(0xe84393, 1).fillRect(x - 8, y - 4, 16, 22);
        g.fillStyle(NEON.yellow, 1).fillTriangle(x + 6, y - 22, x + 18, y - 28, x + 14, y - 14);
        break;
      case 'naira':
        g.fillStyle(0x2e9e57, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, 3);
        g.fillStyle(0xd8ffe0, 1).fillRect(x - 6, y - 5, 12, 3).fillRect(x - 6, y + 2, 12, 3);
        break;
    }
  }
}

