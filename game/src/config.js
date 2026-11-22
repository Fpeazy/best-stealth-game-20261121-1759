// SHADOW DOCK — configuration, palette, and the hand-built port level.
// A night harbour heist: one deep level, 32x18 tiles at 40px, 1280x720.
// Palette is strict and semantic: navy = night, red = danger, cyan = light/player,
// yellow = warning, fog grey = atmosphere. No colour outside this palette.
export const TILE = 40;
export const COLS = 32;
export const ROWS = 18;
export const WIDTH = COLS * TILE; // 1280
export const HEIGHT = ROWS * TILE; // 720

export const PALETTE = {
  navy: '#0b1026', // deep night harbour
  navyDark: '#05060b', // darkest shadow
  navyMid: '#131a33', // dock floor shade
  red: '#d92323', // container red / danger
  redDark: '#8f1414', // alert / shadow red
  cyan: '#00f2ff', // light / player
  cyanDim: '#0a7d8c', // dim cyan
  yellow: '#ffd700', // sodium warning
  fog: '#6b7280', // fog grey
  fogLight: '#9aa3b2', // light fog
  dock: '#2a2f45', // dock floor
  dockLine: '#3a415e', // tile edge
  deck: '#4a3421', // ship deck wood
  deckLine: '#6b4c2f', // deck plank line
  water: '#0d2438', // harbour water
  waterLine: '#14506e', // water shimmer
  crate: '#7a5a2e', // crate wood
  crateLine: '#a07d42', // crate edge
  wall: '#1c2340', // warehouse wall
  white: '#f4f6ff', // player / bright text
  text: '#e8ecf7', // HUD text
  textDim: '#8b93ad', // dim text
};

// Tile kinds. '#' solid (container/wall, blocks movement + vision).
// '=' crate (solid for movement; half cover: hides a CROUCHED player from cones).
// '~' water (walkable, slow, splash + reflection). '.' dock floor. 'D' ship deck.
// 'K' ignition key, 'E' exit gangplank, 'B' breaker, 'S' player spawn.
export const T = {
  CONTAINER: '#',
  CRATE: '=',
  WATER: '~',
  FLOOR: '.',
  DECK: 'D',
  KEY: 'K',
  EXIT: 'E',
  BREAKER: 'B',
  SPAWN: 'S',
};

// Player movement (px/s) — distinct feel per stance, with acceleration.
export const PLAYER = {
  walk: 112,
  crouch: 72,
  sprint: 190,
  accel: 1200, // px/s^2 toward the target velocity
  decel: 1600, // px/s^2 when no input (smooth stop, not instant)
  radius: 13,
  crouchRadius: 11,
};

// Guard movement (px/s).
export const GUARD = {
  patrol: 55,
  suspect: 70,
  investigate: 85,
  search: 65,
  chase: 135,
  radius: 13,
};

// Vision cone: range in px, half-angle in radians (~35 deg).
export const VISION = {
  range: 210,
  halfAngle: 0.61,
};

// Detection meter 0..100. Rates per second.
export const DETECTION = {
  lit: 55, // player lit and central in a cone
  shadow: 25, // player in shadow inside a cone
  decay: 40, // hidden: meter drains
  suspectAt: 35, // guard turns suspicious
  investigateAt: 70, // guard investigates
  alertAt: 100, // guard alerts / chases
};

// Noise: sprint and coin throws make noise guards investigate.
export const NOISE = {
  sprintRadius: 150,
  coinRadius: 170,
  coinCount: 3,
};

// Lighting (RTX dark/light): the fog-of-war radius around the player and
// the darkness of the unlit harbour (0 = pitch black, 1 = fully lit).
export const LIGHT = {
  fogRadius: 300,
  fogFeather: 60,
  darkness: 0.82, // how dark the unlit harbour is
  lighthousePeriod: 4, // seconds per lighthouse sweep
  cranePeriod: 6, // seconds per crane searchlight sweep
};

/**
 * Build the level grid (ROWS strings of COLS chars). Programmatic, not
 * hand-drawn, so every row is exactly COLS wide by construction.
 * Zones: (1) Dock Gate / warehouse, bottom-left (spawn + key office);
 * (2) Crane Yard, middle (container maze + crane searchlight);
 * (3) Ship Hull, top-right (the Kestrel, exit at the gangplank).
 */
export function buildLevel() {
  const grid = [];
  for (let y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(T.FLOOR));

  const set = (x, y, ch) => {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) grid[y][x] = ch;
  };
  const rect = (x0, y0, x1, y1, ch) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch);
  };

  // Harbour water: top-left block (the open water beyond the dock) and the
  // bottom row (the dock edge), plus the left column below the warehouse.
  rect(0, 0, 19, 1, T.WATER);
  rect(0, 17, 31, 17, T.WATER);
  for (let y = 2; y <= 16; y++) set(0, y, T.WATER);

  // The Kestrel, moored top-right: a wooden deck, 12 wide x 4 tall.
  rect(20, 0, 31, 3, T.DECK);
  // Gangplank / exit: the bottom-left corner of the deck, where it meets the dock.
  set(20, 3, T.EXIT);

  // Warehouse (Dock Gate, bottom-left): walls with a door gap on the top side.
  // Office inside holds the ignition key.
  rect(1, 13, 5, 13, T.CONTAINER); // top wall
  rect(1, 16, 5, 16, T.CONTAINER); // bottom wall
  rect(1, 14, 1, 15, T.CONTAINER); // left wall
  rect(5, 14, 5, 15, T.CONTAINER); // right wall
  set(3, 13, T.FLOOR); // door gap in the top wall
  set(3, 14, T.KEY); // ignition key in the office

  // Breaker: darkens the crane yard for ~12s when sabotaged.
  set(12, 8, T.BREAKER);

  // Player spawn: just outside the warehouse door, bottom-left.
  set(2, 12, T.SPAWN);

  // Containers: 2x2 maze blocks (solid, block vision + movement).
  const containers = [
    [8, 4], [14, 5], [22, 6], [10, 9], [24, 10], [6, 8], [17, 11], [27, 8],
  ];
  for (const [cx, cy] of containers) rect(cx, cy, cx + 1, cy + 1, T.CONTAINER);

  // Crates: single tiles, half cover (hide a crouched player from cones).
  const crates = [
    [6, 7], [12, 5], [18, 9], [22, 12], [8, 11], [16, 13], [26, 12], [4, 9],
    [11, 3], [28, 5], [15, 14], [24, 14],
  ];
  for (const [cx, cy] of crates) set(cx, cy, T.CRATE);

  // Crane base: a solid block in the yard (the searchlight sweeps from it).
  rect(16, 7, 17, 8, T.CONTAINER);

  return grid.map((row) => row.join(''));
}

// Guard patrol routes: arrays of tile waypoints [x, y].
export const GUARD_ROUTES = [
  // G1: the dock row, east-west along the middle of the dock.
  [[7, 6], [13, 6], [19, 6], [25, 6]],
  // G2: the warehouse loop, around the office block.
  [[7, 12], [7, 15], [11, 15], [11, 12]],
  // G3: static at the gangplank, cone toward the water/dock.
  [[21, 4]],
  // G4: the crane yard, north-south through the containers.
  [[14, 3], [14, 9], [14, 14]],
];

// Crane searchlight: sweeps from the crane base, a hazard (not a guard).
export const CRANE = { x: 16.5, y: 7.5, range: 260, halfAngle: 0.22 };

// The level, built once. Tile lookup: levelAt(x, y) returns the char.
export const LEVEL = buildLevel();
export function levelAt(tx, ty) {
  if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return T.CONTAINER;
  return LEVEL[ty][tx];
}
export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}
export function isSolidTile(ch) {
  return ch === T.CONTAINER || ch === T.CRATE;
}
export function isWaterTile(ch) {
  return ch === T.WATER;
}
