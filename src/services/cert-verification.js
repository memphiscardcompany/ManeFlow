import { normalizeText } from './utils.js';
import { authorizeAcquisition } from './acquisition-gate.js';

export const CERT_VERIFICATION_VERSION = 'cert-verification-v1.0';

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

export function officialCertUrl(grader, certNumber = '') {
  const cert = encodeURIComponent(clean(certNumber, 80));
  const company = normalizeText(grader);
  if (!cert) return null;
  if (company.includes('psa')) return `https://www.psacard.com/cert/${cert}`;
  if (company.includes('bgs') || company.includes('beckett')) return `https://www.beckett.com/grading/card-lookup?item_type=BGS&item_id=${cert}`;
  if (company.includes('sgc')) return `https://www.gosgc.com/cert-code-lookup?certificateNumber=${cert}`;
  if (company.includes('cgc') || company.includes('csg')) return `https://www.cgcgrading.com/verify/${cert}`;
  return null;
}

export async function verifyCertIfAllowed({ state, grader, certNumber, fetchImpl = null, actor = null } = {}) {
  const certUrl = officialCertUrl(grader, certNumber);
  if (!certUrl) {
    return {
      version: CERT_VERIFICATION_VERSION,
      verificationStatus: certNumber ? 'unsupported_grader' : 'failed',
      certUrl: null,
      warnings: ['Unsupported grader or missing cert number.'],
    };
  }
  const decision = authorizeAcquisition(state || {}, `${grader} Cert Verification`, {
    url: certUrl,
    purpose: 'cert_verification',
    actor,
  });
  if (!decision.allowed || !fetchImpl) {
    return {
      version: CERT_VERIFICATION_VERSION,
      verificationStatus: decision.allowed ? 'manual_verify_recommended' : 'lookup_blocked_by_policy',
      certUrl,
      sourcePolicy: decision,
      warnings: [decision.allowed ? 'Open the official cert page to verify manually.' : decision.blockedReason],
    };
  }
  try {
    const response = await fetchImpl(certUrl, { headers: { 'user-agent': decision.userAgent }, signal: AbortSignal.timeout?.(10_000) });
    return {
      version: CERT_VERIFICATION_VERSION,
      verificationStatus: response.ok ? 'official_verified' : 'manual_verify_recommended',
      certUrl,
      sourcePolicy: decision,
      warnings: response.ok ? [] : [`Official cert lookup returned HTTP ${response.status}; manual verification recommended.`],
    };
  } catch (error) {
    return {
      version: CERT_VERIFICATION_VERSION,
      verificationStatus: 'manual_verify_recommended',
      certUrl,
      sourcePolicy: decision,
      warnings: [`Official cert lookup failed: ${error.message}`],
    };
  }
}
