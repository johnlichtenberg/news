# News (NYT + WSJ via ProQuest)

A small personal headlines page: https://johnlichtenberg.github.io/news/

- Shows only John's two ProQuest RSS alert feeds (public, no sign-in needed to read the feeds):
  - NYT: `https://feeds.proquest.com/rss/2310267` ("New York Times (Online)")
  - WSJ: `https://feeds.proquest.com/rss/2310287` ("Wall Street Journal (Online)"; titles are "Headline; subhead",
    only the headline is kept)
- Each article shows paper · date, then the headline. No time is shown: the feed's pubDate timestamps are
  ProQuest's batch load times (both papers arrive in the same few-minute windows about every 80–90 minutes), not
  article publish times. The Worker reads pubDate as an ET day and keeps the timestamp internally as `ts`.
  Newest date first; within a date, by ProQuest docview id, highest first (numeric, NYT and WSJ mixed), in every filter and in loaded older months. Filters: All / NYT / WSJ.
- Each headline opens the exact article in ProQuest through the Arlington Public Library's EZproxy sign-in:
  `https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/<id>?accountid=57895`.
  John signs in himself (card + PIN); no credentials are stored anywhere.
- The feeds only hold ProQuest's newest batch, so the Worker keeps every headline it has ever seen (see below).
  The page loads this month and last month first; "Load older" adds earlier months one at a time.
- NYT en Español items are never shown or stored. The ProQuest feed has no language, source or section field for
  them (they're listed as "New York Times (Online)" like the rest), so `worker/lang.js` detects them from the
  headline: Spanish function words, ¿/¡ and accented letters, after removing Spanish place names common in English
  headlines (Los Angeles, El Paso, La Niña…). The Worker drops them from the live feed, removes any already stored
  in the current month on the next refresh, hides them when serving any month, and the cron purges older months.
- Only headline, date and article link are used. No descriptions, abstracts or article text are fetched,
  stored, or shown.

## How it works

- `docs/` is the static site (GitHub Pages, `main` branch, `/docs`).
- `worker/` is the Cloudflare Worker `news-feeds-relay` (free plan, no bindings or secrets).
  Browsers can't read RSS cross-origin, so the page asks the Worker. The Worker only fetches the two
  feeds in `worker/feeds.js`, parses them to JSON, and allows only `https://johnlichtenberg.github.io`.
  Results are cached for 5 minutes.
  - `GET /feeds` lists the feed ids.
  - `GET /feed/<id>` refreshes the feed and returns this month's and last month's history
    (`items`: paper, title, date, optional `ts` (ISO pubDate), link; `latest`: items in the live feed now; `months`: all stored months;
    `older`: months not included, for "Load older").
  - `GET /feed/<id>/<YYYY-MM>` returns one stored month (no upstream fetch).
- History (kept forever): Workers KV namespace `news-feeds-relay-NEWS_HISTORY` (binding `NEWS_HISTORY`,
  id `64d4a2262065442ca10a11f79c670480`; not x-text's `ARCHIVE`), sharded by month so no value nears KV's 25 MB limit:
  - `hist:<feed id>:<YYYY-MM>`: `{ updated, items: [{ paper, title, date, ts?, link, id, seen }] }` (id = docview id, ts = pubDate timestamp
    when the feed gave one, filled in later if the live feed still has the item,
    seen = first-seen time). An item goes in the shard of the month (ET) it was first seen and is never duplicated.
  - `idx:<feed id>`: `{ updated, months: [newest first] }`.
  - Each fetch merges the live batch into the current month's shard only, and writes only when it changed. The
    index is written once per feed per month. If ProQuest is down, the stored history is still served.
- Free Workers cron `*/30 * * * *` (every 30 minutes, UTC) refreshes both feeds so history fills in between visits.
  The page also refreshes when opened, on the Refresh button, and when you come back to the tab after 5 minutes.
- KV write budget (free tier 1,000/day): writes happen only when a feed's content changes. Upper bound per feed is
  one per 5-minute cache window plus one per cron run (288 + 48), i.e. at most ~672/day for both feeds even if
  the feeds changed constantly (+2 index writes a month); in practice it's a handful per day (one per new ProQuest
  batch). Size: roughly 250 bytes per headline, so even 2,000 headlines a month per feed is ~0.5 MB per shard.

## Importing a day's headlines

`node worker/import-history.mjs <lines.txt> <YYYY-MM-DD> [--write]` (dry run without `--write`). Lines are
`PAPER|ID|TITLE` or `PAPER|ID|SOURCE|TITLE`; rows whose SOURCE contains "Español"/"en Espanol" (or NYT headlines the
Spanish detector flags) are skipped. WSJ titles keep only the part before "; ", NYT titles drop a ": [Desk]" suffix.
Existing items are never overwritten; one `wrangler kv key put` per month key.

## Tests

```
npm test   # worker/worker.test.mjs (parser + Worker, fetch mocked) and test/lib.test.mjs (page logic)
```

## Deploy the Worker

```
cd worker && npx wrangler@3 deploy
```
