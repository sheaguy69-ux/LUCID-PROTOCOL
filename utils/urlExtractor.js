const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/gi;

function extractUrls(text) {
  const matches = text.match(URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getDomain(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    return null;
  }
}

function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);
    // Strip common tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];
    trackingParams.forEach((p) => url.searchParams.delete(p));
    return url.toString();
  } catch {
    return urlString;
  }
}

function encodeUrlForVT(urlString) {
  // VirusTotal expects base64url-encoded URL (no padding)
  return Buffer.from(urlString).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseInput(text) {
  const urls = extractUrls(text);
  let contentType = 'text';
  if (urls.length > 0) {
    // If the entire input is basically just a URL
    const stripped = text.trim();
    contentType = urls.some((u) => stripped === u) ? 'url' : 'mixed';
  }
  return { urls, text, contentType };
}

module.exports = {
  extractUrls,
  isValidUrl,
  getDomain,
  normalizeUrl,
  encodeUrlForVT,
  parseInput,
};
