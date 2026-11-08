export function cleanIPTVName(name: string): string {
  let clean = name;
  // If there's a pipe like "TR | Matrix", take the part after the pipe
  if (clean.includes('|')) {
    clean = clean.split('|').pop() || clean;
  }
  
  // Strip leading numbering like "1. ", "02.", "10- "
  clean = clean.replace(/^\d+[\.\-]\s*/, '');
  
  // Remove anything in parenthesis (like years)
  clean = clean.replace(/\(.*?\)/g, '');
  // Remove anything in brackets
  clean = clean.replace(/\[.*?\]/g, '');
  // Remove quality tags
  clean = clean.replace(/4K|1080p|1080P|1080|720p|720P|720|HD|SD|FHD|UHD|X264|X265|HEVC/gi, '');
  // Remove language prefixes if they use colon "TR: Matrix"
  if (clean.toUpperCase().startsWith('TR:') || clean.toUpperCase().startsWith('EN:')) {
    clean = clean.substring(3);
  }
  // Remove trailing " - YYYY" or " YYYY" (e.g. "The Astronaut - 2025")
  clean = clean.replace(/[- ]+\d{4}$/, '');
  
  return clean.trim();
}

/**
 * Cleans a live TV channel name for display: strips decorative star/symbol
 * clutter and redundant "TR:" / "EN|" style country-code prefixes that many
 * IPTV panels prepend. Unlike cleanIPTVName, quality tags (HD/FHD/UHD/4K) are
 * kept since for live channels they often distinguish otherwise-identical entries.
 */
export function cleanChannelName(name: string): string {
  if (!name) return name;
  let clean = name;
  // Strip a leading 2-4 letter country/language code prefix like "TR:", "EN|", "tr -"
  clean = clean.replace(/^[A-Z]{2,4}\s*[:|]\s*/i, '');
  // Remove decorative star clusters used by some panels to grab attention
  clean = clean.replace(/[★☆]{2,}/g, ' ');
  // Strip leftover symbol/whitespace runs at the edges
  clean = clean.replace(/^[\s★☆•\-_|]+/, '').replace(/[\s★☆•\-_|]+$/, '');
  clean = clean.replace(/\s{2,}/g, ' ').trim();
  return clean || name;
}

export function extractYear(name: string): string | null {
  if (!name) return null;
  // Extract from parenthesis (2024)
  let match = name.match(/\((\d{4})\)/);
  if (match) return match[1];
  // Extract from brackets [2024]
  match = name.match(/\[(\d{4})\]/);
  if (match) return match[1];
  // Extract from trailing year - 2024
  match = name.match(/[- ]+(\d{4})$/);
  if (match) return match[1];
  return null;
}
