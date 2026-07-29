import assert from 'node:assert/strict';

const baseUrl = String(process.argv[2] || '').replace(/\/+$/, '');
const expectedCommit = String(process.argv[3] || '').trim();
if (!/^https:\/\//.test(baseUrl)) throw new Error('An HTTPS staging base URL is required.');
if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('A full expected commit SHA is required.');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    ...options,
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

const health = await request('/api/health');
assert.equal(health.response.status, 200);
assert.equal(health.body.ok, true);
assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
assert.match(health.response.headers.get('strict-transport-security') || '', /max-age=/);

const release = await request('/api/release');
assert.equal(release.response.status, 200);
assert.equal(release.body.commitSha, expectedCommit);
assert.equal(release.body.environment, 'staging');
assert.ok(release.body.deployedAt);
assert.ok(release.body.releases?.web);
assert.ok(release.body.releases?.api);
assert.ok(release.body.releases?.vision);
assert.equal(String(release.body.migrationVersion), '008');

const folder = await request('/bulk-upload.html');
assert.equal(folder.response.status, 200);
assert.match(folder.body, /Upload an entire card-image folder/);
assert.match(folder.body, /Start durable intake/);

const session = await request('/api/auth/me');
assert.equal(session.response.status, 200);
assert.equal(session.body.authenticated, false);
assert.equal(session.body.csrfToken, null);

const protectedJob = await request('/api/scan-jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    idempotencyKey: 'unauthenticated-smoke-test',
    expectedItems: 1,
    processingAuthorization: true,
  }),
});
assert.equal(protectedJob.response.status, 401);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  commitSha: release.body.commitSha,
  environment: release.body.environment,
  migrationVersion: release.body.migrationVersion,
  folderIntake: true,
  unauthenticatedScanJobsBlocked: true,
}, null, 2));
