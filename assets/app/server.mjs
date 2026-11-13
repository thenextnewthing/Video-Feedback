import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleReviewRequest} from './lib/review-service.mjs';
import {handleDraftRequest} from './lib/draft-service.mjs';
import {parseByteRange} from './lib/media-range.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.join(root,'data'), media=path.join(root,'media');
await fs.mkdir(data,{recursive:true,mode:0o700});await fs.mkdir(media,{recursive:true,mode:0o700});
// This starter is deliberately loopback-only. Do not expose without an authenticated HTTPS proxy.
const port=Number(process.env.PORT||8765);
const origin=process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;
const bucket={
 async get(key){try{const x=JSON.parse(await fs.readFile(path.join(data,key),'utf8'));return {...x,body:x.raw}}catch(e){if(e.code==='ENOENT')return null;throw e}},
 async head(key){return this.get(key)},
 async put(key,raw,opt){const file=path.join(data,key);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});try{await fs.writeFile(file,JSON.stringify({raw,customMetadata:opt.customMetadata}),{flag:'wx',mode:0o600});return {key}}catch(e){if(e.code==='EEXIST')return null;throw e}},
 async list({prefix}){let names;try{names=await fs.readdir(path.join(data,prefix))}catch(e){if(e.code==='ENOENT')names=[];else throw e}const objects=[];for(const name of names.filter(n=>n.endsWith('.json'))){const key=prefix+name;const v=await this.get(key);objects.push({key,customMetadata:v.customMetadata})}return {objects,truncated:false}}
};
const staticFiles=new Set(['review-v2.html','review-v2.js','review-v2.css','stories.json','submit-feedback.js','dictation-session.js','demo-poster.jpg']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg'};
http.createServer(async(req,res)=>{try{
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
 // Validate Host to prevent DNS rebinding; proxy deployments explicitly configure PUBLIC_ORIGIN.
 const allowed=new Set([`127.0.0.1:${port}`,`localhost:${port}`,new URL(origin).host]);
 if(!allowed.has(req.headers.host)){res.writeHead(403,headers);return res.end('Invalid host')}
 const url=new URL(req.url,origin);
 if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403,headers);return res.end('Invalid origin')}
 const api=/^\/api\/(reviews|drafts)(?:\/([^/]+))?$/.exec(url.pathname);
 if(api){const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});const result=await (api[1]==='drafts'?handleDraftRequest:handleReviewRequest)(request,bucket,api[2]);res.writeHead(result.status,{...headers,...Object.fromEntries(result.headers)});return res.end(Buffer.from(await result.arrayBuffer()))}
 const video=/^\/api\/media\/([a-z0-9][a-z0-9-]{0,95}\.mp4)$/.exec(url.pathname);
 if(video&&['GET','HEAD'].includes(req.method)){const f=path.join(media,video[1]);const size=(await fs.stat(f)).size;let range=null;if(req.headers.range){range=parseByteRange(req.headers.range,size);if(!range){res.writeHead(416,{...headers,'Content-Range':`bytes */${size}`});return res.end()}}const start=range?.start||0,end=range?.end??size-1;res.writeHead(range?206:200,{...headers,'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});if(req.method==='HEAD')return res.end();return createReadStream(f,{start,end}).pipe(res)}
 const name=url.pathname==='/'?'review-v2.html':url.pathname.slice(1);if(!staticFiles.has(name)||!['GET','HEAD'].includes(req.method)){res.writeHead(404,headers);return res.end('Not found')}
 const body=await fs.readFile(path.join(root,'public',name));res.writeHead(200,{...headers,'Content-Type':types[path.extname(name)]||'application/octet-stream','Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500,{'Content-Type':'text/plain'});res.end(e.code==='ENOENT'?'File not found':'Unable to complete request')}}).listen(port,'127.0.0.1',()=>console.log(`Review locally at http://127.0.0.1:${port}`));
