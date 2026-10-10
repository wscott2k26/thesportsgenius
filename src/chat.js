// Ask the Genius: OpenAI-backed sports chat with live data injected into the
// system prompt, plus a rule-based fallback that answers strictly from real
// ESPN data when no API key is configured. The fallback NEVER invents stats.
import { db, todayET } from './db.js';
import { getScoreboard, getStandings, getTeams, LEAGUE_KEYS, LEAGUES } from './providers/espn.js';
import { getPicks } from './picks.js';

export const FREE_CHATS_PER_DAY = 5;

function userKey(user) { return `key:${user.openai_key}`; }

export function openaiKeyFor(user) {
  if (user && user.openai_key) return user.openai_key;
  return process.env.OPENAI_API_KEY || '';
}

export function chatQuota(user, ip) {
  const who = user ? `u:${user.id}` : `ip:${ip}`;
  const day = todayET();
  const row = db.prepare('SELECT count FROM chat_usage WHERE day = ? AND who = ?').get(day, who);
  const used = row ? row.count : 0;
  const premium = !!(user && user.premium_until && new Date(user.premium_until) > new Date());
  return { used, limit: premium ? Infinity : FREE_CHATS_PER_DAY, premium, who, day };
}

export function recordChat(who, day) {
  db.prepare(`INSERT INTO chat_usage (day, who, count) VALUES (?, ?, 1)
    ON CONFLICT(day, who) DO UPDATE SET count = count + 1`).run(day, who);
}

async function liveContext() {
  const parts = [];
  try {
    const picks = await getPicks();
    if (picks.length) {
      parts.push(`TODAY'S GENIUS PICKS (moneyline, heuristic model):\n` +
        picks.map(p => `- ${p.away} @ ${p.home} [${p.league.toUpperCase()}]: pick ${p.pickTeam.abbr} ${p.confidence}% — ${p.reasoning}`).join('\n'));
    }
  } catch { /* picks optional */ }
  await Promise.all(LEAGUE_KEYS.map(async (lg) => {
    try {
      const { events } = await getScoreboard(lg);
      const today = todayET();
      const todays = events.filter(e => todayET(new Date(e.date)) === today);
      const live = todays.filter(e => e.status.state === 'in');
      const upcoming = todays.filter(e => e.status.state === 'pre');
      const done = todays.filter(e => e.status.state === 'post');
      const line = (e) => `${e.away.abbr} @ ${e.home.abbr} ${e.away.score ?? ''}-${e.home.score ?? ''} (${e.status.shortDetail || e.status.detail})`;
      let s = `\n${LEAGUES[lg].label.toUpperCase()} TODAY (${today}):\n`;
      if (live.length) s += 'LIVE:\n' + live.map(l => '- ' + line(l)).join('\n') + '\n';
      if (upcoming.length) s += 'UPCOMING:\n' + upcoming.map(u => `- ${u.away.abbr} @ ${u.home.abbr} ${u.status.shortDetail || ''}`).join('\n') + '\n';
      if (done.length) s += 'FINAL:\n' + done.slice(0, 6).map(d => '- ' + line(d)).join('\n') + '\n';
      parts.push(s);
    } catch { /* skip league on failure */ }
    try {
      const st = await getStandings(lg);
      for (const g of (st.groups || []).slice(0, 2)) {
        parts.push(`${LEAGUES[lg].label} standings (${g.name}): ` +
          g.rows.slice(0, 5).map(r => `${r.abbr} ${r.wins}-${r.losses}`).join(', '));
      }
    } catch { /* optional */ }
  }));
  return parts.join('\n');
}

const SYSTEM_TMPL = `You are The Sports Genius, a sharp, fun sports analyst on thesportsgenius.com.
RULES:
- Only use stats from the LIVE DATA below, or general knowledge clearly older than it. If the live data doesn't include a stat, say you don't have it — NEVER invent records, scores, streaks, injuries, or odds.
- Predictions are entertainment only. Never present a pick as financial advice; add "For entertainment. Not gambling advice." when giving a pick.
- Keep answers under 120 words, conversational, no fluff.`;

export async function aiReply(message, user, fetchFn = fetch) {
  const key = openaiKeyFor(user);
  if (!key) return null;
  const context = await liveContext();
  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `${SYSTEM_TMPL}\n\nLIVE DATA (today ${todayET()}):\n${context}` },
        { role: 'user', content: message.slice(0, 1000) },
      ],
      max_tokens: 300, temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const d = await res.json();
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
}

// ---------------- rule-based fallback (no key) ----------------
// Matches team names/abbreviations in the message against the real teams
// list, then answers with real records, standings, today's game, and today's
// pick. Prefixed with "Here's what the data says:". Never fabricates.
async function allTeams() {
  const out = [];
  for (const lg of LEAGUE_KEYS) {
    try { const { teams } = await getTeams(lg); for (const t of teams) out.push({ ...t, league: lg }); }
    catch { /* skip */ }
  }
  return out;
}

function findTeamsInMessage(msg, teams) {
  const low = ` ${msg.toLowerCase()} `;
  const hits = [];
  for (const t of teams) {
    const abbr = (t.abbr || '').toLowerCase();
    const name = (t.name || '').toLowerCase();
    if (!abbr || !name) continue;
    const words = name.split(' ');
    const cityOnly = words.slice(0, -1).join(' ');
    const nickname = words.slice(-1)[0];
    if (low.includes(` ${abbr} `) || low.includes(name) ||
        (cityOnly && cityOnly.length > 3 && low.includes(cityOnly)) ||
        (nickname && nickname.length > 3 && low.includes(` ${nickname} `))) {
      hits.push(t);
    }
  }
  // prefer exact abbreviation matches first
  hits.sort((a, b) => {
    const am = low.includes(` ${a.abbr.toLowerCase()} `) ? 0 : 1;
    const bm = low.includes(` ${b.abbr.toLowerCase()} `) ? 0 : 1;
    return am - bm;
  });
  return [...new Map(hits.map(h => [h.key, h])).values()].slice(0, 2);
}

export async function fallbackReply(message, { fetchFn = fetch } = {}) {
  const teams = await allTeams();
  const hits = findTeamsInMessage(message, teams);
  if (!hits.length) {
    return { mode: 'fallback', reply: `Here's what the data says: I didn't spot a team in that. Ask me about a team by name or abbreviation (e.g. "How are the Chiefs doing?", "Lakers vs Celtics tonight?") and I'll pull their real record, standings, today's game, and the Genius pick — across NFL, NBA, MLB, NHL, and college football.` };
  }
  const chunks = [];
  const picks = await getPicks().catch(() => []);
  for (const t of hits) {
    const bits = [];
    bits.push(`${t.name} (${t.abbr}, ${LEAGUES[t.league].label})`);
    try {
      const st = await getStandings(t.league, { fetchFn });
      const row = (st.groups || []).flatMap(g => g.rows.map(r => ({ ...r, group: g.name }))).find(r => r.abbr === t.abbr);
      if (row) bits.push(`record ${row.wins}-${row.losses}${row.extra ? `, streak ${row.extra}` : ''} — ${row.group}`);
    } catch { /* optional */ }
    try {
      const { events } = await getScoreboard(t.league, { fetchFn });
      const today = todayET();
      const game = events.find(e => todayET(new Date(e.date)) === today &&
        (e.home.abbr === t.abbr || e.away.abbr === t.abbr));
      if (game) {
        const opp = game.home.abbr === t.abbr ? game.away : game.home;
        if (game.status.state === 'pre') bits.push(`plays ${opp.name} today (${game.status.shortDetail || 'time TBD'})`);
        else if (game.status.state === 'in') bits.push(`LIVE vs ${opp.name}: ${game.away.abbr} ${game.away.score}–${game.home.abbr} ${game.home.score} (${game.status.shortDetail})`);
        else bits.push(`last game vs ${opp.name}: ${game.away.abbr} ${game.away.score}–${game.home.abbr} ${game.home.score} (Final)`);
        const pick = picks.find(p => String(p.event_id) === String(game.id));
        if (pick) bits.push(`Genius pick: ${pick.pickTeam.abbr} at ${pick.confidence}% confidence`);
      } else {
        bits.push('no game on the schedule today');
      }
    } catch { /* optional */ }
    chunks.push(bits.filter(Boolean).join(' — '));
  }
  return { mode: 'fallback', reply: `Here's what the data says:\n\n${chunks.join('\n\n')}\n\nFor entertainment. Not gambling advice.` };
}

export async function handleChat(message, user, ip) {
  const quota = chatQuota(user, ip);
  if (quota.used >= quota.limit) {
    return { error: 'limit', reply: `You've used your ${FREE_CHATS_PER_DAY} free Genius chats for today. Go Premium for unlimited chat.`, ...quota };
  }
  const key = openaiKeyFor(user);
  let out;
  try {
    if (key) {
      const reply = await aiReply(message, user);
      out = { mode: 'ai', reply };
    } else {
      out = await fallbackReply(message);
    }
  } catch (e) {
    out = await fallbackReply(message).catch(() => ({ mode: 'fallback', reply: `Here's what the data says: the AI is unavailable right now and I couldn't reach live data. Try again in a minute.` }));
  }
  if (out && !out.error) recordChat(quota.who, quota.day);
  return { ...out, ...quota };
}
