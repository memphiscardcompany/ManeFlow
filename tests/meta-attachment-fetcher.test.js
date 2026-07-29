import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaAttachmentFetcher } from '../src/manebrain/meta-attachment-fetcher.js';

test('attachment fetcher rejects unapproved hosts before network access', async () => {
  let called = false;
  const fetcher = new MetaAttachmentFetcher({
    allowedHosts: ['lookaside.fbsbx.com'],
    fetchImpl: async () => { called = true; return new Response(''); },
  });
  await assert.rejects(fetcher.fetch('https://example.com/private.jpg'), {
    code: 'META_ATTACHMENT_HOST_NOT_ALLOWLISTED',
  });
  assert.equal(called, false);
});

test('attachment fetcher validates every redirect and returns bounded allowed media', async () => {
  const calls = [];
  const fetcher = new MetaAttachmentFetcher({
    allowedHosts: ['lookaside.fbsbx.com', 'scontent.example.test'],
    maximumBytes: 1_024,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.startsWith('https://lookaside.fbsbx.com/')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://scontent.example.test/media/card.jpg' },
        });
      }
      return new Response(Buffer.from('card-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '10' },
      });
    },
  });
  const result = await fetcher.fetch('https://lookaside.fbsbx.com/attachment?id=1');
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.bytes.toString(), 'card-bytes');
  assert.equal(result.sourceUrl, 'https://scontent.example.test/media/card.jpg');
  assert.equal(calls.length, 2);
});

test('attachment fetcher blocks redirects to non-allowlisted hosts', async () => {
  const fetcher = new MetaAttachmentFetcher({
    allowedHosts: ['lookaside.fbsbx.com'],
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: 'https://untrusted.example/media.jpg' },
    }),
  });
  await assert.rejects(fetcher.fetch('https://lookaside.fbsbx.com/attachment?id=1'), {
    code: 'META_ATTACHMENT_HOST_NOT_ALLOWLISTED',
  });
});

test('attachment fetcher rejects oversized and unsupported responses', async () => {
  const oversized = new MetaAttachmentFetcher({
    allowedHosts: ['scontent.example.test'],
    maximumBytes: 1_024,
    fetchImpl: async () => new Response(Buffer.alloc(4), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '2048' },
    }),
  });
  await assert.rejects(oversized.fetch('https://scontent.example.test/media.jpg'), {
    code: 'META_ATTACHMENT_TOO_LARGE',
    status: 413,
  });

  const unsupported = new MetaAttachmentFetcher({
    allowedHosts: ['scontent.example.test'],
    fetchImpl: async () => new Response('<html>blocked</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  });
  await assert.rejects(unsupported.fetch('https://scontent.example.test/media'), {
    code: 'META_ATTACHMENT_CONTENT_TYPE_BLOCKED',
    status: 415,
  });
});
