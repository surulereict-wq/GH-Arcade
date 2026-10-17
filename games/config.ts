export const GAME_ID = 'danfo';

export const WIDTH = 800;
export const HEIGHT = 600;

/** Three lanes, top to bottom. The road scrolls right to left; the danfo stays at PLAYER_X. */
export const LANE_Y = [350, 430, 510] as const;
export const LANE_H = 80;
export const ROAD_TOP = 310;
export const ROAD_BOTTOM = 550;

export const PLAYER_X = 170;
export const PLAYER_W = 112;
export const PLAYER_H = 46;

export const START_SPEED = 330;
export const MAX_SPEED = 780;
/** Speed gained per second. */
export const ACCELERATION = 8;
/** World pixels per metre on the HUD. */
export const PX_PER_METRE = 14;

export const START_LIVES = 3;
export const INVULN_MS = 1300;
/** Speed kept after a crash. */
export const CRASH_SLOWDOWN = 0.72;

export const FARE_POINTS = 50;
export const NAIRA_POINTS = 25;

/** Seconds-long turbo from the lightning pickup: faster road and no crash damage. */
export const BOOST_MS = 3500;
export const BOOST_SPEED_MUL = 1.4;
/** Every this many pickups in a row raises the fare multiplier by one (up to MAX_MULT). */
export const COMBO_STEP = 4;
export const MAX_MULT = 5;

export interface Zone {
  name: string;
  /** Metres travelled before this district starts. */
  fromMetre: number;
  sky: number;
  shades: readonly [number, number, number];
  window: number;
  night: boolean;
  water: boolean;
  shout: string;
  color: number;
}

/** The route: each district changes the skyline, sky colour and the conductor's shout. */
export const ZONES: readonly Zone[] = [
  { name: 'SURULERE', fromMetre: 0, sky: 0x0b0b1f, shades: [0x1d2a4a, 0x2b2350, 0x3a2a3d], window: 0xffe45e, night: false, water: false, shout: 'OYA! SURULERE! SURULERE!', color: 0xffe45e },
  { name: 'YABA', fromMetre: 600, sky: 0x1a0b2e, shades: [0x3b2a5a, 0x4a2350, 0x2d2a4d], window: 0x00f0ff, night: false, water: false, shout: 'YABA! YABA! ONE SEAT!', color: 0x00f0ff },
  { name: 'THIRD MAINLAND BRIDGE', fromMetre: 1400, sky: 0x0a2a4a, shades: [0x16405e, 0x1b3a63, 0x123a50], window: 0xffffff, night: false, water: true, shout: 'BRIDGE DEY CLEAR! HOLD AM!', color: 0x3dff8a },
  { name: 'LEKKI', fromMetre: 2400, sky: 0x02020a, shades: [0x14142e, 0x22123a, 0x101a30], window: 0xff2e97, night: true, water: false, shout: 'LEKKI! LEKKI! NO CHANGE!', color: 0xff2e97 },
];
