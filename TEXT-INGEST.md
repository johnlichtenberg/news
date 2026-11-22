# Ingesting private article text

The News page never stores or shows full article text. Text lives only in the
Worker’s KV namespace (`NEWS_HISTORY`, keys `text:<docviewId>`), on the Cloudflare
free plan. `GET /search` returns matches as `{ id, paper, date, title, link, snippet }`,
where `snippet` is at most about 200 characters around the first match. The full
text is never in the repo, the public page, or the `/search` / `/text` JSON.

This file describes how a fetcher writes text. It does not fetch anything itself,
and it does not contain a token or any article text.

## Endpoint

`POST https://news-feeds-relay.johnlichtenberg.workers.dev/text`

Headers:

- `Authorization: Bearer <token>`
- `Content-Type: application/json`

The token is the Worker secret `TEXT_TOKEN` (`wrangler secret put TEXT_TOKEN` in
`worker/`). It is kept in a local 600 file, never in this repo or on the page.

Body:

```json
{ "id": "1234567890", "text": "plain article text" }
```

- `id` is the ProQuest docview id (3–15 digits).
- `text` is plain text (HTML is stripped). Empty text is rejected. Each article
  is capped at 500,000 characters.

A successful response is `{ ok, id, month, found }` with no text. `found` is
true when that id already has a stored headline (NYT en Español ids are treated
as not found and are not searchable). The Worker also updates a monthly index
key `textm:<YYYY-MM>` so `/search` can run in a handful of KV reads.

## Write budget (free tier)

Each POST is two KV writes (`text:<id>` and the monthly index). The free plan
allows 1,000 writes per day, so stay well under a few hundred articles a day
and retry later if a write fails. Updating the same id overwrites the previous
text.

## Example

```sh
# TOKEN is read from a local 600 file; do not echo it, commit it, or paste it
# into the page or this repo.
curl -sS -X POST https://news-feeds-relay.johnlichtenberg.workers.dev/text \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- <<EOF
{"id":"1234567890","text":"...plain text..."}
EOF
```

The fetcher should only POST articles that already appear as headlines, skip
NYT en Español, and never write text to git, GitHub Pages, or any public file.
