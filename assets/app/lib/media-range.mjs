// Single-range MP4 serving for Safari's byte probes and seek requests.
// The caller must pass the same Site's internal static-asset binding. Never use
// an external fetcher or forward a visitor's cookies/authorization to a URL.
export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const SAFE_FILENAME = /^[a-z0-9][a-z0-9-]{0,95}\.mp4$/;
const BASE_HEADERS = {
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function parseByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size < 1) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function ifRangeMatches(value, headers) {
  if (!value) return true;
  if (value.startsWith('"')) return value === headers.get('ETag');
  if (value.startsWith('W/')) return false;
  const limit = Date.parse(value);
  const modified = Date.parse(headers.get('Last-Modified') || '');
  return Number.isFinite(limit) && Number.isFinite(modified) && modified <= limit;
}

function sliceStream(body, start, end) {
  const reader = body.getReader();
  let offset = 0;
  let complete = false;
  return new ReadableStream({
    async pull(controller) {
      try {
        while (!complete) {
          const { done, value } = await reader.read();
          if (complete) return;
          if (done) {
            complete = true;
            controller.error(new Error('Media ended before the requested byte range.'));
            return;
          }
          const nextOffset = offset + value.byteLength;
          const from = Math.max(start - offset, 0);
          const to = Math.min(end + 1 - offset, value.byteLength);
          offset = nextOffset;
          if (to > from) controller.enqueue(value.subarray(from, to));
          if (offset > end) {
            complete = true;
            controller.close();
            await reader.cancel().catch(() => {});
            return;
          }
          if (to > from) return;
        }
      } catch (error) {
        complete = true;
        controller.error(error);
        await reader.cancel().catch(() => {});
      }
    },
    async cancel(reason) { complete = true; await reader.cancel(reason); },
  });
}

function failure(message, status, headers = {}) {
  return new Response(message, { status, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
}

async function boundedMediaBody(body) {
  if (!body) throw new Error('Missing media body.');
  const reader = body.getReader();
  const chunks = [];
  const prefix = new Uint8Array(12);
  let prefixLength = 0;
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MEDIA_BYTES) throw new Error('Media exceeds the playback limit.');
      if (prefixLength < prefix.length) {
        const count = Math.min(value.byteLength, prefix.length - prefixLength);
        prefix.set(value.subarray(0, count), prefixLength);
        prefixLength += count;
      }
      chunks.push(value);
    }
    const boxSize = new DataView(prefix.buffer).getUint32(0);
    if (prefixLength < 12 || prefix[4] !== 102 || prefix[5] !== 116 || prefix[6] !== 121 || prefix[7] !== 112 || boxSize < 16 || boxSize > size) {
      throw new Error('Media does not have an MP4 ftyp header.');
    }
  } catch (error) {
    chunks.length = 0;
    await reader.cancel().catch(() => {});
    throw error;
  }
  // Retain chunks, not a second concatenated copy of the whole video. Entries
  // are released as the response consumes or cancels this bounded stream.
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index === chunks.length) { chunks.length = 0; controller.close(); return; }
      const chunk = chunks[index];
      chunks[index++] = null;
      controller.enqueue(chunk);
    },
    cancel() { chunks.length = 0; },
  });
  return { size, body: stream };
}

export async function handleMediaRequest(request, assets, filename) {
  if (!['GET', 'HEAD'].includes(request.method)) return failure('Method not allowed.', 405, { Allow: 'GET, HEAD' });
  if (!SAFE_FILENAME.test(filename)) return failure('Video not found.', 404);
  if (!assets || typeof assets.fetch !== 'function') return failure('Private video playback is temporarily unavailable.', 503);

  // Fetch from the internal binding, not through the public Site/auth redirect.
  // Request a full object because the published static path may ignore Range.
  const source = await assets.fetch(new Request(new URL('/' + filename, request.url), { method: 'GET', headers: { 'Accept-Encoding': 'identity' }, redirect: 'manual' }));
  if (source.status !== 200) {
    await source.body?.cancel();
    return failure('Video not found.', source.status === 404 ? 404 : 502);
  }
  const length = source.headers.get('Content-Length');
  let size = length && /^\d+$/.test(length) ? Number(length) : NaN;
  let body = source.body;
  if (size > MAX_MEDIA_BYTES) {
    await source.body?.cancel();
    return failure('Video is not available in a supported format.', 502);
  }
  const encoding = source.headers.get('Content-Encoding');
  if (!Number.isSafeInteger(size) || size <= 0 || !/^video\/mp4(?:;|$)/i.test(source.headers.get('Content-Type') || '') || (encoding && encoding !== 'identity')) {
    // Hosted ASSETS can omit length/type or retain an encoding header after
    // decoding. Inspect the delivered bytes, bound memory, and use actual size.
    try { ({ size, body } = await boundedMediaBody(body)); }
    catch { return failure('Video is not available in a supported format.', 502); }
  }
  const headers = new Headers({ ...BASE_HEADERS, 'Content-Type': 'video/mp4', 'Content-Length': String(size) });
  for (const key of ['ETag', 'Last-Modified']) if (source.headers.has(key)) headers.set(key, source.headers.get(key));
  if (request.method === 'HEAD') {
    await body?.cancel();
    return new Response(null, { status: 200, headers });
  }
  if (!body) return failure('Video is unavailable.', 502);
  const requested = request.headers.get('Range');
  if (!requested || !ifRangeMatches(request.headers.get('If-Range'), source.headers)) return new Response(body, { status: 200, headers });
  const range = parseByteRange(requested, size);
  if (!range) {
    await body.cancel();
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Length', String(range.end - range.start + 1));
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  return new Response(sliceStream(body, range.start, range.end), { status: 206, headers });
}
