export const feedbackContent=s=>JSON.stringify({text:(s?.overallFeedback||'').trim(),notes:s?.notes||[],finished:!!s?.finished});
// Only a newer, meaningful change for a current cut is outstanding.
export function outstanding(candidates,submitted){
 const latest=candidates.filter(s=>s?.dirty).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0];
 if(!latest)return null;
 if(submitted){if((latest.updatedAt||'')<=(submitted.updatedAt||'')||feedbackContent(latest)===feedbackContent(submitted))return null;}
 else if(!(latest.overallFeedback||'').trim()&&!latest.notes?.length&&!latest.finished)return null;
 return latest;
}
export async function submitBatch(items,send){const sent=[],failed=[];for(const item of items){try{sent.push({item,receipt:await send(item)})}catch(error){failed.push({item,error})}}return {sent,failed};}
