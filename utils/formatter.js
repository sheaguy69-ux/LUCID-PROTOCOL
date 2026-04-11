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

  const elapsed = result.elapsed ? `${e(result.elapsed)}` : '';
  lines.push('', `_${elapsed ? `Scanned in ${elapsed}s` : 'Scan complete'}_`);

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
    `/report \\[description\\] — Submit a suspected scam`,
    `/upgrade — Subscribe or upgrade your plan`,
    `/manage — Manage billing \\& subscription`,
    `/apikey — Generate an API key for developers`,
    `/usage — View your usage \\& subscription`,
    `/status — Bot status \\& statistics`,
    `/help — Show this message`,
    ``,
    `*How it works:*`,
    `Send any suspicious message, link, offer, screenshot, or voice note and ScamShield will analyze it using AI, URL reputation scanning, and pattern matching to give you a risk score from 1\\-10\\.`,
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
};
