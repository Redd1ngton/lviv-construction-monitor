const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
class Element{constructor(){this.children=[];this.handlers={};this.value='';}append(...children){this.children.push(...children)}appendChild(child){this.children.push(child)}replaceChildren(...children){this.children=children}addEventListener(name,cb){this.handlers[name]=cb}setAttribute(name,value){this[name]=value}select(){}focus(){}}
const elements={},regions=JSON.parse(fs.readFileSync(__dirname+'/../frontend/regions.json'));let allow=true,copied='',posted=[],watched=[],deny=false;
const byId=id=>elements[id]??=new Element();byId('collection-days').value='7';byId('collection-key').value='test-control-key';
const context={document:{readyState:'complete',getElementById:byId,createElement:()=>new Element(),dispatchEvent(){}},localStorage:{getItem(){return null},setItem(){}},fetch:async(url,options={})=>{
 if(options.method==='POST'){posted.push(JSON.parse(options.body));return {ok:!deny,json:async()=>deny?{message:'GitHub відхилив запуск.'}:{accepted:true,run:{id:42,status:'queued'}}};}
 return {ok:true,json:async()=>url.includes('regions.json')?regions:{configured:true}};
},AbortController,setTimeout,clearTimeout,Event:class{},confirm:()=>allow,navigator:{clipboard:{writeText:async text=>copied=text}},ConstructionApp:{refresh(){}},ParserStatus:{watchRun:run=>watched.push(run)}};context.window=context;
vm.runInNewContext(fs.readFileSync(__dirname+'/../frontend/collection.js','utf8'),context);
(async()=>{await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual([...context.CollectionManager.selectedKeys],['lviv']);
 const input=byId('region-checks').children.flatMap(label=>label.children).find(node=>node.value==='odesa');input.checked=true;input.handlers.change();
 assert.equal(context.CollectionManager.selectedKeys.size,2);
 await byId('collection-copy').handlers.click();assert(copied.includes('odesa'));
 await byId('collection-launch').handlers.click({preventDefault(){}});assert.equal(posted.length,1);assert.deepEqual(posted[0].regions,['lviv','odesa']);assert.equal(watched[0].id,42);assert.equal(byId('collection-launch').disabled,false);
 deny=true;await byId('collection-launch').handlers.click({preventDefault(){}});assert.equal(watched.length,1);assert(byId('collection-message').textContent.includes('відхилив'));
 byId('collection-all').handlers.click();allow=false;const before=posted.length;await byId('collection-launch').handlers.click({preventDefault(){}});assert.equal(posted.length,before,'Unconfirmed country must never be dispatched');
 byId('collection-clear').handlers.click();await byId('collection-launch').handlers.click({preventDefault(){}});assert.equal(posted.length,before,'Empty scope must never be dispatched');
 context.CollectionManager.reset(['odesa']);assert.deepEqual([...context.CollectionManager.selectedKeys],['odesa']);
 console.log('Actual collection request includes selected regions; rejected requests, empty/country scope and watched run verified');
})().catch(error=>{console.error(error);process.exitCode=1});
