// Characters that must be escaped in Telegram MarkdownV2
const ESCAPE_CHARS = /([_*\[\]()~`>#+\-=|{}.!])/g;

function escapeMarkdownV2(text) {
  if (!text) return '';
  return String(text).replace(ESCAPE_CHARS, '\\$1');
}

function riskBar(score) {
  if (score <= 3) return `🟢 ${score}/10 — Low Risk`;
  if (score <= 6) return `🟡 ${score}/10 — Medium Risk`;
  if (score <= 9) return `🔴 ${score}/10 — High Risk`;
  return `💀 ${score}/10 — CRITICAL`;
}

function formatScanResult(result) {
  const e = escapeMarkdownV2;

  const indicators = (result.indicators || [])
    .map((ind) => `  • ${e(ind)}`)
    .join('\n');

  const lines = [
    `*🛡 ScamShield Analysis*`,
    ``,
    `*Risk Score:* ${e(riskBar(result.riskScore))}`,
    `*Confidence:* ${e(result.confidence + '%')}`,
  ];

  if (indicators) {
    lines.push('', `*Red Flags Found:*`, indicators);
  }

  if (result.reasoning) {
    lines.push('', `*Reasoning:*`, e(result.reasoning));
  }

  if (result.advice) {
    lines.push('', `*Advice:*`, e(result.advice));
  }

  if (result.virusTotalResult) {
    const vt = result.virusTotalResult;
    lines.push('', `*VirusTotal:* ${e(`${vt.malicious}/${vt.total} engines flagged`)}`);
  }

  const blockchainSection = formatBlockchainSection(result.blockchainResult);
  if (blockchainSection) {
    lines.push('', `*On\\-Chain:*`, blockchainSection);
  }

  const hasSocialHandles = result.socialHandles?.length > 0;
  const hasSocialPlatforms = result.socialPlatforms?.length > 0;
  if (hasSocialHandles || hasSocialPlatforms) {
    const platformStr = hasSocialPlatforms
      ? ` \\(${result.socialPlatforms.map(e).join(', ')}\\)`
      : '';
    const handleStr = hasSocialHandles
      ? result.socialHandles.map((h) => `\`@${e(h)}\``).join(', ')
      : '_URL only_';
    lines.push('', `*Social${platformStr}:* ${handleStr}`);
  }

  const elapsed = result.elapsed ? `${e(result.elapsed)}` : '';
  lines.push('', `_${elapsed ? `Scanned in ${elapsed}s` : 'Scan complete'}_`);

  return lines.join('\n');
}

const RISK_EMOJI = { critical: '💀', high: '🔴', low: '⚠️', none: '' };

const FLAG_LABELS = {
  isHoneypot: 'Honeypot',
  isMaliciousContract: 'Malicious contract',
  isSanctioned: 'Sanctioned',
  isPhishing: 'Phishing activity',
  isStealingAttack: 'Stealing attack',
  hasHiddenOwner: 'Hidden owner',
  hasSelfDestruct: 'Self-destruct',
  isMaliciousWallet: 'Malicious wallet',
};

// Priority order for flag display (most severe first)
const FLAG_ORDER = [
  'isHoneypot', 'isMaliciousContract', 'isSanctioned',
  'isPhishing', 'isStealingAttack', 'hasHiddenOwner',
  'hasSelfDestruct', 'isMaliciousWallet',
];

function formatBlockchainSection(blockchainResult) {
  if (!blockchainResult) return '';
  const e = escapeMarkdownV2;
  const lines = [];

  for (const r of blockchainResult.results) {
    if (r.riskLevel === 'none') continue;

    const emoji = RISK_EMOJI[r.riskLevel] || '';
    const shortAddr = `${r.address.slice(0, 6)}…${r.address.slice(-4)}`;
    const activeFlags = FLAG_ORDER.filter((k) => r.flags[k]).slice(0, 3);
    const flagStr = activeFlags.map((k) => FLAG_LABELS[k]).join(', ');

    lines.push(`  • ${e(`${shortAddr} (${r.chainName})`)} ${emoji} ${e(flagStr)}`);

    const sellTax = parseFloat(r.tokenSecurity?.sell_tax || '0');
    const buyTax = parseFloat(r.tokenSecurity?.buy_tax || '0');
    if (sellTax > 0 || buyTax > 0) {
      lines.push(`    _Buy tax: ${e(String(buyTax))}% \\| Sell tax: ${e(String(sellTax))}%_`);
    }
  }

  return lines.join('\n');
}

function formatContractResult(blockchainResult, claudeResult = null) {
  const e = escapeMarkdownV2;

  if (!blockchainResult || blockchainResult.results.length === 0) {
    return '*🔍 On\\-Chain Scan*\n\nNo contract data found for this address\\.';
  }

  const lines = [`*🔍 On\\-Chain Analysis*`, ``];

  for (const r of blockchainResult.results) {
    const emoji = RISK_EMOJI[r.riskLevel] || '✅';
    const ts = r.tokenSecurity;
    const as = r.addressSecurity;

    lines.push(`*Address:* \`${e(r.address)}\``);
    lines.push(`*Chain:* ${e(r.chainName)}`);
    lines.push(`*Status:* ${emoji} ${e(r.riskLevel.toUpperCase())}`);

    if (ts?.token_name || ts?.token_symbol) {
      lines.push(`*Token:* ${e(`${ts.token_name || ''} (${ts.token_symbol || '?'})`)}`);
    }
    if (ts?.holder_count) {
      lines.push(`*Holders:* ${e(String(ts.holder_count))}`);
    }

    const md = r.marketData;
    if (md) {
      if (md.price != null) {
        const priceStr = md.price < 0.000001
          ? md.price.toExponential(2)
          : md.price < 0.01
          ? md.price.toFixed(8)
          : md.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
        lines.push(`*Price:* $${e(priceStr)}`);
      }
      if (md.marketCap != null) {
        const mcap = md.marketCap >= 1e9
          ? `$${(md.marketCap / 1e9).toFixed(2)}B`
          : md.marketCap >= 1e6
          ? `$${(md.marketCap / 1e6).toFixed(2)}M`
          : `$${Math.round(md.marketCap).toLocaleString('en-US')}`;
        const mcapWarn = md.marketCap < 100_000 ? ' ⚠️' : md.marketCap < 1_000_000 ? ' 🔸' : '';
        lines.push(`*Market Cap:* ${e(mcap)}${mcapWarn}`);
      }
      if (md.volume24h != null) {
        const vol = md.volume24h >= 1e9
          ? `$${(md.volume24h / 1e9).toFixed(2)}B`
          : md.volume24h >= 1e6
          ? `$${(md.volume24h / 1e6).toFixed(2)}M`
          : `$${Math.round(md.volume24h).toLocaleString('en-US')}`;
        const volWarn = md.volume24h < 1000 ? ' ⚠️' : '';
        lines.push(`*24h Volume:* ${e(vol)}${volWarn}`);
      }
      if (md.change24h != null) {
        const sign = md.change24h >= 0 ? '+' : '';
        const changeWarn = md.change24h > 100 ? ' 🔴' : md.change24h > 50 ? ' ⚠️' : '';
        lines.push(`*24h Change:* ${e(`${sign}${md.change24h.toFixed(2)}%`)}${changeWarn}`);
      }
    }

    const activeFlags = FLAG_ORDER.filter((k) => r.flags[k]);
    if (activeFlags.length > 0) {
      lines.push(``, `*Red Flags:*`);
      activeFlags.forEach((k) => lines.push(`  • ${e(FLAG_LABELS[k])}`));
    }

    const sellTax = parseFloat(ts?.sell_tax || '0');
    const buyTax = parseFloat(ts?.buy_tax || '0');
    if (sellTax > 0 || buyTax > 0) {
      lines.push(``, `*Taxes:* Buy ${e(String(buyTax))}% \\| Sell ${e(String(sellTax))}%`);
    }

    lines.push(``);
  }

  if (claudeResult?.reasoning) {
    lines.push(`*AI Reasoning:*`, e(claudeResult.reasoning), ``);
  }
  if (claudeResult?.advice) {
    lines.push(`*Advice:*`, e(claudeResult.advice), ``);
  }

  const hasMarketData = blockchainResult.results.some((r) => r.marketData);
  lines.push(`_Powered by GoPlus Security${hasMarketData ? ' \\+ CoinGecko' : ''}_`);
  return lines.join('\n');
}

function formatReportConfirmation(reportId, indicators) {
  const e = escapeMarkdownV2;
  const lines = [
    `*🛡 Report Submitted*`,
    ``,
    `Thank you for your report\\! It has been logged\\.`,
  ];

  if (reportId) {
    lines.push(`Report ID: \`${e(reportId.slice(0, 8))}\``);
  }

  if (indicators && indicators.length > 0) {
    lines.push('', `Our system flagged ${e(String(indicators.length))} potential indicator\\(s\\):`);
    indicators.forEach((ind) => {
      lines.push(`  • ${e(ind)}`);
    });
  }

  lines.push('', `_Community reports help protect everyone\\._`);
  return lines.join('\n');
}

function formatStatus(stats, uptimeSeconds) {
  const e = escapeMarkdownV2;
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  return [
    `*🛡 ScamShield Status*`,
    ``,
    `*Uptime:* ${e(`${hours}h ${minutes}m`)}`,
    `*Total Scans:* ${e(String(stats.totalScans))}`,
    `*Community Reports:* ${e(String(stats.communityReports))}`,
    `*High\\-Risk Detected:* ${e(String(stats.highRiskDetected))}`,
    ``,
    `_All systems operational\\._`,
  ].join('\n');
}

function formatMultimodalScanResult(result, mediaType) {
  const e = escapeMarkdownV2;

  const mediaLabel = {
    image: '📸 Image',
    audio: '🎤 Voice/Audio',
    document: '📄 Document',
  }[mediaType] || '📎 Media';

  const indicators = (result.indicators || [])
    .map((ind) => `  • ${e(ind)}`)
    .join('\n');

  const lines = [
    `*🛡 ScamShield Media Analysis*`,
    ``,
    `*Type:* ${e(mediaLabel)}`,
    `*Risk Score:* ${e(riskBar(result.riskScore))}`,
    `*Confidence:* ${e(result.confidence + '%')}`,
  ];

  if (result.semanticMatches && result.semanticMatches.length > 0) {
    lines.push('', `*🧠 Similar Known Scams:*`);
    result.semanticMatches.forEach((m) => {
      lines.push(`  • ${e(`"${m.pattern}" — ${m.similarity}% match`)}`);
    });
  }

  if (indicators) {
    lines.push('', `*Red Flags Found:*`, indicators);
  }

  if (result.reasoning) {
    lines.push('', `*Reasoning:*`, e(result.reasoning));
  }

  if (result.advice) {
    lines.push('', `*Advice:*`, e(result.advice));
  }

  if (result.virusTotalResult) {
    const vt = result.virusTotalResult;
    lines.push('', `*VirusTotal:* ${e(`${vt.malicious}/${vt.total} engines flagged`)}`);
  }

  const blockchainSection = formatBlockchainSection(result.blockchainResult);
  if (blockchainSection) {
    lines.push('', `*On\\-Chain:*`, blockchainSection);
  }

  const elapsed = result.elapsed ? `${e(result.elapsed)}` : '';
  lines.push('', `_${elapsed ? `Scanned in ${elapsed}s` : 'Scan complete'}_`);

  return lines.join('\n');
}

function formatHelp() {
  return [
    `*🛡 ScamShield Bot*`,
    ``,
    `AI\\-powered scam detection for crypto \\& investment fraud\\.`,
    ``,
    `*Commands:*`,
    `/scan \\[text or URL\\] — Analyze for scam indicators`,
    `/contract \\[address\\] — Scan a contract or wallet on\\-chain`,
    `/report \\[description\\] — Submit a suspected scam`,
    `/upgrade — Subscribe or upgrade your plan`,
    `/manage — Manage billing \\& subscription`,
    `/apikey — Generate an API key for developers`,
    `/usage — View your usage \\& subscription`,
    `/status — Bot status \\& statistics`,
    `/help — Show this message`,
    `/abyssal — MEV defense for LP pools (commission\\-based)`,
    `/learn \[pattern\] — Submit a scam pattern to train the detector`,
    `/invite \[username\] — Refer a friend and earn bonus scans`,
    `/portfolio \[address\] — Track wallet risk with Portfolio Shield`,
    `/security — Privacy & security settings`,
    `/privacy — View our privacy policy`,
    `/optout — Opt out of data collection`,
    `/delete — Delete all your data`,
    `/ping — Check if the bot is alive`,
    ``,
    `*How it works:*`,
    ``,
    `_Stay safe out there\\! 🛡_`,
  ].join('\n');
}

function formatPremium() {
  return [
    `*⭐ ScamShield Pricing*`,
    ``,
    `*Pro — $8/mo*`,
    `• 1,000 scans/month`,
    `• Full Aegis multi\\-agent oversight`,
    `• Transparent block/flag explanations`,
    `• API access \\+ priority support`,
    `• 7\\-day free trial`,
    ``,
    `*Unlimited — $17/mo*`,
    `• Unlimited scans`,
    `• Everything in Pro`,
    `• Admin dashboard \\+ audit logs`,
    `• Custom Aegis policies`,
    `• 7\\-day free trial`,
    ``,
    `_Type /upgrade to start your free trial\\._`,
  ].join('\n');
}

module.exports = {
  escapeMarkdownV2,
  riskBar,
  formatScanResult,
  formatMultimodalScanResult,
  formatReportConfirmation,
  formatStatus,
  formatHelp,
  formatPremium,
  formatBlockchainSection,
  formatContractResult,
};
