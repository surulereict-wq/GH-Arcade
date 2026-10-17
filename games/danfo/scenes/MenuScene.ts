import Phaser from 'phaser';
import { GAME_ID, LANE_Y, ROAD_BOTTOM, ROAD_TOP, WIDTH } from '../config';
import { buildMenu } from '../../../shared/scenes';
import { NEON, reducedMotion } from '../../../shared/ui';

export class MenuScene extends Phaser.Scene {
  private road!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.road = this.add.graphics().setAlpha(0.45);
    buildMenu(this, {
      gameId: GAME_ID,
      title: ['DANFO', 'DASH'],
      colors: [NEON.yellow, NEON.green],
      help: 'Change lane: ↑ ↓ / W S / swipe up or down / tap top or bottom half\nCollect passengers and naira, dodge traffic and potholes    Pause: P / Start',
    });
  }

  /** A road with dashed lane lines rushing past behind the title. */
  update(now: number): void {
    const time = reducedMotion() ? 0 : now;
    const g = this.road.clear();
    g.fillStyle(0x1a1a2e, 1).fillRect(0, ROAD_TOP, WIDTH, ROAD_BOTTOM - ROAD_TOP);
    g.lineStyle(3, NEON.yellow, 0.8);
    g.lineBetween(0, ROAD_TOP, WIDTH, ROAD_TOP);
    g.lineBetween(0, ROAD_BOTTOM, WIDTH, ROAD_BOTTOM);
    g.fillStyle(0xffffff, 0.7);
    const offset = (time / 4) % 80;
    for (const y of [(LANE_Y[0] + LANE_Y[1]) / 2, (LANE_Y[1] + LANE_Y[2]) / 2]) {
      for (let x = -80; x < WIDTH + 80; x += 80) g.fillRect(x - offset, y - 2, 40, 4);
    }
  }
}
