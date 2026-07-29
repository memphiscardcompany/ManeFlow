import net from 'node:net';

function hostSet(hosts) {
  const values = Array.isArray(hosts) ? hosts : String(hosts || '').split(',');
  return new Set(values.map((host) => String(host).trim().toLowerCase()).filter(Boolean));
}

export function validateMetaAttachmentUrl(value, allowedHosts = []) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    return { allowed: false, reason: 'META_ATTACHMENT_URL_INVALID' };
  }
  if (parsed.protocol !== 'https:') {
    return { allowed: false, reason: 'META_ATTACHMENT_HTTPS_REQUIRED' };
  }
  if (parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || parsed.hash) {
    return { allowed: false, reason: 'META_ATTACHMENT_URL_UNSAFE' };
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || net.isIP(hostname)
  ) {
    return { allowed: false, reason: 'META_ATTACHMENT_HOST_UNSAFE' };
  }
  if (!hostSet(allowedHosts).has(hostname)) {
    return { allowed: false, reason: 'META_ATTACHMENT_HOST_NOT_ALLOWLISTED' };
  }
  return {
    allowed: true,
    url: parsed.toString(),
    hostname,
  };
}

export function validateMetaAttachmentRedirect(value, allowedHosts = []) {
  return validateMetaAttachmentUrl(value, allowedHosts);
}
