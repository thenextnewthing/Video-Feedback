import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
test('local server saves and retrieves drafts, blocks cross-origin writes and serves exact seek bytes',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'review-test-'));const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 await cp(root,dir,{recursive:true,filter:s=>!['data','media'].some(n=>s===path.join(root,n)||s.startsWith(path.join(root,n)+'/'))});
 await mkdir(path.join(dir,'media'));await writeFile(path.join(dir,'media','sample.mp4'),Buffer.from('0123456789'));
 const port=19000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
 const realFetch=globalThis.fetch; const fetch=(url,opts={})=>realFetch(url,{...opts,signal:AbortSignal.timeout(3000)});
 const child=spawn(process.execPath,['server.mjs'],{cwd:dir,stdio:['ignore','pipe','inherit'],env:{...process.env,PORT:String(port)}});
 try{await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error(`server exit ${c}`)));setTimeout(()=>reject(Error('startup timeout')),5000).unref()});
 assert.equal((await fetch(base)).status,200);
 const id='12345678-1234-4123-8123-123456789abc',body=JSON.stringify({format:'video-review-room',schemaVersion:1,video:{id:'sample-v1',title:'Sample'},notes:[],overallFeedback:'Keep this moment',finished:false,completionMeaning:'finished-no-more-editing'});
 const opts={method:'PUT',headers:{'Content-Type':'application/json',Origin:base},body};
 assert.equal((await fetch(`${base}/api/drafts/${id}`,opts)).status,201);
 assert.equal((await (await fetch(`${base}/api/drafts/${id}`)).json()).overallFeedback,'Keep this moment');
 assert.equal((await (await fetch(`${base}/api/reviews`)).json()).reviews.length,0);
 assert.equal((await fetch(`${base}/api/drafts/${id}`,opts)).status,200);
 assert.equal((await fetch(`${base}/api/drafts/${id}`,{...opts,headers:{...opts.headers,Origin:'https://other.test'}})).status,403);
 const seek=await fetch(`${base}/api/media/sample.mp4`,{headers:{Range:'bytes=2-5'}});assert.equal(seek.status,206);assert.equal(await seek.text(),'2345');
 assert.equal((await fetch(`${base}/data/drafts/${id}.json`)).status,404);
 }finally{const exited=new Promise(r=>child.once('exit',r));child.kill();if(child.exitCode===null)await exited;await rm(dir,{recursive:true,force:true})}
});
