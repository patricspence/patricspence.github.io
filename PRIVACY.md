# Website analytics and privacy

This site uses a first-party Cloudflare Worker to measure aggregate website activity. It records the time of an HTML page view, page path, referrer hostname (for example, `google.com`), country supplied by Cloudflare, and a broad browser category.

The system does **not** store raw IP addresses, full user-agent strings, query strings, or full referring URLs. To estimate repeat visitors within a day, it creates a SHA-256 hash of the visitor IP, the UTC date, and a secret salt. The salt is held only as a Cloudflare Worker secret. The hash rotates daily and is not presented in the dashboard.

Recommended operational settings:

- Restrict `/analytics/*` with a Cloudflare Access application that permits only the site administrator.
- Retain event data for no more than 90 days, then delete it with a scheduled Worker or D1 cleanup job.
- Publish a link to this notice from the public website privacy statement before enabling collection.
- Do not add names, email addresses, raw IP addresses, fingerprinting identifiers, or other directly identifying fields to analytics events.

## Deployment

1. Add the domain to Cloudflare and make its DNS record **proxied** (orange cloud). Keep the existing GitHub Pages CNAME/target as the origin.
2. In `worker/`, install Wrangler and authenticate: `npm install -g wrangler` then `wrangler login`.
3. Create the D1 database: `wrangler d1 create patricspence-analytics`; copy its ID into `worker/wrangler.toml`.
4. Apply the schema: `wrangler d1 execute patricspence-analytics --remote --file=schema.sql`.
5. Set a long, random secret: `wrangler secret put IP_HASH_SALT`.
6. Deploy: `wrangler deploy`. Attach the Worker route to `www.patricspence.com/*`.
7. In Cloudflare Zero Trust, create an Access application for `www.patricspence.com/analytics/*` and allow only your authenticated email address.

The dashboard is at `/analytics/`. It is intentionally not linked in public navigation and has a `noindex` directive, but Cloudflare Access—not obscurity—is the access control.
