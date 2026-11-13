import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMediaRequest, parseByteRange, MAX_MEDIA_BYTES } from '../lib/media-range.mjs';

const bytes = new Uint8Array(Array.from({ length: 23 }, (_, i) => i));
const origin = 'https://review.example.test';
function fixture(options = {}) {
  const calls = [];
  let cancelled = false;
  const assets = { async fetch(request) {
    calls.push(request);
    const data = options.bytes || bytes;
    let position = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (position >= data.length) { controller.close(); return; }
        controller.enqueue(data.subarray(position, position + 4));
        position += 4;
      },
      cancel() { cancelled = true; },
    });
    const headers = new Headers({
      'Content-Type': 'video/mp4', 'Content-Length': String(data.length),
      ETag: '"revision-one"', 'Last-Modified': 'Wed, 11 Nov 2026 12:00:00 GMT',
      ...(options.headers || {}),
    });
    for (const [key, value] of Object.entries(options.headers || {})) if (value === null) headers.delete(key);
    return new Response(body, { status: options.status || 200, headers });
  } };
  return { assets, calls, get cancelled() { return cancelled; } };
}
const request = (headers = {}, method = 'GET') => new Request(origin + '/api/media/sample-v1.mp4?unused=1', { method, headers });
async function responseBytes(response) { return Array.from(new Uint8Array(await response.arrayBuffer())); }

test('parser supports Safari probe, middle, open and suffix ranges', () => {
  for (const [header, expected] of [
    ['bytes=0-1', { start: 0, end: 1 }],
    ['bytes=5-12', { start: 5, end: 12 }],
    ['bytes=20-', { start: 20, end: 22 }],
    ['bytes=-3', { start: 20, end: 22 }],
    ['bytes=-100', { start: 0, end: 22 }],
    ['bytes=21-100', { start: 21, end: 22 }],
  ]) assert.deepEqual(parseByteRange(header, 23), expected);
  for (const header of ['bytes=23-', 'bytes=7-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bits=0-1', 'bytes=0-9007199254740992']) assert.equal(parseByteRange(header, 23), null);
});

test('returns exactly two bytes with 206 for Safari initial probe', async () => {
  const f = fixture();
  const response = await handleMediaRequest(request({ Range: 'bytes=0-1' }), f.assets, 'sample-v1.mp4');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-1/23');
  assert.equal(response.headers.get('Content-Length'), '2');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await responseBytes(response), [0, 1]);
  assert.equal(f.cancelled, true);
});

test('streams correct middle, open and suffix bytes across source chunks', async () => {
  for (const [range, start, end] of [['bytes=5-12', 5, 12], ['bytes=20-', 20, 22], ['bytes=-3', 20, 22]]) {
    const response = await handleMediaRequest(request({ Range: range }), fixture().assets, 'sample-v1.mp4');
    assert.equal(response.status, 206);
    assert.deepEqual(await responseBytes(response), Array.from(bytes.slice(start, end + 1)));
  }
});

test('full GET and HEAD retain full length and do not fabricate partial content', async () => {
  const response = await handleMediaRequest(request(), fixture().assets, 'sample-v1.mp4');
  assert.equal(response.status, 200);
  assert.deepEqual(await responseBytes(response), Array.from(bytes));
  const f = fixture();
  const head = await handleMediaRequest(request({ Range: 'bytes=0-1' }, 'HEAD'), f.assets, 'sample-v1.mp4');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), '23');
  assert.equal(head.headers.get('Content-Range'), null);
  assert.equal(await head.text(), '');
  assert.equal(f.cancelled, true);
});

test('unsatisfiable range returns 416 with current complete size', async () => {
  const f = fixture();
  const response = await handleMediaRequest(request({ Range: 'bytes=23-' }), f.assets, 'sample-v1.mp4');
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('Content-Range'), 'bytes */23');
  assert.equal(await response.text(), '');
  assert.equal(f.cancelled, true);
});

test('If-Range only permits a current strong etag or sufficiently recent date', async () => {
  for (const [value, status] of [['"revision-one"', 206], ['"old"', 200], ['W/"revision-one"', 200], ['Wed, 11 Nov 2026 12:00:00 GMT', 206], ['Tue, 10 Nov 2026 12:00:00 GMT', 200]]) {
    const response = await handleMediaRequest(request({ Range: 'bytes=0-1', 'If-Range': value }), fixture().assets, 'sample-v1.mp4');
    assert.equal(response.status, status);
    await response.body.cancel();
  }
});

test('asset access is limited to a single MP4 path and forwards no private credentials', async () => {
  const f = fixture();
  const response = await handleMediaRequest(request({ Cookie: 'private-session', Authorization: 'Bearer secret', 'X-Service-Authorization': 'Bearer service-secret', Range: 'bytes=0-1' }), f.assets, 'sample-v1.mp4');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, origin + '/sample-v1.mp4');
  assert.deepEqual([...f.calls[0].headers], [['accept-encoding', 'identity']]);
  assert.equal(f.calls[0].redirect, 'manual');
  await response.body.cancel();
  for (const filename of ['../private.mp4', 'nested/video.mp4', 'https://example.com/video.mp4', 'video.mp4?token=secret', 'index.html', '%2e%2e.mp4']) assert.equal((await handleMediaRequest(request(), f.assets, filename)).status, 404);
  assert.equal(f.calls.length, 1);
});

test('binding and upstream failures are bounded with no external fallback', async () => {
  assert.equal((await handleMediaRequest(request(), null, 'video.mp4')).status, 503);
  assert.equal((await handleMediaRequest(request({}, 'POST'), fixture().assets, 'video.mp4')).status, 405);
  for (const [options, status] of [
    [{ status: 404 }, 404], [{ status: 302 }, 502],
    [{ headers: { 'Content-Type': 'text/html' } }, 502],
    [{ headers: { 'Content-Length': 'NaN' } }, 502],
    [{ headers: { 'Content-Length': String(MAX_MEDIA_BYTES + 1) } }, 502],
    [{ headers: { 'Content-Encoding': 'gzip' } }, 502],
  ]) {
    const f = fixture(options);
    assert.equal((await handleMediaRequest(request(), f.assets, 'video.mp4')).status, status);
    if (options.status || Number(options.headers?.['Content-Length']) > MAX_MEDIA_BYTES) assert.equal(f.cancelled, true);
  }
});

test('production ASSETS missing headers or decoded encoding uses actual MP4 bytes and size', async () => {
  const mp4 = new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109,0,0,2,0,1,2,3,4,5,6,7]);
  for (const headers of [
    { 'Content-Length': null },
    { 'Content-Type': null },
    { 'Content-Length': null, 'Content-Type': null },
    { 'Content-Length': '10', 'Content-Encoding': 'gzip' },
    { 'Content-Length': 'NaN', 'Content-Type': 'application/octet-stream' },
  ]) {
    for (const [range, expected, contentRange] of [
      ['bytes=0-1', [0,0], 'bytes 0-1/23'],
      ['bytes=-3', [5,6,7], 'bytes 20-22/23'],
    ]) {
      const f = fixture({ bytes: mp4, headers });
      const response = await handleMediaRequest(request({ Range: range }), f.assets, 'sample-v1.mp4');
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('Content-Range'), contentRange);
      assert.equal(response.headers.get('Content-Length'), String(expected.length));
      assert.equal(response.headers.get('Content-Encoding'), null);
      assert.equal(response.headers.get('Content-Type'), 'video/mp4');
      assert.deepEqual(await responseBytes(response), expected);
    }
    const head = await handleMediaRequest(request({}, 'HEAD'), fixture({ bytes: mp4, headers }).assets, 'sample-v1.mp4');
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('Content-Length'), '23');
    assert.equal(await head.text(), '');
  }
});

test('headerless fallback rejects HTML masquerading as video and caps actual streamed bytes', async () => {
  const fake = fixture({ bytes: new TextEncoder().encode('<html>Not a video</html>'), headers: { 'Content-Length': null } });
  assert.equal((await handleMediaRequest(request(), fake.assets, 'video.mp4')).status, 502);
  let reads = 0, cancelled = false;
  const assets = { async fetch() { return new Response(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  })); } };
  assert.equal((await handleMediaRequest(request(), assets, 'video.mp4')).status, 502);
  assert.equal(cancelled, true);
  assert.ok(reads <= 34);
});
