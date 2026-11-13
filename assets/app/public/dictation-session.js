// Safari can omit `end` after stop(): bound the shutdown and ignore late events.
export function createDictationSession({Speech,onText,onPreview,onState,onError,schedule=setTimeout,cancel=clearTimeout}){
 let active=null;
 const finish=s=>{if(active!==s)return;active=null;cancel(s.timer);cancel(s.startTimer);if(s.interim.trim())onText(s.interim.trim()+' ');s.interim='';onPreview('');s.r.onresult=s.r.onerror=s.r.onend=s.r.onstart=null;try{s.r.abort()}catch{}onState('idle')};
 return {get active(){return !!active},start(){if(active)return;const r=new Speech(),s={r,interim:'',timer:null,stopping:false};active=s;r.lang='en-US';r.continuous=true;r.interimResults=true;
 r.onresult=e=>{if(active!==s)return;let pending='';for(let i=e.resultIndex;i<e.results.length;i++){const text=e.results[i][0].transcript;if(e.results[i].isFinal)onText(text.trim()+' ');else pending+=text} s.interim=pending;onPreview(pending)};
 r.onstart=()=>{if(active!==s)return;cancel(s.startTimer);onState('listening')};
 r.onend=()=>finish(s);r.onerror=e=>{if(active!==s)return;const deliberate=s.stopping;finish(s);if(!deliberate&&e.error!=='aborted')onError(e)};
 onState('starting');s.startTimer=schedule(()=>{if(active===s){finish(s);onError({error:'start-timeout'})}},6000);try{r.start()}catch(e){finish(s);onError(e)}
 },stop(){const s=active;if(!s)return;if(s.stopping){finish(s);return}s.stopping=true;onState('stopping');s.timer=schedule(()=>finish(s),1200);try{s.r.stop()}catch{finish(s)}},abort(){if(active)finish(active)}}
}
