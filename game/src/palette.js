// The look plan, in one place. EMBERLINE v2 keeps the freight-yard-at-dusk identity
// — cold slate steel against one warm amber accent, so the player's own team reads
// amber and the other team reads teal at a glance — but v2 turns the lights up: the
// round-1 yard was dark and flat on camera, so every surface colour here is a stop
// brighter and the sky is a lighter dusk blue. The same names are the CSS custom
// properties in index.html, and the map code reads them for site dressing too.
export const PALETTE = {
  canvas: '#181d26',
  surface: '#222831',
  hairline: '#3a4552',
  ink: '#f2eee2',
  muted: '#a8b4c0',
  accent: '#f5a52e',
  ember: '#f5a52e',
  slate: '#45c4b2',
  danger: '#e5484d',
  yardFloor: '#3a3f47',
  yardWall: '#46505c',
  containerA: '#a86f33',
  containerB: '#4d8a76',
  containerC: '#8a5a72',
  crate: '#6b5f4c',
  sky: '#2e4258',
  // Site dressing: A is the amber warehouse corner, B is the teal dock.
  warehouse: '#b5772e',
  dock: '#2f7d72',
  walkway: '#57606c',
  signInk: '#1a2233',
};

export function shade(name) {
  return PALETTE[name];
}
