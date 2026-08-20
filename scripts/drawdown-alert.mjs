#!/usr/bin/env node
// Decides whether today's close crossed into a new drawdown band, and prints
// the alerts for the workflow to turn into issues. State lives in a committed
// file so a band is announced once, not every weekday it stays underwater.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, 'data');
const STATE_FILE = resolve(ROOT, '.github/alert-state.json');

/** Bands are this many percent apart. */
const STEP = Number(process.env.ALERT_STEP) || 10;

/** Ladder rungs, kept in step with assets/model.js so the issue can say which
 *  one today's fall just armed. */
const LADDER = [10, 15, 20, 25, 30, 40, 50];

const band = (dropPct) => Math.floor(Math.max(0, -dropPct) / STEP) * STEP;

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const manifest = await readJson(resolve(DATA_DIR, 'instruments.json'));
if (!manifest) {
  console.error('[alert] no manifest; nothing to check');
  process.exit(0);
}

// Which series to watch. SPY, VOO and IVV track the same index, so watching all
// of them would send three of every email; the picker's default is the one the
// page opens on.
const watch = (process.env.ALERT_INSTRUMENTS || manifest.default)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const state = (await readJson(STATE_FILE, null)) ?? { seeded: false, bands: {} };
const alerts = [];

for (const id of watch) {
  const series = await readJson(resolve(DATA_DIR, `${id}.json`));
  if (!series?.closes?.length) {
    console.error(`[alert] ${id}: no series`);
    continue;
  }

  const close = series.closes.at(-1);
  const date = series.dates.at(-1);
  const peak = Math.max(...series.closes);
  const drop = (close / peak - 1) * 100;
  const level = band(drop);
  const previous = state.bands[id] ?? 0;

  console.log(
    `[alert] ${id.padEnd(6)} ${date} close=${close} peak=${peak} ` +
      `drawdown=${drop.toFixed(2)}% band=${level} previous=${previous}`
  );

  // Back at the peak clears the ladder, exactly as the page does it: a bounce
  // that is still underwater must not re-announce the band it just left.
  if (drop >= 0) {
    state.bands[id] = 0;
    continue;
  }
  if (level <= previous) continue;

  state.bands[id] = level;
  if (!state.seeded) continue; // First run records where things stand, silently.

  const armed = LADDER.filter((rung) => -drop >= rung);
  alerts.push({
    id,
    symbol: series.symbol ?? id.toUpperCase(),
    name: series.name ?? id,
    date,
    close,
    peak,
    drop: drop.toFixed(2),
    level,
    deepestRung: armed.length ? armed[armed.length - 1] : null,
  });
}

state.seeded = true;
await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');

if (!alerts.length) {
  console.log('[alert] no new band crossed');
  process.exit(0);
}

// The workflow reads this file and opens one issue per alert. It is written
// outside the repository by default so a run never leaves it to be committed.
const out = process.env.ALERT_OUTPUT || resolve(ROOT, 'alerts.json');
await writeFile(out, JSON.stringify(alerts, null, 2) + '\n');
console.log(`[alert] ${alerts.length} new band(s): ` + alerts.map((a) => `${a.symbol} −${a.level}%`).join(', '));
