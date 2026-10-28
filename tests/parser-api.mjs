import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync(new URL('../functions/api/parser.js',import.meta.url),'utf8');
const regions=JSON.parse(fs.readFileSync(new URL('../frontend/regions.json',import.meta.url)));
source=source.replace("import regions from '../../frontend/regions.json';",'const regions='+JSON.stringify(regions)+';');
const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const env={GITHUB_TOKEN:'test-github-server-token',PARSER_ADMIN_KEY:'test-control-key-01234567890123456789'};
let calls=[],mode='ok';const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{calls.push({url,options});
 if(url.includes('/dispatches'))return mode==='denied'?new Response('{}',{status:403}):Response.json({workflow_run_id:42,html_url:'https://github.com/Redd1ngton/lviv-construction-monitor/actions/runs/42'});
 return Response.json({workflow_runs:mode==='busy'?[{id:11,status:'pending'}]:mode==='lookup'?[{id:42,status:'in_progress',display_title:'Збір 12345678-1234-1234-1234-123456789abc'}]:[]});};
const post=(body,overrides={})=>onRequest({env:overrides.env||env,request:new Request('https://example.pages.dev/api/parser',{method:'POST',headers:{Origin:overrides.origin||'https://example.pages.dev','Content-Type':'application/json',Authorization:'Bearer '+(overrides.key??env.PARSER_ADMIN_KEY)},body:JSON.stringify(body)})});
try{
 assert.equal((await post({regions:['odesa']},{env:{}})).status,503);
 assert.equal((await post({regions:['odesa']},{key:'wrong'})).status,401);assert.equal(calls.length,0);
 assert.equal((await post({regions:['odesa']},{origin:'https://other.example'})).status,403);
 assert.equal((await post({regions:['unknown']})).status,400);
 assert.equal((await post({regions:Object.keys(regions),confirm_country:false})).status,400);assert.equal(calls.length,0);
 let response=await post({regions:['odesa','kyiv-oblast'],days:14});assert.equal(response.status,202);
 let payload=await response.json();assert.equal(payload.run.id,42);assert(!JSON.stringify(payload).includes(env.GITHUB_TOKEN));
 let dispatch=JSON.parse(calls.find(call=>call.url.includes('/dispatches')).options.body);assert.equal(dispatch.inputs.regions,'odesa,kyiv-oblast');assert.equal(dispatch.inputs.days,'14');assert.equal(dispatch.inputs.confirm_country,'false');assert.equal(dispatch.ref,'main');assert.match(dispatch.inputs.request_id,/^[a-f0-9-]{36}$/);
 calls=[];mode='busy';assert.equal((await post({regions:['odesa']})).status,409);assert.equal(calls.length,1);
 calls=[];mode='denied';response=await post({regions:['odesa']});assert.equal(response.status,502);assert.equal((await response.json()).error,'DISPATCH_FAILED');
 mode='lookup';response=await onRequest({env,request:new Request('https://example.pages.dev/api/parser?action=request&id=12345678-1234-1234-1234-123456789abc')});assert.equal((await response.json()).run.id,42);
 console.log('Parser API: scoped dispatch, authentication, country confirmation, queue, denied dispatch and request tracking passed');
}finally{globalThis.fetch=originalFetch;}
