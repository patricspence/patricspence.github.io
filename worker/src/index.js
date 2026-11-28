const ORIGIN = 'https://patricspence.github.io';
const TRACKER_PATH = '/analytics/tracker.js';
const EVENT_TYPES = ['visit', 'navigation', 'exit', 'outbound', 'download'];
const BOT_PATTERN = /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|pingdom|uptimerobot|ahrefs|semrush|mj12bot|dotbot|petalbot|bytespider|applebot|preview|headless/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === TRACKER_PATH) return tracker();
    if (url.pathname === '/analytics/api/event') return recordEvent(request, env);
    if (url.pathname === '/analytics/api/summary') return summary(url, env);
    if (url.pathname.startsWith('/analytics/')) return fetch(new URL(url.pathname + url.search, ORIGIN));

    const originUrl = new URL(url.pathname + url.search, ORIGIN);
    const originHeaders = new Headers(request.headers);
    originHeaders.set('host', originUrl.hostname);
    originHeaders.delete('cf-connecting-ip');
    const originRequest = new Request(originUrl, {
      method: request.method,
      headers: originHeaders,
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
      redirect: 'follow'
    });
    const response = await fetch(originRequest);
    const type = response.headers.get('content-type') || '';
    const isHtml = request.method === 'GET' && response.ok && type.includes('text/html');
    if (isHtml) ctx.waitUntil(record(request, env));
    if (!isHtml) return response;

    // Inject the first-party tracker so no page markup has to change.
    return new HTMLRewriter()
      .on('body', {
        element(el) {
          el.append(`<script src="${TRACKER_PATH}" defer></script>`, { html: true });
        }
      })
      .transform(response);
  }
};

/* ---------------------------------------------------------------- collection */

async function record(request, env) {
  const url = new URL(request.url);
  const cf = request.cf || {};
  const agent = request.headers.get('User-Agent') || '';
  let referrer = '';
  try { referrer = new URL(request.headers.get('Referer')).hostname; } catch (_) {}
  await insert(env, {
    visitor: await visitorHash(request, env),
    path: url.pathname,
    referrer,
    country: cf.country || '',
    browser: classify(agent),
    eventType: 'pageview'
  });
}

async function recordEvent(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  // Only accept events that originate from this site.
  const site = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== site) return json({ error: 'Cross-site events are rejected' }, 403);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON' }, 400); }

  const eventType = String(body.type || '');
  if (!EVENT_TYPES.includes(eventType)) return json({ error: 'Unknown event type' }, 400);

  const cf = request.cf || {};
  const agent = request.headers.get('User-Agent') || '';
  await insert(env, {
    visitor: await visitorHash(request, env),
    path: safePath(body.path),
    referrer: safeHost(body.referrer),
    country: cf.country || '',
    browser: classify(agent),
    eventType,
    target: clip(body.target, 200),
    previousPath: body.previousPath ? safePath(body.previousPath) : null,
    isReturning: body.returning ? 1 : 0
  });
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

async function insert(env, e) {
  await env.ANALYTICS.prepare(
    `INSERT INTO events
       (seen_at, visitor_hash, page_path, referrer_host, country, browser_type,
        event_type, event_target, previous_path, is_returning)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    new Date().toISOString(), e.visitor, e.path, e.referrer, e.country, e.browser,
    e.eventType, e.target || null, e.previousPath || null, e.isReturning || 0
  ).run();
}

async function visitorHash(request, env) {
  // Rotating daily hash: no IP address is stored and the value is not reusable
  // across days, so it cannot act as a persistent visitor identifier.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const day = new Date().toISOString().slice(0, 10);
  return hash(`${env.IP_HASH_SALT}:${day}:${ip}`);
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function classify(agent) {
  if (BOT_PATTERN.test(agent)) return 'Bot';
  if (/ipad|tablet/i.test(agent)) return 'Tablet';
  if (/mobile|android|iphone/i.test(agent)) return 'Mobile';
  return 'Desktop';
}

const clip = (value, max) => value == null ? null : String(value).slice(0, max);
const safePath = value => {
  const path = clip(value, 300) || '/';
  return path.startsWith('/') ? path : '/';
};
function safeHost(value) {
  if (!value) return '';
  try { return new URL(String(value)).hostname.slice(0, 200); } catch (_) { return ''; }
}

/* ------------------------------------------------------------------ tracker */

function tracker() {
  const script = `(function(){
  if (navigator.doNotTrack === '1' || window.__pspAnalytics) return;
  window.__pspAnalytics = true;
  var endpoint = '/analytics/api/event';
  var path = location.pathname;
  var navigated = false;

  function send(payload, keepalive) {
    payload.path = path;
    payload.referrer = document.referrer || '';
    var body = JSON.stringify(payload);
    try {
      if (keepalive && navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (e) {}
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body,
      keepalive: !!keepalive
    }).catch(function(){});
  }

  // Aggregate return signal: a local flag only. Nothing identifying is sent.
  var returning = false;
  try {
    returning = localStorage.getItem('psp_seen') === '1';
    localStorage.setItem('psp_seen', '1');
  } catch (e) {}
  send({ type: 'visit', returning: returning });

  var sameSiteRef = '';
  try {
    if (document.referrer && new URL(document.referrer).hostname === location.hostname) {
      sameSiteRef = new URL(document.referrer).pathname;
    }
  } catch (e) {}
  if (sameSiteRef && sameSiteRef !== path) {
    send({ type: 'navigation', previousPath: sameSiteRef });
  }

  var DOWNLOAD = /\\.(pdf|docx?|pptx?|xlsx?|csv|zip|mp3|mp4|wav|epub|txt|rtf)(\\?|#|$)/i;

  document.addEventListener('click', function(ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^(mailto|tel):/i.test(href)) {
      send({ type: 'outbound', target: href.split(':')[0] === 'mailto' ? 'email contact' : 'phone contact' });
      return;
    }
    var url;
    try { url = new URL(a.href, location.href); } catch (e) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    if (url.hostname !== location.hostname) {
      send({ type: 'outbound', target: url.hostname });
    } else if (a.hasAttribute('download') || DOWNLOAD.test(url.pathname)) {
      send({ type: 'download', target: url.pathname });
    } else if (url.pathname !== path) {
      navigated = true;
      send({ type: 'navigation', previousPath: path, target: url.pathname }, true);
    }
  }, true);

  window.addEventListener('pagehide', function() {
    if (!navigated) send({ type: 'exit' }, true);
  });
})();`;
  return new Response(script, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}

/* ------------------------------------------------------------------ reporting */

const CATEGORY_SQL = `CASE
  WHEN page_path = '/' THEN 'Home'
  WHEN page_path LIKE '/research%' OR page_path LIKE '/hmc%' THEN 'Research'
  WHEN page_path LIKE '/publication%' OR page_path LIKE '/paper%' OR page_path LIKE '/cv%' THEN 'Publications'
  WHEN page_path LIKE '/teaching%' OR page_path LIKE '/course%' OR page_path LIKE '/syllab%' THEN 'Teaching'
  WHEN page_path LIKE '/media%' OR page_path LIKE '/press%' OR page_path LIKE '/consult%' THEN 'Media & consulting'
  WHEN page_path LIKE '/analytics%' THEN 'Analytics'
  ELSE 'Other'
END`;

const REFERRER_SQL = `CASE
  WHEN referrer_host = '' THEN 'Direct / unknown'
  WHEN referrer_host LIKE '%google.%' AND referrer_host LIKE '%scholar%' THEN 'Academic profiles'
  WHEN referrer_host LIKE '%orcid%' OR referrer_host LIKE '%researchgate%' OR referrer_host LIKE '%webofscience%'
       OR referrer_host LIKE '%sciencedirect%' OR referrer_host LIKE '%academia.edu%'
       OR referrer_host LIKE '%research.com%' OR referrer_host LIKE '%topscinet%' THEN 'Academic profiles'
  WHEN referrer_host LIKE '%google.%' OR referrer_host LIKE '%bing.%' OR referrer_host LIKE '%duckduckgo%'
       OR referrer_host LIKE '%yahoo.%' OR referrer_host LIKE '%ecosia%' OR referrer_host LIKE '%naver.%'
       OR referrer_host LIKE '%baidu.%' OR referrer_host LIKE '%brave.%' THEN 'Search'
  WHEN referrer_host LIKE '%facebook%' OR referrer_host LIKE '%instagram%' OR referrer_host LIKE '%linkedin%'
       OR referrer_host LIKE '%t.co' OR referrer_host LIKE '%twitter%' OR referrer_host LIKE '%x.com'
       OR referrer_host LIKE '%bsky%' OR referrer_host LIKE '%reddit%' OR referrer_host LIKE '%mastodon%'
       OR referrer_host LIKE '%threads%' THEN 'Social'
  WHEN referrer_host LIKE '%ucf.edu%' THEN 'UCF'
  WHEN referrer_host LIKE '%.edu%' OR referrer_host LIKE '%.ac.%' THEN 'Other universities'
  WHEN referrer_host LIKE '%github%' THEN 'GitHub'
  ELSE 'Other websites'
END`;

const HUMAN = "browser_type <> 'Bot'";
const PAGEVIEW = "event_type = 'pageview'";

async function summary(url, env) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isDate(from) || !isDate(to)) return json({ error: 'Use YYYY-MM-DD dates' }, 400);
  if (from > to) return json({ error: 'The start date must not be after the end date' }, 400);

  const range = bounds(from, to);
  const prior = priorRange(from, to);
  const q = (sql, a, b) => env.ANALYTICS.prepare(sql).bind(a, b);
  const inRange = (sql) => q(sql, range.start, range.end);

  const totalsSql = `SELECT
      COUNT(*) views,
      SUM(CASE WHEN ${HUMAN} THEN 1 ELSE 0 END) humanViews,
      SUM(CASE WHEN browser_type = 'Bot' THEN 1 ELSE 0 END) botViews,
      COUNT(DISTINCT CASE WHEN ${HUMAN} THEN visitor_hash END) visitors,
      COUNT(DISTINCT CASE WHEN ${HUMAN} AND country <> '' THEN country END) countries
    FROM events WHERE ${PAGEVIEW} AND seen_at BETWEEN ? AND ?`;

  const [
    totals, previous, referrers, referrerHosts, pages, categories, countries,
    devices, daily, actions, paths, exits, visits, weekdays, hours
  ] = await Promise.all([
    inRange(totalsSql).first(),
    q(totalsSql, prior.start, prior.end).first(),
    inRange(`SELECT ${REFERRER_SQL} label, COUNT(*) count FROM events
             WHERE ${PAGEVIEW} AND ${HUMAN} AND seen_at BETWEEN ? AND ?
             GROUP BY label ORDER BY count DESC`).all(),
    inRange(`SELECT referrer_host label, COUNT(*) count FROM events
             WHERE ${PAGEVIEW} AND ${HUMAN} AND referrer_host <> '' AND seen_at BETWEEN ? AND ?
             GROUP BY label ORDER BY count DESC LIMIT 20`).all(),
    inRange(`SELECT page_path label, COUNT(*) count FROM events
             WHERE ${PAGEVIEW} AND ${HUMAN} AND seen_at BETWEEN ? AND ?
             GROUP BY label ORDER BY count DESC LIMIT 20`).all(),
    inRange(`SELECT ${CATEGORY_SQL} label, COUNT(*) count FROM events
             WHERE ${PAGEVIEW} AND ${HUMAN} AND seen_at BETWEEN ? AND ?
             GROUP BY label ORDER BY count DESC`).all(),
    inRange(`SELECT COALESCE(NULLIF(country,''),'Unknown') label, COUNT(*) count FROM events
             WHERE ${PAGEVIEW} AND ${HUMAN} AND seen_at BETWEEN ? AND ?
             GROUP BY label ORDER BY count DESC LIMIT 20`).all(),
    inRange(`SELECT browser_type label, COUNT(*) count FROM events
             WHERE ${PAGEVIEW} AND seen_at BETWEEN ? AND ?
             GROUP BY label ORDER BY count DESC`).all(),
    inRange(`SELECT substr(seen_at,1,10) day,
                    SUM(CASE WHEN ${HUMAN} THEN 1 ELSE 0 END) humanCount,
                    SUM(CASE WHEN browser_type = 'Bot' THEN 1 ELSE 0 END) botCount,
                    COUNT(*) count
             FROM events WHERE ${PAGEVIEW} AND seen_at BETWEEN ? AND ?
             GROUP BY day ORDER BY day`).all(),
    inRange(`SELECT event_type type, COALESCE(event_target,'(unspecified)') label, COUNT(*) count
             FROM events
             WHERE event_type IN ('outbound','download') AND seen_at BETWEEN ? AND ?
             GROUP BY type, label ORDER BY count DESC LIMIT 25`).all(),
    inRange(`SELECT previous_path source, page_path destination, COUNT(*) count
             FROM events
             WHERE event_type = 'navigation' AND previous_path IS NOT NULL
               AND seen_at BETWEEN ? AND ?
             GROUP BY source, destination ORDER BY count DESC LIMIT 20`).all(),
    inRange(`SELECT page_path label, COUNT(*) count FROM events
             WHERE event_type = 'exit' AND seen_at BETWEEN ? AND ?
             GROUP BY label ORDER BY count DESC LIMIT 20`).all(),
    inRange(`SELECT COUNT(*) visits, SUM(is_returning) returningVisits FROM events
             WHERE event_type = 'visit' AND seen_at BETWEEN ? AND ?`).first(),
    inRange(`SELECT CAST(strftime('%w', seen_at) AS INTEGER) weekday, COUNT(*) count
             FROM events WHERE ${PAGEVIEW} AND ${HUMAN} AND seen_at BETWEEN ? AND ?
             GROUP BY weekday ORDER BY weekday`).all(),
    inRange(`SELECT CAST(strftime('%H', seen_at) AS INTEGER) hour, COUNT(*) count
             FROM events WHERE ${PAGEVIEW} AND ${HUMAN} AND seen_at BETWEEN ? AND ?
             GROUP BY hour ORDER BY hour`).all()
  ]);

  const clean = t => ({
    views: t?.views || 0,
    humanViews: t?.humanViews || 0,
    botViews: t?.botViews || 0,
    visitors: t?.visitors || 0,
    countries: t?.countries || 0
  });

  return json({
    range: { from, to },
    comparisonRange: { from: prior.from, to: prior.to },
    totals: clean(totals),
    previousTotals: clean(previous),
    visits: { total: visits?.visits || 0, returning: visits?.returningVisits || 0 },
    referrers: referrers.results,
    referrerHosts: referrerHosts.results,
    pages: pages.results,
    categories: categories.results,
    countries: countries.results,
    devices: devices.results,
    daily: daily.results,
    actions: actions.results,
    paths: paths.results,
    exits: exits.results,
    weekdays: weekdays.results,
    hours: hours.results
  });
}

const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const bounds = (from, to) => ({ start: from + 'T00:00:00.000Z', end: to + 'T23:59:59.999Z' });

function priorRange(from, to) {
  const day = 864e5;
  const start = Date.parse(from + 'T00:00:00.000Z');
  const end = Date.parse(to + 'T00:00:00.000Z');
  const length = Math.round((end - start) / day) + 1;
  const priorTo = new Date(start - day).toISOString().slice(0, 10);
  const priorFrom = new Date(start - length * day).toISOString().slice(0, 10);
  return { from: priorFrom, to: priorTo, ...bounds(priorFrom, priorTo) };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
