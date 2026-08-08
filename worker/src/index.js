const ORIGIN = 'https://patricspence.github.io';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/analytics/api/summary') return summary(url, env);
    if (url.pathname.startsWith('/analytics/')) return fetch(new URL(url.pathname + url.search, ORIGIN));

    const response = await fetch(new URL(url.pathname + url.search, ORIGIN), request);
    const type = response.headers.get('content-type') || '';
    if (request.method === 'GET' && type.includes('text/html')) ctx.waitUntil(record(request, env));
    return response;
  }
};

async function record(request, env) {
  const url = new URL(request.url);
  const cf = request.cf || {};
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const day = new Date().toISOString().slice(0, 10);
  const visitor = await hash(`${env.IP_HASH_SALT}:${day}:${ip}`);
  const referer = request.headers.get('Referer');
  let referrer = '';
  try { referrer = new URL(referer).hostname; } catch (_) {}
  const agent = request.headers.get('User-Agent') || '';
  const browser = /bot|crawler|spider/i.test(agent) ? 'Bot' : /mobile|android|iphone|ipad/i.test(agent) ? 'Mobile' : 'Desktop';
  await env.ANALYTICS.prepare('INSERT INTO events (seen_at, visitor_hash, page_path, referrer_host, country, browser_type) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(new Date().toISOString(), visitor, url.pathname, referrer, cf.country || '', browser).run();
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function summary(url, env) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return json({error:'Use YYYY-MM-DD dates'}, 400);
  const start = from + 'T00:00:00.000Z', end = to + 'T23:59:59.999Z';
  const bind = q => env.ANALYTICS.prepare(q).bind(start, end);
  const [totals, referrers, pages, countries, browsers] = await Promise.all([
    bind('SELECT COUNT(*) views, COUNT(DISTINCT visitor_hash) visitors, COUNT(DISTINCT country) countries FROM events WHERE seen_at BETWEEN ? AND ?').first(),
    bind("SELECT COALESCE(NULLIF(referrer_host,''),'Direct / unknown') label, COUNT(*) count FROM events WHERE seen_at BETWEEN ? AND ? GROUP BY label ORDER BY count DESC LIMIT 15").all(),
    bind('SELECT page_path label, COUNT(*) count FROM events WHERE seen_at BETWEEN ? AND ? GROUP BY page_path ORDER BY count DESC LIMIT 15').all(),
    bind("SELECT COALESCE(NULLIF(country,''),'Unknown') label, COUNT(*) count FROM events WHERE seen_at BETWEEN ? AND ? GROUP BY label ORDER BY count DESC LIMIT 15").all(),
    bind('SELECT browser_type label, COUNT(*) count FROM events WHERE seen_at BETWEEN ? AND ? GROUP BY label ORDER BY count DESC').all()
  ]);
  return json({totals, referrers:referrers.results, pages:pages.results, countries:countries.results, browsers:browsers.results});
}

function json(data, status=200) { return new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json','cache-control':'no-store'}}); }
