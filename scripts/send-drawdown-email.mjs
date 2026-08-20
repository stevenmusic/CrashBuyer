#!/usr/bin/env node
// Mails the drawdown alerts to the newsletter's subscribers. Buttondown holds
// the addresses, the confirmation and the unsubscribe link, so none of that
// ever touches this repository — the workflow only hands it a subject and a
// body. Without BUTTONDOWN_API_KEY the step does nothing, which is what a fork
// of this repository should do.

import { readFile } from 'node:fs/promises';

const key = process.env.BUTTONDOWN_API_KEY;
if (!key) {
  console.log('[mail] no BUTTONDOWN_API_KEY; skipping');
  process.exit(0);
}

const headers = {
  Authorization: `Token ${key}`,
  'Content-Type': 'application/json',
  'X-API-Version': '2026-04-01',
};

/**
 * On a quiet day, spend one read-only request confirming the key still works.
 * The failure this guards against is a key that expired or was rotated months
 * ago and is only discovered on the day the market falls 20% — the one day it
 * had to work. Only an outright rejection fails the step; a network blip or a
 * moved endpoint is reported and let go, since neither means the key is bad.
 */
async function verifyKey() {
  let res;
  try {
    res = await fetch('https://api.buttondown.com/v1/subscribers?page=1', { headers });
  } catch (err) {
    console.warn(`[mail] could not reach Buttondown to check the key: ${err.message}`);
    return;
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`[mail] Buttondown rejected the API key (${res.status}). Alerts will not send.`);
    process.exitCode = 1;
    return;
  }
  if (!res.ok) {
    console.warn(`[mail] key check inconclusive (${res.status}); not treating that as a bad key`);
    return;
  }
  console.log('[mail] API key accepted');
}

const file = process.env.ALERT_OUTPUT;
let alerts;
try {
  alerts = JSON.parse(await readFile(file, 'utf8'));
} catch {
  console.log('[mail] no new band today');
  await verifyKey();
  process.exit(process.exitCode ?? 0);
}

const site = (process.env.SITE_URL || '').replace(/\/$/, '');

for (const a of alerts) {
  const depth = Math.abs(Number(a.drop)).toFixed(2);
  const subject = `${a.symbol} is ${depth}% below its peak`;
  const body = [
    `**${a.name}** closed at **${a.close}** on **${a.date}**.`,
    '',
    `- Peak to date: ${a.peak}`,
    `- Drawdown: **−${depth}%**`,
    `- Band crossed: **−${a.level}%**`,
    `- Allocation ladder: ${a.deepestRung ? `the −${a.deepestRung}% rung is armed` : 'no rung is armed yet'}`,
    '',
    site ? `[Open the simulator](${site})` : '',
    '',
    'Educational only — not investment advice.',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const res = await fetch('https://api.buttondown.com/v1/emails', {
    method: 'POST',
    headers: {
      ...headers,
      // Explicitly asking for about_to_send needs confirming once per key;
      // after the first accepted send it is ignored.
      'X-Buttondown-Live-Dangerously': 'true',
    },
    body: JSON.stringify({ subject, body, status: 'about_to_send' }),
  });

  if (!res.ok) {
    console.error(`[mail] ${res.status} for "${subject}": ${(await res.text()).slice(0, 200)}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`[mail] queued: ${subject}`);
}
