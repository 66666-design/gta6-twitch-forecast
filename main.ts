// gta6-twitch-ccu-forecast-01 entry (Node 22, standard library only).
//
// Forecast: for each hour h = 2..24 of the release day, five quantiles of the
// Twitch concurrent-viewer count in the game's category, given everything up to
// the end of hour 1 (hour 1's print included).
//
// Model — practice-calibrated comparable-shape forecast:
//   q_tau(h) = p1 * m_h * exp(z_tau * s_h)
//   m_h = comp_h^0.2 * prac_h^0.8        (log-space blend of two shape curves)
//   s_h = 0.2 * csd_h + 0.8 * rsd_h      (hour-dependent log spread)
//   p1  = hour 1's print (below 1 counts as 1)
//   comp_h, csd_h: median hourly ratio-to-hour-1 curve and robust log-ratio
//     spread (half the interquartile range) across the usable comparables in
//     THIS case file — computed at run time, so the final's 42 comparables
//     (the 4 practice launches join) stabilise them automatically.
//   prac_h, rsd_h: baked constants, measured on the 4 practice launches
//     (Wolverine 2026-09-15, RDR2 2018-10-26, God of War Ragnarok 2022-11-09,
//     Spider-Man 2 2023-10-20) against SullyGnome's hourly averages:
//     prac_h = median over the 4 launches of viewers_h / viewers_1;
//     rsd_h  = per-hour std across the 4 launches of ln(true ratio) - ln(m_h),
//     smoothed with a 5-hour moving window.
//   Launch days dip in hours 2-4 (late-night Europe, US not yet unlocked) and
//   peak in US afternoon/evening (hours 14-22 UTC); the shape captures that,
//   the spread widens into the peak hours.
//
// Calibration (pinball loss on the log scale, scored against the SullyGnome
// hourly averages of the 4 practice launches; the scorer reproduces the
// house baseline's published practice numbers exactly, 0.387097):
//   this model:  0.227474 mean (p00 0.390, p01 0.129, p02 0.199, p03 0.192)
//   house baseline: 0.387097 mean (p00 0.744, p01 0.287, p02 0.215, p03 0.303)
//   Leave-one-out calibration (calibrate on 3 launches, score the 4th)
//   averages 0.341, still below the baseline. Weights (w=0.2, lam_c=0.2,
//   lam_p=0.8) are the robust choice from the grid, not the argmin.
//
// Safety: any failure (too few usable comparables, bad numbers, any
// exception) falls back to the house baseline formula for that case, so the
// output is always valid — an invalid case scores as a flat hour-1 print
// and takes no prize.
//
// Runs offline, no network, deterministic (sorted inputs, fixed constants,
// no randomness). Each case is fast (well under the 8 s cap).
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level (precise). */
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
/** The house baseline's rounded z values (fallback only). */
const Z_BASE = [-1.645, -0.674, 0, 0.674, 1.645];
/** The house baseline's spread, in log units per square-root hour. */
const SIGMA_BASE = 0.15;
/** Blend weight on the comparable shape (1 - W on the practice shape). */
const W = 0.2;
/** Spread weights: comparable dispersion vs practice-residual dispersion. */
const LAM_C = 0.2;
const LAM_P = 0.8;
/** Minimum usable comparables for the shape model; fewer falls back. */
const MIN_COMPARABLES = 5;

/**
 * Practice median ratio curve prac_h, hours 2..24: median over the 4 practice
 * launches of viewers_h / viewers_1 (SullyGnome hourly averages).
 */
const PRAC_H: number[] = [
  0.824826, 0.701465, 0.62515, 1.351785, 1.372841, 1.226468, 1.116773, 0.969993,
  0.870414, 0.865467, 0.875878, 1.041631, 1.26326, 1.545781, 1.824349, 2.15889,
  2.532363, 2.437544, 2.257898, 2.292877, 2.213334, 2.023356, 1.734711,
];
/**
 * Smoothed practice-residual log spread rsd_h, hours 2..24: per-hour std across
 * the 4 practice launches of ln(true ratio) - ln(m_h), 5-hour moving window.
 */
const RSD_H: number[] = [
  0.217454, 0.260171, 0.246755, 0.265782, 0.238112, 0.251552, 0.232698, 0.268852,
  0.351548, 0.420629, 0.452744, 0.490926, 0.511154, 0.503217, 0.528062, 0.548004,
  0.580594, 0.617357, 0.630051, 0.617167, 0.620669, 0.61386, 0.598874,
];

interface Comparable {
  name: string;
  day_start: string;
  hourly: Array<{ from: string; viewers: number }>;
}

interface Case {
  levels: number[];
  game: { name: string };
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up), clamped to the output's legal range. */
const round2 = (x: number): number => {
  const v = Math.round(x * 100) / 100;
  if (!Number.isFinite(v) || v <= 0) return 0.01;
  if (v > 1e9) return 1e9;
  return v;
};

/** Linear-interpolated q-quantile of a sorted list. */
const quantile = (sorted: number[], q: number): number => {
  const n = sorted.length;
  if (n === 0) throw new Error('quantile of an empty list');
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * {name: {hour: viewers}} for hours 1..24 of each comparable's launch day.
 * A comparable counts only with all 24 hours present and a positive hour-1
 * print; the case game's own pre-release history (same name, no launch-day
 * curve) is excluded outright.
 */
const launchDayCurves = (c: Case): Map<string, Map<number, number>> => {
  const curves = new Map<string, Map<number, number>>();
  for (const comp of c.comparables ?? []) {
    if (comp.name === c.game.name) continue;
    const dayStart = Date.parse(comp.day_start);
    if (!Number.isFinite(dayStart)) continue;
    const have = new Map<number, number>();
    for (const pt of comp.hourly ?? []) {
      const t = Date.parse(pt.from);
      if (!Number.isFinite(t)) continue;
      const dh = (t - dayStart) / 3600000;
      if (dh >= 1 && dh <= 24 && dh === Math.floor(dh)) have.set(dh, pt.viewers);
    }
    if (have.size === 24 && (have.get(1) ?? 0) > 0) curves.set(comp.name, have);
  }
  return curves;
};

/** Median ratio curve and robust log-ratio spread per hour, hours 1..24. */
const buildShape = (curves: Map<string, Map<number, number>>): { med: number[]; spr: number[] } => {
  const names = [...curves.keys()];
  const med: number[] = [];
  const spr: number[] = [];
  for (let h = 1; h <= 24; h++) {
    const ratios = names.map((n) => curves.get(n)!.get(h)! / curves.get(n)!.get(1)!).sort((a, b) => a - b);
    const logs = names.map((n) => Math.log(Math.max(curves.get(n)!.get(h)!, 1e-9) / curves.get(n)!.get(1)!)).sort((a, b) => a - b);
    med.push(quantile(ratios, 0.5));
    spr.push(Math.max(quantile(logs, 0.75) - quantile(logs, 0.25), 0) / 2);
  }
  return { med, spr };
};

/** The shape-model quantiles for one hour h (2..24). */
const modelQuantiles = (p1: number, med: number[], spr: number[], h: number): number[] => {
  const compH = med[h - 1];
  const pracH = PRAC_H[h - 2];
  const m = Math.exp(W * Math.log(compH) + (1 - W) * Math.log(pracH));
  const s = LAM_C * spr[h - 1] + LAM_P * RSD_H[h - 2];
  if (!Number.isFinite(m) || !Number.isFinite(s) || m <= 0 || s < 0) throw new Error(`bad shape at hour ${h}`);
  return Z.map((z) => round2(p1 * m * Math.exp(z * s)));
};

/** The house baseline quantiles for one hour h (fallback). */
const baselineQuantiles = (p1: number, h: number): number[] =>
  Z_BASE.map((z) => round2(p1 * Math.exp(z * SIGMA_BASE * Math.sqrt(h - 1))));

/** Forecast one case; any failure falls back to the baseline for the case. */
const forecastCase = (c: Case): Array<{ hour: number; q: number[] }> => {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);
  try {
    const curves = launchDayCurves(c);
    if (curves.size < MIN_COMPARABLES) throw new Error(`only ${curves.size} usable comparables`);
    const { med, spr } = buildShape(curves);
    return c.forecast.map(({ hour }) => ({ hour, q: modelQuantiles(p1, med, spr, hour) }));
  } catch {
    return c.forecast.map(({ hour }) => ({ hour, q: baselineQuantiles(p1, hour) }));
  }
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
