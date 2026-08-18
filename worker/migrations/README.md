# Analytics event migration

Run `0002_event_analytics.sql` against the `ANALYTICS` D1 database **before** deploying the
Worker revision that records event analytics:

```sh
cd worker
npx wrangler d1 execute ANALYTICS --remote --file=migrations/0002_event_analytics.sql
npx wrangler deploy
```

The migration adds event type, target, prior-page and aggregate return-signal fields while
preserving existing rows as `pageview` records. `schema.sql` already contains these columns, so a
fresh database needs only `schema.sql` and no migration.

## What the Worker collects after this change

The Worker serves a first-party tracker at `/analytics/tracker.js` and injects it into proxied HTML
responses, so no page markup has to change. The tracker honours Do Not Track and posts to
`/analytics/api/event`, which accepts same-site requests only. Recorded events are:

| Event | Stored fields |
| --- | --- |
| `pageview` | path, referrer host, country, device class (server-side) |
| `visit` | path plus an aggregate returning yes/no flag |
| `navigation` | previous path and destination path |
| `exit` | path where the visit ended |
| `outbound` | destination hostname, or "email contact" / "phone contact" |
| `download` | file path |

No IP address, precise location, persistent visitor identifier, third-party tag or demographic
profile is stored. Visitor estimates continue to use the rotating daily hash.
