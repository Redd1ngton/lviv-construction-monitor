const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
class Element{constructor(){this.children=[];this.handlers={};this.value='';}append(...children){this.children.push(...children)}appendChild(child){this.children.push(child)}replaceChildren(...children){this.children=children}addEventListener(name,cb){this.handlers[name]=cb}setAttribute(name,value){this[name]=value}select(){}}
const elements={},regions=JSON.parse(fs.readFileSync(__dirname+'/../frontend/regions.json'));let allow=true,copied='';
const byId=id=>elements[id]??=new Element();
const context={document:{readyState:'complete',getElementById:byId,createElement:()=>new Element(),dispatchEvent(){}},localStorage:{getItem(){return null},setItem(){}},fetch:async()=>({ok:true,json:async()=>regions}),Event:class{},confirm:()=>allow,navigator:{clipboard:{writeText:async text=>copied=text}},ConstructionApp:{refresh(){}}};context.window=context;
vm.runInNewContext(fs.readFileSync(__dirname+'/../frontend/collection.js','utf8'),context);
(async()=>{await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual([...context.CollectionManager.selectedKeys],['lviv']);
 const input=byId('region-checks').children.flatMap(label=>label.children).find(node=>node.value==='odesa');input.checked=true;input.handlers.change();
 assert.equal(context.CollectionManager.selectedKeys.size,2);assert(byId('collection-codes').value.includes('odesa'));
 await byId('collection-copy').handlers.click();assert(copied.includes('odesa'));
 byId('collection-all').handlers.click();assert.equal(context.CollectionManager.selectedKeys.size,Object.keys(regions).length);
 allow=false;let prevented=false;byId('collection-launch').handlers.click({preventDefault(){prevented=true}});assert(prevented,'Country launch must ask before proceeding');
 byId('collection-clear').handlers.click();prevented=false;byId('collection-launch').handlers.click({preventDefault(){prevented=true}});assert(prevented,'Empty selection cannot launch');
 console.log('Region checkboxes, saved default, copying scope and whole-country confirmation: passed');
})().catch(error=>{console.error(error);process.exitCode=1});
