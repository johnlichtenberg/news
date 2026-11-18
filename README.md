# News (NYT + WSJ via ProQuest)

A small personal headlines page: https://johnlichtenberg.github.io/news/

- Shows only John's two ProQuest RSS alert feeds (public, no sign-in needed to read the feeds):
  - NYT: `https://feeds.proquest.com/rss/2310267` ("New York Times (Online)")
  - WSJ: `https://feeds.proquest.com/rss/2310287` ("Wall Street Journal (Online)"; titles are "Headline; subhead",
    only the headline is kept)
- Each article shows its headline, paper and date. Newest date first; within a date, NYT then WSJ, each in the
  feed's own order. Filters: All / NYT / WSJ.
- Each headline opens the exact article in ProQuest through the Arlington Public Library's EZproxy sign-in:
  `https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/<id>?accountid=57895`.
  John signs in himself (card + PIN); no credentials are stored anywhere.
- Only headline, date and article link are used. No descriptions, abstracts or article text are fetched,
  stored, or shown.

## How it works

- `docs/` is the static site (GitHub Pages, `main` branch, `/docs`).
- `worker/` is the Cloudflare Worker `news-feeds-relay` (free plan, no bindings or secrets).
  Browsers can't read RSS cross-origin, so the page asks the Worker. The Worker only fetches the two
  feeds in `worker/feeds.js`, parses them to JSON, and allows only `https://johnlichtenberg.github.io`.
  Results are cached for 5 minutes.
  - `GET /feeds` lists the feed ids. `GET /feed/<id>` returns one parsed feed.
- Nothing is scheduled. Feeds load when the page opens, on the Refresh button, and when you come
  back to the tab after 5 minutes.

## Tests

```
npm test   # worker/worker.test.mjs (parser + Worker, fetch mocked) and test/lib.test.mjs (page logic)
```

## Deploy the Worker

```
cd worker && npx wrangler@3 deploy
```
