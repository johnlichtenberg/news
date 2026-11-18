# News headlines (NYT + WSJ)

A small personal headlines page: https://johnlichtenberg.github.io/news/

- Uses only the publishers' public RSS feeds: headline, the feed's own short description, section, and time.
- Tapping a headline opens a ProQuest search for it (inside the NYT or WSJ publication) through the
  Arlington Public Library's EZproxy sign-in, and copies the headline to the clipboard. John signs in
  himself; no credentials are stored anywhere. A small nytimes.com / wsj.com link opens the publisher page.
- No article text is fetched, stored, or shown by this site.
- The header links open the Arlington Public Library's NYT and WSJ access (ProQuest, card + PIN).
- Library link format (`libraryLink` in `docs/lib.js`):
  `https://library.access.arlingtonva.us/login?qurl=<encodeURIComponent(target)>` with target
  `https://www.proquest.com/<nytimes|wallstreetjournal>/?accountid=57895&q=<encodeURIComponent('"headline"')>`.
  The `q` parameter is unconfirmed (ProQuest needs a sign-in to test); if ProQuest ignores it, the
  publication's search page opens and the copied headline can be pasted.

## How it works

- `docs/` is the static site (GitHub Pages, `main` branch, `/docs`).
- `worker/` is the Cloudflare Worker `news-feeds-relay` (free plan, no bindings or secrets).
  Browsers can't read RSS cross-origin, so the page asks the Worker. The Worker only fetches the
  fixed list in `worker/feeds.js`, parses each feed to JSON, and allows only
  `https://johnlichtenberg.github.io`. Results are cached for 5 minutes.
  - `GET /feeds` lists the feed ids. `GET /feed/<id>` returns one parsed feed.
- Nothing is scheduled. Feeds load when the page opens, on the Refresh button, and when you come
  back to the tab after 5 minutes.

## Tests

```
node worker/worker.test.mjs   # parser + Worker (fetch mocked)
node test/lib.test.mjs        # page logic: merge, de-dupe, filters, ET times
```

## Deploy the Worker

```
cd worker && npx wrangler@3 deploy
```

To add or remove a feed, edit `worker/feeds.js` (and `SECTION_ORDER` in `docs/lib.js` for a new section), run the tests, and redeploy.
