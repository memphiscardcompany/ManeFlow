import { normalizeText, safeDate } from './utils.js';
import { findSourcePolicy } from './data-rights-registry.js';

export const MANEFLOW_DATA_BOT = 'ManeFlowDataBot/1.0 (+https://mane.memphiscardcompany.com/data-policy)';

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizePath(value = '/') {
  try {
    const url = new URL(value, 'https://example.test');
    return url.pathname || '/';
  } catch {
    return String(value || '/').split('?')[0] || '/';
  }
}

export function looksPrivateOrBlockedUrl(value = '') {
  const text = normalizeText(value);
  return /\b(login|signin|sign in|account|cart|checkout|admin|private|paywall|captcha|password|oauth)\b/.test(text);
}

export function pathAllowedByPolicy(policy = {}, targetUrl = '') {
  const path = normalizePath(targetUrl);
  const disallowed = (policy.disallowedPaths || []).filter(Boolean);
  const allowed = (policy.allowedPaths || []).filter(Boolean);
  if (disallowed.some((prefix) => path.startsWith(normalizePath(prefix)))) {
    if (!allowed.some((prefix) => path.startsWith(normalizePath(prefix)))) {
      return { allowed: false, reason: `Path ${path} is disallowed by source policy.` };
    }
  }
  if (allowed.length && !allowed.some((prefix) => path.startsWith(normalizePath(prefix)))) {
    return { allowed: false, reason: `Path ${path} is not in the approved allowed-path list.` };
  }
  return { allowed: true, reason: 'Path allowed by source policy.' };
}

export function parseRobotsTxt(text = '') {
  const groups = [];
  let current = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line || !line.includes(':')) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      current = { agents: [value.toLowerCase()], allow: [], disallow: [], crawlDelaySeconds: null };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    if (key === 'allow') current.allow.push(value || '/');
    if (key === 'disallow' && value) current.disallow.push(value);
    if (key === 'crawl-delay') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) current.crawlDelaySeconds = Math.max(0, parsed);
    }
  }
  return groups;
}

function matchingRobotsGroups(groups = [], userAgent = MANEFLOW_DATA_BOT) {
  const product = userAgent.split('/')[0].toLowerCase();
  const exact = groups.filter((group) => group.agents.some((agent) => agent === product || product.includes(agent)));
  if (exact.length) return exact;
  return groups.filter((group) => group.agents.includes('*'));
}

export function robotsDecision(robotsText = '', targetUrl = '', userAgent = MANEFLOW_DATA_BOT) {
  const path = normalizePath(targetUrl);
  const groups = matchingRobotsGroups(parseRobotsTxt(robotsText), userAgent);
  if (!groups.length) return { allowed: true, crawlDelaySeconds: 0, reason: 'No matching robots.txt group.' };
  const rules = groups.reduce((acc, group) => ({
    allow: [...acc.allow, ...(group.allow || [])],
    disallow: [...acc.disallow, ...(group.disallow || [])],
    crawlDelaySeconds: Math.max(acc.crawlDelaySeconds, Number(group.crawlDelaySeconds || 0)),
  }), { allow: [], disallow: [], crawlDelaySeconds: 0 });
  const longestAllow = rules.allow.filter((rule) => path.startsWith(normalizePath(rule))).sort((a, b) => b.length - a.length)[0] || '';
  const longestDisallow = rules.disallow.filter((rule) => path.startsWith(normalizePath(rule))).sort((a, b) => b.length - a.length)[0] || '';
  if (longestDisallow && longestDisallow.length > longestAllow.length) {
    return { allowed: false, crawlDelaySeconds: rules.crawlDelaySeconds, reason: `robots.txt disallows ${path}.` };
  }
  return { allowed: true, crawlDelaySeconds: rules.crawlDelaySeconds, reason: 'robots.txt allows this path.' };
}

export function rateBudgetAllowed(policy = {}, history = [], now = new Date()) {
  const perMinute = Math.max(1, Number(policy.rateLimitPerMinute || 12));
  const crawlDelay = Math.max(0, Number(policy.crawlDelaySeconds || 0));
  const recent = history.filter((run) => run.provider === policy.provider && run.allowed !== false);
  const last = recent[0] || null;
  if (last?.createdAt && crawlDelay > 0) {
    const elapsedSeconds = (now.getTime() - (safeDate(last.createdAt)?.getTime() || 0)) / 1000;
    if (elapsedSeconds < crawlDelay) return { allowed: false, reason: `Crawl delay requires ${Math.ceil(crawlDelay - elapsedSeconds)} more seconds.` };
  }
  const minuteAgo = now.getTime() - 60_000;
  const count = recent.filter((run) => (safeDate(run.createdAt)?.getTime() || 0) >= minuteAgo).length;
  if (count >= perMinute) return { allowed: false, reason: `Rate limit exceeded for ${policy.provider}.` };
  return { allowed: true, reason: 'Rate budget available.' };
}

export function sourceRightsForSale(state, sale = {}) {
  const policy = findSourcePolicy(state, sale.provider);
  if (!policy) return { valuationEligible: false, publicDisplayEligible: false, reason: 'No source policy registered.' };
  if (policy.legalReviewStatus !== 'approved' || policy.ownerApprovalStatus !== 'approved') {
    return { valuationEligible: false, publicDisplayEligible: false, reason: 'Source policy is not approved.' };
  }
  if (policy.sourceType === 'prohibited' || policy.sourceType === 'review_only') {
    return { valuationEligible: false, publicDisplayEligible: false, reason: 'Source is not valuation eligible.' };
  }
  return {
    valuationEligible: Boolean(policy.valuationEligible),
    publicDisplayEligible: Boolean(policy.publicDisplayEligible),
    reason: policy.valuationEligible ? 'Source rights allow valuation after comp-quality review.' : 'Source rights do not allow valuation.',
  };
}

export function redactedPolicy(policy = {}) {
  return {
    ...policy,
    credentials: undefined,
    secret: undefined,
    apiKey: undefined,
    token: undefined,
    notes: clean(policy.notes, 1500),
  };
}
