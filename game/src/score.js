// SHADOW DOCK — scoring: the reconciled thousand-scale rule set.
// Undetected +10/s (meter = 0); loot 3 items (+500/+750/+1000);
// time bonus MAX(0, 300-seconds)*20; no-detection +5000 (binary, lost
// the moment the meter exceeds 0); gadget +200 per effective noise bolt
// (max 3); clean multiplier x1.5 (no detection + all loot + time < 150s)
// applied to (undetected + time + loot + gadget).
// Grades: S >= 12500 | A >= 10000 | B >= 7500 | C < 7500.
export const GRADE_CUTS = { S: 12500, A: 10000, B: 7500 };

export function gradeFor(total) {
  if (total >= GRADE_CUTS.S) return 'S';
  if (total >= GRADE_CUTS.A) return 'A';
  if (total >= GRADE_CUTS.B) return 'B';
  return 'C';
}

// The live score state, kept on the world (world.score).
export function newScoreState() {
  return {
    undetectedSec: 0, // seconds the meter sat at exactly 0
    lootPoints: 0,
    lootCollected: [], // names of the loot taken
    gadgetPoints: 0,
    gadgetCount: 0, // effective bolts so far (max 3)
    noDetection: true, // false the moment the meter exceeds 0
  };
}

// The 6-row win breakdown + total + grade, computed (never hardcoded).
// s is the live score state; seconds is the run time in seconds;
// allLoot is true when every loot item was taken.
export function computeBreakdown(s, seconds, allLoot) {
  const stealth = Math.round(s.undetectedSec) * 10;
  const timeBonus = Math.max(0, 300 - Math.floor(seconds)) * 20;
  const loot = s.lootPoints;
  const gadget = s.gadgetPoints;
  const subtotal = stealth + timeBonus + loot + gadget;
  const clean = s.noDetection && allLoot && seconds < 150;
  const multiplier = clean ? 1.5 : 1.0;
  const total = Math.round(subtotal * multiplier) + (s.noDetection ? 5000 : 0);
  return {
    rows: [
      ['Time Bonus', timeBonus],
      ['Stealth Bonus', stealth],
      ['Loot Collected', loot],
      ['Gadget Efficiency', gadget],
      ['Clean Run Multiplier', clean ? 'x1.5' : 'x1.0'],
    ],
    total,
    grade: gradeFor(total),
    clean,
  };
}

export function formatScore(n) {
  return 'SCORE ' + String(Math.max(0, Math.floor(n))).padStart(6, '0');
}

// The live HUD score: what the player has earned so far (undetected +
// loot + gadget). The time bonus and the no-detection bonus are win-time
// bonuses, so they only appear in the win breakdown — the HUD score only
// ever goes up, which reads naturally while playing.
export function liveScore(s) {
  const stealth = Math.round(s.undetectedSec) * 10;
  return stealth + s.lootPoints + s.gadgetPoints;
}
