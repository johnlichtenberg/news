// Fixed whitelist of public publisher RSS feeds. The Worker fetches nothing else.
// id -> { paper, section, url }
export const FEEDS = [
  { id: "nyt-top",       paper: "NYT", section: "Top Stories",      url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
  { id: "nyt-world",     paper: "NYT", section: "World",            url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { id: "nyt-us",        paper: "NYT", section: "U.S.",             url: "https://rss.nytimes.com/services/xml/rss/nyt/US.xml" },
  { id: "nyt-politics",  paper: "NYT", section: "Politics",         url: "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml" },
  { id: "nyt-business",  paper: "NYT", section: "Business",         url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { id: "nyt-economy",   paper: "NYT", section: "Economy",          url: "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml" },
  { id: "nyt-money",     paper: "NYT", section: "Personal Finance", url: "https://rss.nytimes.com/services/xml/rss/nyt/YourMoney.xml" },
  { id: "nyt-tech",      paper: "NYT", section: "Tech",             url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml" },
  { id: "nyt-science",   paper: "NYT", section: "Science",          url: "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml" },
  { id: "nyt-health",    paper: "NYT", section: "Health",           url: "https://rss.nytimes.com/services/xml/rss/nyt/Health.xml" },
  { id: "nyt-climate",   paper: "NYT", section: "Climate",          url: "https://rss.nytimes.com/services/xml/rss/nyt/Climate.xml" },
  { id: "nyt-opinion",   paper: "NYT", section: "Opinion",          url: "https://rss.nytimes.com/services/xml/rss/nyt/Opinion.xml" },
  { id: "nyt-arts",      paper: "NYT", section: "Arts",             url: "https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml" },
  { id: "wsj-world",     paper: "WSJ", section: "World",            url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews" },
  { id: "wsj-us",        paper: "WSJ", section: "U.S.",             url: "https://feeds.content.dowjones.io/public/rss/RSSUSnews" },
  { id: "wsj-politics",  paper: "WSJ", section: "Politics",         url: "https://feeds.content.dowjones.io/public/rss/socialpoliticsfeed" },
  { id: "wsj-business",  paper: "WSJ", section: "Business",         url: "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness" },
  { id: "wsj-economy",   paper: "WSJ", section: "Economy",          url: "https://feeds.content.dowjones.io/public/rss/socialeconomyfeed" },
  { id: "wsj-markets",   paper: "WSJ", section: "Markets",          url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain" },
  { id: "wsj-money",     paper: "WSJ", section: "Personal Finance", url: "https://feeds.content.dowjones.io/public/rss/RSSPersonalFinance" },
  { id: "wsj-tech",      paper: "WSJ", section: "Tech",             url: "https://feeds.content.dowjones.io/public/rss/RSSWSJD" },
  { id: "wsj-opinion",   paper: "WSJ", section: "Opinion",          url: "https://feeds.content.dowjones.io/public/rss/RSSOpinion" },
  { id: "wsj-arts",      paper: "WSJ", section: "Arts",             url: "https://feeds.content.dowjones.io/public/rss/RSSArtsCulture" },
  { id: "wsj-lifestyle", paper: "WSJ", section: "Lifestyle",        url: "https://feeds.content.dowjones.io/public/rss/RSSLifestyle" },
];

// Article links must point at the publisher's own site.
export const LINK_HOSTS = { NYT: ["www.nytimes.com", "nytimes.com"], WSJ: ["www.wsj.com", "wsj.com"] };
