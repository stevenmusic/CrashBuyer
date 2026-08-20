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
/** Past alerts, so the feed can be rebuilt whole on every run. */
const LOG_FILE = resolve(DATA_DIR, 'alerts-log.json');
const FEED_FILE = resolve(ROOT, 'alerts.xml');
/** How many past alerts the feed carries. */
const FEED_LIMIT = 50;

/** Bands are this many percent apart. */
const STEP = Number(process.env.ALERT_STEP) || 10;

/** Ladder rungs, kept in step with assets/model.js so the issue can say which
 *  one today's fall just armed. */
const LADDER = [10, 15, 20, 25, 30, 40, 50];

const band = (dropPct) => Math.floor(Math.max(0, -dropPct) / STEP) * STEP;

/** Where the page is published, for the links inside the feed. */
const SITE = (process.env.SITE_URL || 'https://stevenmusic.github.io/CrashBuyer').replace(/\/$/, '');

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/**
 * An Atom feed of past alerts. A static site cannot send mail — that needs an
 * address list, a sending service and an unsubscribe path — but anyone can
 * point a reader at this, and the readers that deliver by mail handle the
 * consent and the unsubscribing themselves.
 */
function buildFeed(entries) {
  const updated = entries[0]?.at ?? new Date().toISOString();
  const items = entries
    .map((a) => {
      const depth = Math.abs(Number(a.drop)).toFixed(2);
      const title = `${a.symbol} crossed \u2212${a.level}% \u2014 now ${depth}% below its peak`;
      const summary =
        `${a.name} closed at ${a.close} on ${a.date}. Peak to date ${a.peak}, ` +
        `drawdown \u2212${depth}%. ` +
        (a.deepestRung ? `The \u2212${a.deepestRung}% rung of the ladder is armed.` : 'No rung is armed yet.');
      return `  <entry>
    <title>${escape(title)}</title>
    <id>tag:crashbuyer,${a.date}:${a.id}-${a.level}</id>
    <updated>${escape(a.at)}</updated>
    <link href="${escape(SITE)}"/>
    <summary>${escape(summary)}</summary>
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CrashBuyer drawdown alerts</title>
  <subtitle>Published when the market crosses a new drawdown band.</subtitle>
  <id>${escape(SITE)}/alerts.xml</id>
  <link href="${escape(SITE)}/alerts.xml" rel="self"/>
  <link href="${escape(SITE)}"/>
  <updated>${escape(updated)}</updated>
${items}
</feed>
`;
}

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

// The feed is rebuilt every run, not only when something crossed, so a fresh
// checkout always produces the same file as the last one did.
const log = (await readJson(LOG_FILE, null)) ?? [];
for (const a of alerts) log.unshift({ ...a, at: new Date().toISOString() });
const trimmed = log.slice(0, FEED_LIMIT);
await writeFile(LOG_FILE, JSON.stringify(trimmed, null, 2) + '\n');
await writeFile(FEED_FILE, buildFeed(trimmed));

if (!alerts.length) {
  console.log('[alert] no new band crossed');
  process.exit(0);
}

// The workflow reads this file and opens one issue per alert. It is written
// outside the repository by default so a run never leaves it to be committed.
const out = process.env.ALERT_OUTPUT || resolve(ROOT, 'alerts.json');
await writeFile(out, JSON.stringify(alerts, null, 2) + '\n');
console.log(`[alert] ${alerts.length} new band(s): ` + alerts.map((a) => `${a.symbol} −${a.level}%`).join(', '));
