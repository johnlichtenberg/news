// Detects NYT en Español headlines. ProQuest's alert feed gives no language, source or section field for them
// (they are listed as "New York Times (Online)" like everything else), so this is a headline heuristic:
// Spanish function words, Spanish punctuation (¿ ¡) and accented letters, after removing common
// Spanish-origin place names and phrases that appear in English headlines (Los Angeles, El Paso, La Niña…).

const STRONG = new Set(("del los las el la que por para con una uno unos unas y se su sus más mas según sobre entre tras " +
  "desde hasta cómo qué también pero sin como al lo es son fue han ha muy este esta estos estas ese esa hay ya " +
  "cuando porque dónde quién cuál nuevo nueva años año país gobierno contra ante").split(" "));
const ENGLISH_SPANISH = /\b(los angeles|las vegas|las cruces|los alamos|el paso|el salvador|el niño|el nino|la niña|la nina|la jolla|la guardia|laguardia|la paz|la scala|la liga|la la land|del mar|del rio|del taco|de blasio|de la hoya|de niro|de santis|desantis|san juan|santa fe|buenos aires|rio de janeiro|que sera|la dolce vita|hasta la vista|el chapo|el capitán|la croix|la quinta|los lobos|el pollo loco)\b/gi;

export function spanishScore(title) {
  const t = String(title || "").normalize("NFC").replace(ENGLISH_SPANISH, " ");
  const words = t.toLowerCase().match(/[a-záéíóúñü]+/g) || [];
  let score = 0;
  for (const w of words) { if (STRONG.has(w)) score += 1; else if (w === "de") score += 0.5; }
  return { score, words: words.length, accent: /[áéíóúñü]/i.test(t), punct: /[¿¡]/.test(t) };
}

export function isSpanishTitle(title) {
  const { score, words, accent, punct } = spanishScore(title);
  if (!words) return false;
  if (punct) return true;
  const ratio = score / words;
  return (score >= 3 && ratio >= 0.25) || (score >= 2 && accent && ratio >= 0.2);
}

// Import rows carry ProQuest's source name; NYT en Español rows say so explicitly.
export const isSpanishSource = (source) => /español|espanol/i.test(String(source || ""));
