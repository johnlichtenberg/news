# News (NYT + WSJ via ProQuest)

A small personal headlines page: https://johnlichtenberg.github.io/news/

- Shows only John's two ProQuest RSS alert feeds (public, no sign-in needed to read the feeds):
  - NYT: `https://feeds.proquest.com/rss/2310267` ("New York Times (Online)")
  - WSJ: `https://feeds.proquest.com/rss/2310287` ("Wall Street Journal (Online)"; titles are "Headline; subhead",
    only the headline is kept)
- A search box at the top filters headlines instantly (case-insensitive, multi-word AND, quoted phrases). When a search is active, older months are loaded so every stored headline is searchable. Queries of three or more characters also call the Worker’s `/search`, which signs into ProQuest through the Arlington library EZproxy and runs a full-text search of the NYT and WSJ publication pages. Matching results (including ones not already on the page) show the headline plus a short snippet. If live search is unavailable, the box falls back to headlines and shows a quiet notice. Full article text is never on the page, in the repo, or in the API response.
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
- The public page and the repo store only headline, date and article link. Article text, when a fetcher
  has posted it, is kept privately in Workers KV (`text:<docviewId>`) and is used only for `/search`.
  See `TEXT-INGEST.md`. The RSS parser still never reads descriptions, abstracts, or full text from the feed.

## How it works

- `docs/` is the static site (GitHub Pages, `main` branch, `/docs`).
- `worker/` is the Cloudflare Worker `news-feeds-relay` (free plan). Secrets (not in the repo): `TEXT_TOKEN` guards
  `POST /text`; `LIB_USER` and `LIB_PIN` are the Arlington library username and PIN used only by the Worker to sign
  into EZproxy for live search.
  Browsers can't read RSS cross-origin, so the page asks the Worker. The Worker only fetches the two
  feeds in `worker/feeds.js`, parses them to JSON, and allows only `https://johnlichtenberg.github.io`.
  Results are cached for 5 minutes.
  - `GET /feeds` lists the feed ids.
  - `GET /feed/<id>` refreshes the feed and returns this month's and last month's history
    (`items`: paper, title, date, optional `ts` (ISO pubDate), link; `latest`: items in the live feed now; `months`: all stored months;
    `older`: months not included, for "Load older").
  - `GET /feed/<id>/<YYYY-MM>` returns one stored month (no upstream fetch).
  - `GET /search?q=...` (3–200 characters, rate limited, allowed origin only) runs a live ProQuest full-text search
    of NYT and WSJ (session cookie cached in KV, results cached for an hour, about 1 live search every few seconds,
    daily cap of about 200 upstream requests). It returns only matches: `{ id, paper, date, title, link, snippet? }`.
    `snippet` is at most ~200 characters around the match. NYT en Español results are dropped. If ProQuest fails,
    it falls back to stored headlines and sets `notice`. Full text is never returned.
  - `POST /text` (bearer token, see `TEXT-INGEST.md`) writes `{ id, text }` to KV as `text:<docviewId>`.
- History (kept forever): Workers KV namespace `news-feeds-relay-NEWS_HISTORY` (binding `NEWS_HISTORY`,
  id `64d4a2262065442ca10a11f79c670480`; not x-text's `ARCHIVE`), sharded by month so no value nears KV's 25 MB limit:
  - `hist:<feed id>:<YYYY-MM>`: `{ updated, items: [{ paper, title, date, ts?, link, id, seen }] }` (id = docview id, ts = pubDate timestamp
    when the feed gave one, filled in later if the live feed still has the item,
    seen = first-seen time). An item goes in the shard of the month (ET) it was first seen and is never duplicated.
  - `idx:<feed id>`: `{ updated, months: [newest first] }`.
  - `text:<docviewId>`: private article text (written only by `POST /text`). Also a monthly index `textm:<YYYY-MM>`
    so `/search` does not need a KV read per article. These keys are never served in full.
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
