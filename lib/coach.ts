/**
 * Rule-based swing coach. Deterministic: the same numbers always produce the same tips.
 * Runs entirely in the browser on the KeyNumbers the pose analysis already computed.
 */
import type { KeyNumbers } from "./metrics";
import type { CameraAngle, CheckpointKey } from "./types";

export interface Drill {
  name: string;
  /** One-line purpose. */
  goal: string;
  steps: string[];
  dose: string;
}

export interface Evidence {
  label: string;
  you: string;
  /** Compare mode: the reference golfer's value. */
  pro?: string;
  /** Target window used by the rule. */
  target?: string;
}

export type Severity = "high" | "medium" | "low";

export interface CoachTip {
  id: string;
  title: string;
  severity: Severity;
  /** Ranking score: 1 = just over the threshold, 2 = twice as far over, … */
  score: number;
  observation: string;
  why: string;
  evidence: Evidence[];
  drills: Drill[];
  /** Checkpoint that shows the fault best (for a "Show me" jump). */
  checkpoint?: CheckpointKey;
}

export interface CoachInput {
  angle: CameraAngle;
  analyzed: boolean;
  you: KeyNumbers | null;
  youTempo: number | null;
  /** Present in compare mode once the reference video has been analyzed. */
  pro?: KeyNumbers | null;
  proTempo?: number | null;
  /** Which checkpoints are tagged on your video. */
  tagged: Partial<Record<CheckpointKey, boolean>>;
}

export interface CoachResult {
  tips: CoachTip[];
  /** Checks that ran and passed. */
  passed: string[];
  /** What's needed before more checks can run. */
  missing: string[];
}

export const MAX_TIPS = 3;

/** Thresholds, exported so the UI and tests can show / assert the same numbers. */
export const RULES = {
  spineLossDeg: 5,
  armVsProDeg: 8,
  /** Approximate lead-arm-above-horizontal band at the Top when no reference video is loaded. */
  armBand: [20, 45] as const,
  headSwayIn: 3,
  hipSlideIn: 4,
  /** Below this pelvis rotation (vs Address) a lateral shift counts as "without rotation". */
  hipTurnTopDeg: 30,
  hipTurnImpactDeg: 25,
  tempo: [2.7, 3.3] as const,
};

// ── Drill library ─────────────────────────────────────────────────────
const DRILLS = {
  wallButt: {
    name: "Wall Butt-Touch Drill",
    goal: "Keep your hips back so your spine angle survives into impact.",
    steps: [
      "Take your address with your backside lightly touching a wall (no club, arms crossed on your chest).",
      "Turn to the top: your trail glute should stay on the wall.",
      "Turn through to impact: your lead glute moves back to touch the wall as the trail one comes off.",
      "If both cheeks leave the wall, you've thrust your hips toward the ball.",
    ],
    dose: "3 sets of 10 slow rehearsals, then 5 half swings with a club.",
  },
  chair: {
    name: "Chair Hip-Depth Drill",
    goal: "Feel your pelvis stay at the same depth instead of moving toward the ball.",
    steps: [
      "Set a chair back just behind your hips at address so it barely touches you.",
      "Make half swings, keeping contact with the chair through the backswing.",
      "Into impact, rotate your lead hip back into the chair rather than moving away from it.",
      "Keep your chest over the ball: no standing up to make room for the arms.",
    ],
    dose: "20 half swings, then 10 full swings with a video check.",
  },
  headcover: {
    name: "Headcover Under Trail Arm",
    goal: "Keep the arms connected to the body turn so the club stays on plane.",
    steps: [
      "Tuck a headcover (or glove) under your trail armpit.",
      "Make three-quarter swings without letting it drop before impact.",
      "If it falls early in the backswing, your arms are lifting away from your turn (too steep).",
      "Let it drop only after impact as the arms extend.",
    ],
    dose: "3 sets of 10 three-quarter swings.",
  },
  pump: {
    name: "Pump Drill",
    goal: "Rehearse the transition so the club drops into the slot.",
    steps: [
      "Swing to the top and stop.",
      "Pump down until your lead arm is parallel to the ground, feeling the trail elbow work in front of the hip.",
      "Return to the top, pump again, then swing through on the third move.",
      "Check on video that the lead arm matches the reference plane at the top before each pump.",
    ],
    dose: "10 reps of pump-pump-swing.",
  },
  headShadow: {
    name: "Alignment Stick Head-Shadow Drill",
    goal: "Keep your head centered so your low point stays put.",
    steps: [
      "Push an alignment stick into the ground (or stand one on a bag) so it lines up with the side of your head at address. Indoors, use your head's shadow on the floor with the sun or a lamp behind you.",
      "Make slow swings: your head can rotate but shouldn't drift more than a ball's width off the stick (or shadow line).",
      "Hold the finish and check the gap before moving.",
    ],
    dose: "3 sets of 8 slow swings, then 5 at normal speed.",
  },
  stepBack: {
    name: "Trail-Foot Step-Back Drill",
    goal: "Turn into your trail hip instead of sliding off the ball.",
    steps: [
      "Set up with feet together, then step your trail foot back and out as you start the backswing.",
      "Feel your weight go into the inside of the trail heel while your pelvis turns, not sways.",
      "Swing through, finishing balanced on the lead foot.",
    ],
    dose: "15 step-back swings with a mid iron.",
  },
  barrel: {
    name: "Hip-Turn Barrel Drill",
    goal: "Rotate your pelvis inside a 'barrel' instead of sliding laterally.",
    steps: [
      "Place alignment sticks (or two chairs) just outside each hip.",
      "Turn back and through without your hips bumping either side of the 'barrel'.",
      "Lead with the belt buckle turning, not the hip sliding toward the target.",
    ],
    dose: "20 rehearsals, then 10 swings.",
  },
  metronome: {
    name: "1-2-3 Count Metronome Drill",
    goal: "Groove a repeatable ~3:1 backswing-to-downswing rhythm.",
    steps: [
      "Set a metronome app to about 70–80 bpm.",
      "Start the takeaway on beat 1, reach the top on beat 3 (\"one-two-three\").",
      "Strike on the next beat (\"four\"), so the downswing takes one beat to the backswing's three.",
      "Re-film and re-tag A / T / I to confirm the ratio moved toward 3:1.",
    ],
    dose: "3 sets of 10 swings, half speed to full speed.",
  },
} satisfies Record<string, Drill>;

// ── Helpers ───────────────────────────────────────────────────────────
const sgn = (n: number, d = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;
const degS = (n: number | null | undefined, signed = false) => (n == null ? "—" : `${signed ? sgn(n) : n.toFixed(1)}°`);
const inS = (n: number | null | undefined) => (n == null ? "—" : `${sgn(n)}″`);
const tempoS = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}:1`);
const severityOf = (score: number): Severity => (score >= 2 ? "high" : score >= 1.25 ? "medium" : "low");

/** Larger-magnitude of two optional numbers, keeping the sign. */
function worst(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.abs(a) >= Math.abs(b) ? a : b;
}

// ── Engine ────────────────────────────────────────────────────────────
export function coach(input: CoachInput): CoachResult {
  const tips: CoachTip[] = [];
  const passed: string[] = [];
  const missing: string[] = [];
  const y = input.you;
  const p = input.pro ?? null;
  const cmp = !!p;

  if (!input.analyzed || !y) {
    missing.push("Run Analyze Swing (AI) on your video.");
  } else if (!input.tagged.A) {
    missing.push("Tag Address (A), or use Auto-Detect Phases, so movement can be measured from setup.");
  }

  // ── DTL: Early extension (spine angle A → I) ──
  if (input.angle === "DTL" && y) {
    const loss = y.spineLossI;
    const proLoss = p?.spineLossI ?? null;
    if (loss === null) {
      if (input.tagged.A && !input.tagged.I) missing.push("Tag Impact (I) to check posture loss.");
    } else {
      const lostMoreThanPro = cmp && proLoss !== null && proLoss - loss > RULES.spineLossDeg;
      if (loss < -RULES.spineLossDeg || lostMoreThanPro) {
        const over = Math.max(-loss / RULES.spineLossDeg, lostMoreThanPro ? (proLoss! - loss) / RULES.spineLossDeg : 0);
        tips.push({
          id: "early-extension",
          title: "Early Extension / Posture Loss",
          severity: severityOf(over),
          score: over,
          checkpoint: "I",
          observation:
            `Your spine angle changes ${sgn(loss)}° from Address to Impact` +
            (loss < 0 ? ", meaning you stand up out of your posture as you come into the ball." : ".") +
            (cmp && proLoss !== null ? ` The reference changes ${sgn(proLoss)}°.` : ""),
          why: "When the hips move toward the ball and the chest rises, the arms lose room. That usually shows up as blocks, flips and thin or toe strikes.",
          evidence: [
            { label: "Spine @ Address", you: degS(y.spineA), pro: cmp ? degS(p!.spineA) : undefined },
            { label: "Spine @ Impact", you: degS(y.spineI), pro: cmp ? degS(p!.spineI) : undefined },
            { label: "Change A→I", you: degS(loss, true), pro: cmp ? degS(proLoss, true) : undefined, target: `within ±${RULES.spineLossDeg}°` },
          ],
          drills: [DRILLS.wallButt, DRILLS.chair],
        });
      } else passed.push(`Posture held: spine angle changed ${sgn(loss)}° from Address to Impact (within ${RULES.spineLossDeg}°).`);
    }
  }

  // ── DTL: Swing plane at the Top (lead arm vs reference) ──
  if (input.angle === "DTL" && y) {
    const arm = y.armT;
    const proArm = p?.armT ?? null;
    if (arm === null) {
      if (!input.tagged.T) missing.push("Tag Top (T) to check the swing plane.");
    } else {
      let diff: number | null = null; // + = steeper than reference
      let target: string;
      let refText: string;
      if (cmp && proArm !== null) {
        diff = arm - proArm;
        if (Math.abs(diff) <= RULES.armVsProDeg) diff = null;
        target = `within ±${RULES.armVsProDeg}° of the reference`;
        refText = `the reference golfer's ${proArm.toFixed(0)}°`;
      } else {
        const [lo, hi] = RULES.armBand;
        diff = arm > hi ? arm - hi : arm < lo ? arm - lo : null;
        target = `${lo}–${hi}° (typical, approximate)`;
        refText = `a typical ${lo}–${hi}° window`;
      }
      if (diff !== null) {
        const steep = diff > 0;
        const score = Math.abs(diff) / RULES.armVsProDeg + (cmp ? 1 : 0.5);
        tips.push({
          id: "swing-plane",
          title: `Swing Plane Deviation (${steep ? "steep" : "flat"})`,
          severity: cmp ? severityOf(score) : "low",
          score,
          checkpoint: "T",
          observation:
            `At the Top your lead arm sits ${arm.toFixed(0)}° above horizontal, ${Math.abs(diff).toFixed(0)}° ${steep ? "steeper (more upright)" : "flatter"} than ${refText}.` +
            (cmp ? "" : " Load a reference swing in Compare mode for a precise comparison."),
          why: steep
            ? "A steep, upright arm at the top tends to come over the top in transition: pulls, slices and divots that point left (for a right-hander)."
            : "A flat, laid-off arm tends to get stuck behind you: pushes, hooks and heavy contact.",
          evidence: [{ label: "Lead arm @ Top", you: degS(arm), pro: cmp ? degS(proArm) : undefined, target }],
          drills: steep ? [DRILLS.headcover, DRILLS.pump] : [DRILLS.pump, DRILLS.headcover],
        });
      } else passed.push(`Lead arm at the Top (${arm.toFixed(0)}°) is in line with ${refText}.`);
    }
  }

  // ── FO: Head sway ──
  if (input.angle === "FO" && y) {
    const h = worst(y.headT, y.headI);
    if (h === null) {
      if (input.tagged.A && !(input.tagged.T || input.tagged.I)) missing.push("Tag Top (T) and Impact (I) to check head movement.");
    } else if (Math.abs(h) > RULES.headSwayIn) {
      const score = Math.abs(h) / RULES.headSwayIn;
      const atTop = h === y.headT;
      const proH = p ? worst(p.headT, p.headI) : null;
      tips.push({
        id: "head-sway",
        title: "Upper Body Lateral Drift",
        severity: severityOf(score),
        score,
        checkpoint: atTop ? "T" : "I",
        observation:
          `Your head moves ${Math.abs(h).toFixed(1)}″ ${h < 0 ? "away from the target" : "toward the target"} by ${atTop ? "the Top" : "Impact"} (limit ${RULES.headSwayIn}″).` +
          (cmp && proH !== null ? ` The reference moves ${Math.abs(proH).toFixed(1)}″.` : ""),
        why: "When the head drifts, the bottom of the swing arc moves with it. Expect fat and thin shots and inconsistent strike.",
        evidence: [
          { label: "Head @ Top", you: inS(y.headT), pro: cmp ? inS(p!.headT) : undefined, target: `within ±${RULES.headSwayIn}″` },
          { label: "Head @ Impact", you: inS(y.headI), pro: cmp ? inS(p!.headI) : undefined, target: `within ±${RULES.headSwayIn}″` },
        ],
        drills: [DRILLS.headShadow],
      });
    } else passed.push(`Head stayed centered (max ${Math.abs(h).toFixed(1)}″ of lateral movement).`);
  }

  // ── FO: Hip sway / slide without rotation ──
  if (input.angle === "FO" && y) {
    const swayT = y.hipT !== null && y.hipT < -RULES.hipSlideIn ? y.hipT : null; // away from target at Top
    const slideI = y.hipI !== null && y.hipI > RULES.hipSlideIn ? y.hipI : null; // toward target at Impact
    const lowTurnT = y.hipTurnT === null || y.hipTurnT < RULES.hipTurnTopDeg;
    const lowTurnI = y.hipTurnI === null || y.hipTurnI < RULES.hipTurnImpactDeg;
    const flagT = swayT !== null && lowTurnT;
    const flagI = slideI !== null && lowTurnI;
    if (flagT || flagI) {
      const shift = flagT && flagI ? (Math.abs(swayT!) >= Math.abs(slideI!) ? swayT! : slideI!) : flagT ? swayT! : slideI!;
      const atTop = shift === swayT;
      const turn = atTop ? y.hipTurnT : y.hipTurnI;
      const score = Math.abs(shift) / RULES.hipSlideIn;
      tips.push({
        id: "hip-sway",
        title: "Excessive Hip Sway",
        severity: severityOf(score),
        score,
        checkpoint: atTop ? "T" : "I",
        observation:
          `Your pelvis shifts ${Math.abs(shift).toFixed(1)}″ ${atTop ? "away from the target by the Top" : "toward the target by Impact"}` +
          (turn !== null ? ` with only about ${turn.toFixed(0)}° of hip rotation.` : ", and hip rotation couldn't be measured on this video.") +
          (cmp && p ? ` The reference shifts ${inS(atTop ? p.hipT : p.hipI)}${(atTop ? p.hipTurnT : p.hipTurnI) !== null ? ` with ~${(atTop ? p.hipTurnT : p.hipTurnI)!.toFixed(0)}° of turn` : ""}.` : ""),
        why: "Sliding instead of turning moves your low point and forces the hands to time the strike, so you lose both power and consistency.",
        evidence: [
          { label: "Hip shift @ Top", you: inS(y.hipT), pro: cmp ? inS(p!.hipT) : undefined, target: `≥ −${RULES.hipSlideIn}″ unless rotating` },
          { label: "Hip shift @ Impact", you: inS(y.hipI), pro: cmp ? inS(p!.hipI) : undefined, target: `≤ +${RULES.hipSlideIn}″ unless rotating` },
          { label: `Hip turn @ ${atTop ? "Top" : "Impact"} (est.)`, you: degS(turn), pro: cmp ? degS(atTop ? p!.hipTurnT : p!.hipTurnI) : undefined, target: `≥ ${atTop ? RULES.hipTurnTopDeg : RULES.hipTurnImpactDeg}°` },
        ],
        drills: atTop ? [DRILLS.stepBack, DRILLS.barrel] : [DRILLS.barrel, DRILLS.stepBack],
      });
    } else if (y.hipT !== null || y.hipI !== null) {
      passed.push("Hips turned rather than slid (no lateral shift over 4″ without rotation).");
    } else if (input.tagged.A && !(input.tagged.T || input.tagged.I)) {
      missing.push("Tag Top (T) and Impact (I) to check hip sway.");
    }
  }

  // ── Tempo (either angle) ──
  const t = input.youTempo;
  if (t === null) {
    if (!(input.tagged.A && input.tagged.T && input.tagged.I)) missing.push("Tag A, T and I to measure tempo.");
  } else {
    const [lo, hi] = RULES.tempo;
    if (t < lo || t > hi) {
      const rushed = t < lo;
      const score = (rushed ? lo - t : t - hi) / 0.3;
      tips.push({
        id: "tempo",
        title: rushed ? "Rushed Transition" : "Slow Backswing",
        severity: severityOf(score),
        score,
        checkpoint: "T",
        observation: rushed
          ? `Your tempo is ${t.toFixed(1)}:1. The backswing is short relative to the downswing, which usually means you're hurrying from the top.`
          : `Your tempo is ${t.toFixed(1)}:1. The backswing takes much longer than the downswing, which can leave the transition jerky or decelerating.`,
        why: "Most good players sit near 3:1 regardless of overall speed. A consistent ratio makes sequencing and timing repeatable.",
        evidence: [
          { label: "Tempo (back : down)", you: tempoS(t), pro: cmp ? tempoS(input.proTempo) : undefined, target: `${lo}–${hi} : 1` },
        ],
        drills: [DRILLS.metronome],
      });
    } else passed.push(`Tempo ${t.toFixed(1)}:1 is in the 2.7–3.3 : 1 window.`);
  }

  // Severity first (so an approximate single-video plane check never outranks a measured fault), then score.
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  tips.sort((a, b) => rank[a.severity] - rank[b.severity] || b.score - a.score);
  return { tips: tips.slice(0, MAX_TIPS), passed, missing: [...new Set(missing)] };
}
