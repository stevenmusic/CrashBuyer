#!/usr/bin/env node
// Turns the alert list into GitHub issues. Issues are the delivery mechanism:
// GitHub emails the repository's watchers, so the notification reaches a phone
// with the page closed and no push service in between.

import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const file = process.env.ALERT_OUTPUT;
if (!file) {
  console.error('[issues] ALERT_OUTPUT is not set');
  process.exit(1);
}

let alerts;
try {
  alerts = JSON.parse(await readFile(file, 'utf8'));
} catch {
  console.log('[issues] no new band today');
  process.exit(0);
}

// Lets the workflow be rehearsed without filing anything.
const dryRun = process.env.DRY_RUN === '1';
const gh = process.env.GH_BIN || 'gh';

for (const a of alerts) {
  // `drop` is signed; "−22% below its peak" would read as 22% above it.
  const depth = Math.abs(Number(a.drop)).toFixed(2);
  const title = `${a.symbol} crossed −${a.level}% — now ${depth}% below its peak`;
  const body = [
    `**${a.name}** closed at **${a.close}** on **${a.date}**.`,
    '',
    `- Peak to date: ${a.peak}`,
    `- Drawdown: **−${depth}%**`,
    `- Band crossed: **−${a.level}%**`,
    `- Allocation ladder: ${a.deepestRung ? `the −${a.deepestRung}% rung is armed` : 'no rung is armed yet'}`,
    '',
    'Opened automatically by the daily data refresh. Close it once you have looked.',
  ].join('\n');

  if (dryRun) {
    console.log(`[issues] would open: ${title}`);
    console.log(body.replace(/^/gm, '    '));
    continue;
  }

  // Assigning it is what actually guarantees delivery: an assignment notifies
  // regardless of how the repository is watched, where a plain new issue only
  // reaches people subscribed to it.
  const args = ['issue', 'create', '--title', title, '--body', body];
  if (process.env.ALERT_ASSIGNEE) args.push('--assignee', process.env.ALERT_ASSIGNEE);

  try {
    execFileSync(gh, args, { stdio: 'inherit' });
  } catch (err) {
    console.error(`[issues] could not open "${title}": ${err.message}`);
    process.exitCode = 1;
  }
}
