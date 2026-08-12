# Analytics event migration

Run `0002_event_analytics.sql` against the `ANALYTICS` D1 database before deploying the upgraded Worker revision that records event analytics. For example:

```sh
cd worker
npx wrangler d1 execute ANALYTICS --remote --file=migrations/0002_event_analytics.sql
```

Then deploy the Worker through the existing Wrangler workflow. The migration adds event type, target, prior-page, and aggregate return-signal fields while preserving existing page-view rows as `pageview` records.

The upgraded dashboard will use these fields for outbound/download actions, same-site navigation paths, exit pages, and aggregate return-visit estimates. It does not add a persistent visitor identifier, precise location, or IP-address storage.
