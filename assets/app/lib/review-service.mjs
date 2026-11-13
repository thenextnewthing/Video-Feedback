const MAX_BYTES = 20 * 1024 * 1024;
export const validReceipt = id => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
const respond = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
export function validateReview(review) {
  if (review?.format !== 'video-review-room' || review.schemaVersion !== 1 || !review.video?.id || !review.video?.title || !Array.isArray(review.notes) || review.notes.length > 2000) throw new Error('This review file is not valid.');
  if (review.overallFeedback != null && (typeof review.overallFeedback !== 'string' || review.overallFeedback.length > 100000)) throw new Error('Overall feedback must be text under 100,000 characters.');
  if (review.finished !== undefined && typeof review.finished !== 'boolean') throw new Error('The finished value is not valid.');
  if (review.finished !== undefined && review.completionMeaning !== 'finished-no-more-editing') throw new Error('The finished status meaning is not valid.');
  if (review.readyForEditing !== undefined && typeof review.readyForEditing !== 'boolean') throw new Error('The ready-for-editing value is not valid.');
  if (!review.notes.length && !review.unsentTextDraft?.trim() && !review.overallFeedback?.trim() && typeof review.readyForEditing !== 'boolean' && typeof review.finished !== 'boolean') throw new Error('Add feedback or a finished status before sending.');
  for (const note of review.notes) {
    if (!['text', 'voice'].includes(note.type) || !Number.isFinite(note.anchor?.start) || note.anchor.start < 0) throw new Error('A note is missing its video timestamp.');
    if (note.type === 'text' && typeof note.text !== 'string') throw new Error('A written note is incomplete.');
    if (note.type === 'voice' && (note.audio?.encoding !== 'base64' || typeof note.audio.data !== 'string' || !note.audio.data.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(note.audio.data) || note.audio.data.length % 4 || !/^audio\//.test(note.audio.mimeType))) throw new Error('A voice recording could not be included. Your local notes are unchanged.');
  }
  return review;
}
export async function handleReviewRequest(request, bucket, id) {
  if (!bucket) return respond({error:'Private feedback storage is unavailable. Save the complete review file instead.'}, 503);
  if (id && !validReceipt(id)) return respond({error:'Invalid receipt.'}, 400);
  if (request.method === 'GET' && !id) {
    const objects = []; let cursor;
    do {
      const page = await bucket.list({prefix:'reviews/', limit:1000, include:['customMetadata'], ...(cursor ? {cursor} : {})});
      objects.push(...page.objects); cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    const reviews = objects.map(item => ({id:item.key.slice(8,-5), ...item.customMetadata})).sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
    return respond({reviews, truncated:false});
  }
  const key = `reviews/${id}.json`;
  if (request.method === 'GET') {
    const item = await bucket.get(key);
    return item ? new Response(item.body, {headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}) : respond({error:'Review not found.'},404);
  }
  if (request.method !== 'PUT' || !id) return respond({error:'Method not allowed.'},405);
  const origin = request.headers.get('Origin');
  const localOrigin = new URL(request.url).origin;
  if (origin && origin !== localOrigin) return respond({error:'Please send from your private review page.'},403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return respond({error:'Use a complete review file.'},415);
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return respond({error:'This review is larger than 20 MB. Save the complete review file instead.'},413);
  let raw, review;
  try {
    const reader = request.body?.getReader();
    const chunks = []; let size = 0;
    if (!reader) return respond({error:'No review was received.'},400);
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) {await reader.cancel(); return respond({error:'This review is larger than 20 MB. Save the complete review file instead.'},413);} chunks.push(value); }
    raw = await new Blob(chunks).text(); review = validateReview(JSON.parse(raw));
  } catch (error) { return respond({error:error.message || 'Could not read this review.'},422); }
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const existing = await bucket.head(key);
  if (existing) return existing.customMetadata?.checksum === checksum ? respond({id,...existing.customMetadata,duplicate:true}) : respond({error:'This receipt already belongs to another review. Your local notes are unchanged.'},409);
  const metadata = {checksum,savedAt:new Date().toISOString(),videoId:review.video.id,title:review.video.title.slice(0,300),notes:String(review.notes.length),voiceNotes:String(review.notes.filter(n=>n.type==='voice').length),drafts:String(Boolean(review.unsentTextDraft?.trim()) ? 1 : 0),overallFeedback:String(Boolean(review.overallFeedback?.trim())),...(typeof review.readyForEditing === 'boolean' ? {readyForEditing:String(review.readyForEditing)} : {}),...(typeof review.finished === 'boolean' ? {finished:String(review.finished),completionMeaning:'finished-no-more-editing'} : {}),bytes:String(new TextEncoder().encode(raw).length)};
  const stored = await bucket.put(key, raw, {httpMetadata:{contentType:'application/json'},customMetadata:metadata,onlyIf:{etagDoesNotMatch:'*'}});
  if (!stored) { const retry = await bucket.head(key); return retry?.customMetadata?.checksum === checksum ? respond({id,...retry.customMetadata,duplicate:true}) : respond({error:'Another save used this receipt. Your local notes are unchanged.'},409); }
  return respond({id,...metadata},201);
}
