const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
class Element{constructor(){this.dataset={};this.options=[];this.value='';this.handlers={};}addEventListener(n,cb){this.handlers[n]=cb}replaceChildren(...children){this.children=children}setAttribute(n,v){this[n]=v}removeAttribute(n){delete this[n]}}
const elements={},byId=id=>elements[id]??=new Element();byId('filter-region').value='lviv';let reloads=0,offline=false;
const run={id:123,run_attempt:1,run_number:4,status:'in_progress',created_at:new Date().toISOString(),run_started_at:new Date().toISOString(),path:'.github/workflows/daily-scrape.yml',html_url:'https://github.com/Redd1ngton/lviv-construction-monitor/actions/runs/123'};
const queued={...run,id:999,status:'queued',html_url:'https://github.com/Redd1ngton/lviv-construction-monitor/actions/runs/999'};
const hb={run_id:'123',stage:'details',processed:3,total:10,accepted:2,page:1,updated_at:new Date().toISOString()};
const region={name:'scrape (lviv)',status:'completed',conclusion:'success',steps:[]};const publish={name:'publish',status:'queued',conclusion:null};
const context={document:{hidden:false,getElementById:byId,createElement:()=>new Element(),addEventListener(){}},AbortController,setTimeout,clearTimeout,setInterval(){},Date,ConstructionApp:{reload:async options=>{assert(options.automatic);reloads++;return true;}},fetch:async url=>{if(offline)throw Error('offline');return {ok:true,json:async()=>url.includes('raw.githubusercontent')?hb:url.includes('/jobs?')?{jobs:[region,publish]}:{workflow_runs:[queued,run]}}}};context.window=context;
vm.runInNewContext(fs.readFileSync(__dirname+'/../frontend/status.js','utf8'),context);
(async()=>{await new Promise(resolve=>setTimeout(resolve,20));assert(byId('parser-state').textContent.includes('працює'));assert(byId('parser-detail').textContent.includes('Оброблено: 3'));assert.equal(byId('parser-steps').children[3].dataset.state,'active');
 hb.stage='publishing';publish.status='in_progress';await context.ParserStatus.refresh(true);assert(byId('parser-state').textContent.includes('Публікація'));assert.equal(reloads,0);
 publish.status='completed';publish.conclusion='success';await context.ParserStatus.refresh(true);assert(byId('parser-state').textContent.includes('опубліковано'));assert.equal(reloads,1);await context.ParserStatus.refresh(true);assert.equal(reloads,1,'Do not reload repeatedly for one successful publication');
 publish.status='queued';publish.conclusion=null;region.conclusion='failure';hb.stage='failure';await context.ParserStatus.refresh(true);assert(byId('parser-state').textContent.includes('Помилка'));
 hb.stage='details';await context.ParserStatus.refresh(true);assert.equal(byId('parser-steps').children[3].dataset.state,'failure','Terminal GitHub failure overrides older heartbeat');assert.equal(byId('parser-steps').children[4].dataset.state,'pending');assert(!byId('parser-detail').textContent.includes('Обробка карток'));
 context.ParserStatus.watchRun(queued);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(byId('parser-run').href,queued.html_url,'Follow requested queued run instead of another active run');
 offline=true;await context.ParserStatus.refresh(true);assert.equal(byId('parser-refresh').disabled,false);assert(byId('parser-detail').textContent.includes('тимчасово недоступний'));
 console.log('Live heartbeat, publication phase, one-time automatic reload, failures and network recovery: passed');
})().catch(error=>{console.error(error);process.exitCode=1});
