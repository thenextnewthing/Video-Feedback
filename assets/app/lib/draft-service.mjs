import {handleReviewRequest} from './review-service.mjs';
// Draft snapshots are immutable, separate from submitted reviews, and stay owner-private.
export async function handleDraftRequest(request,bucket,id){
 if(!bucket)return Response.json({error:'Private draft storage is unavailable.'},{status:503});
 const map=k=>k.replace(/^reviews\//,'drafts/');
 const proxy={
  list:async options=>{const p=await bucket.list({...options,prefix:map(options.prefix)});return {...p,objects:p.objects.map(o=>({...o,key:o.key.replace(/^drafts\//,'reviews/')}))}},
  get:key=>bucket.get(map(key)), head:key=>bucket.head(map(key)),
  put:(key,value,options)=>bucket.put(map(key),value,{...options,customMetadata:{...options.customMetadata,submissionState:'draft'}})
 };
 return handleReviewRequest(request,proxy,id);
}
