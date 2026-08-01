import {
  buildReleaseProvenance,
  releaseProvenanceHeaders,
} from './services/release-provenance.js';

function writeJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

export function createReleaseProvenanceRouter({ config, env = process.env } = {}) {
  if (!config) throw new Error('Release provenance router requires config.');

  return async function releaseProvenanceRouter(req, res) {
    const url = new URL(req.url || '/', 'http://maneflow.local');
    if (url.pathname !== '/api/release') return false;

    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      writeJson(res, 405, {
        error: 'METHOD_NOT_ALLOWED',
        allowed: ['GET', 'HEAD'],
      }, {
        allow: 'GET, HEAD',
        'cache-control': 'no-store, max-age=0',
      });
      return true;
    }

    const manifest = buildReleaseProvenance({ config, env });
    const headers = releaseProvenanceHeaders(manifest);
    if (method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return true;
    }

    writeJson(res, 200, manifest, headers);
    return true;
  };
}
