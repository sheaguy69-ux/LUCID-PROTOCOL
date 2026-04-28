const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/gi;

// Matches @handle but not email addresses (no preceding word char or dot)
const HANDLE_REGEX = /(?<![.\w])@([a-zA-Z0-9_]{3,30})(?![a-zA-Z0-9_@])/g;

const PLATFORM_HINTS = [
  {
    platform: 'Instagram',
    text: [/\binstagram\b/, /\binsta\b/],
    domains: ['instagram.com'],
  },
  {
    platform: 'Twitter/X',
    text: [/\btwitter\b/, /\btweet\b/],
    domains: ['twitter.com', 'x.com'],
  },
  {
    platform: 'Telegram',
    text: [/\btelegram\b/, /\btg\b/, /\bt\.me\b/],
    domains: ['t.me', 'telegram.me', 'telegram.org'],
  },
  {
    platform: 'TikTok',
    text: [/\btiktok\b/, /\btik\s*tok\b/],
    domains: ['tiktok.com', 'vm.tiktok.com'],
  },
  {
    platform: 'Facebook',
    text: [/\bfacebook\b/, /\bfb\b/],
    domains: ['facebook.com', 'fb.com', 'fb.me'],
  },
  {
    platform: 'Threads',
    text: [/\bthreads\b/],
    domains: ['threads.net'],
  },
  {
    platform: 'Discord',
    text: [/\bdiscord\b/],
    domains: ['discord.gg', 'discord.com', 'discordapp.com'],
  },
  {
    platform: 'WhatsApp',
    text: [/\bwhatsapp\b/, /\bwa\.me\b/],
    domains: ['wa.me', 'whatsapp.com'],
  },
  {
    platform: 'Snapchat',
    text: [/\bsnapchat\b/, /\bsnap\b/],
    domains: ['snapchat.com', 'snap.com'],
  },
  {
    platform: 'YouTube',
    text: [/\byoutube\b/, /\byt\b/],
    domains: ['youtube.com', 'youtu.be'],
  },
  {
    platform: 'LinkedIn',
    text: [/\blinkedin\b/],
    domains: ['linkedin.com'],
  },
  {
    platform: 'Reddit',
    text: [/\breddit\b/],
    domains: ['reddit.com', 'redd.it'],
  },
  {
    platform: 'Twitch',
    text: [/\btwitch\b/],
    domains: ['twitch.tv'],
  },
  {
    platform: 'Pinterest',
    text: [/\bpinterest\b/],
    domains: ['pinterest.com', 'pin.it'],
  },
];

// Returns all platforms found in text + URLs (deduped)
function inferPlatforms(text, urls = []) {
  const lower = text.toLowerCase();
  const found = [];

  for (const { platform, text: textPatterns, domains } of PLATFORM_HINTS) {
    const inText = textPatterns.some((re) => re.test(lower));
    const inUrl = urls.some((u) => domains.some((d) => u.toLowerCase().includes(d)));
    if (inText || inUrl) found.push(platform);
  }

  return found;
}

// Legacy single-platform fallback used by older callers
function inferPlatform(text, urls = []) {
  return inferPlatforms(text, urls)[0] || null;
}

function extractHandles(text) {
  const seen = new Set();
  const results = [];
  for (const m of text.matchAll(HANDLE_REGEX)) {
    const handle = m[1];
    if (!seen.has(handle.toLowerCase())) {
      seen.add(handle.toLowerCase());
      results.push(handle);
    }
  }
  return results;
}

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
  const handles = extractHandles(text);
  // Detect platforms from both text keywords and URLs (e.g. instagram.com/user with no handle)
  const platforms = inferPlatforms(text, urls);
  const platform = platforms[0] || null;
  let contentType = 'text';
  if (urls.length > 0) {
    const stripped = text.trim();
    contentType = urls.some((u) => stripped === u) ? 'url' : 'mixed';
  }
  return { urls, text, contentType, handles, platform, platforms };
}

module.exports = {
  extractUrls,
  extractHandles,
  inferPlatform,
  inferPlatforms,
  isValidUrl,
  getDomain,
  normalizeUrl,
  encodeUrlForVT,
  parseInput,
};
