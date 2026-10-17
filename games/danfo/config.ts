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
