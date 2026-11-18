// Fixed whitelist: John's two ProQuest RSS alert feeds (public, no sign-in). The Worker fetches nothing else.
export const FEEDS = [
  // "New York Times (Online)" alert.
  // NYT en Español items are never included (live or stored); see lang.js for how they are detected.
  { id: "nyt-proquest", paper: "NYT", url: "https://feeds.proquest.com/rss/2310267", excludeSpanish: true },
  // "Wall Street Journal (Online)" alert. Its titles are "Headline; subhead"; only the headline is kept.
  { id: "wsj-proquest", paper: "WSJ", url: "https://feeds.proquest.com/rss/2310287", subheadSep: "; " },
];

// Articles open through the Arlington library's EZproxy sign-in (John signs in himself).
export const LIBRARY_LOGIN = "https://library.access.arlingtonva.us/login?url=";
export const PROQUEST_ACCOUNT = "57895";
