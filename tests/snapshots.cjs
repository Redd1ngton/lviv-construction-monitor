const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');const core=require('../frontend/datasets.js');
class Element{constructor(){this.value='';this.children=[];this.handlers={};this.checked=false;}replaceChildren(...children){this.children=children;}appendChild(child){this.children.push(child);}append(...children){this.children.push(...children);}addEventListener(name,cb){this.handlers[name]=cb;}click(){}}
const elements={},byId=id=>elements[id]??=new Element();let displayed=[];
byId('snapshot-mode').value='live';byId('snapshot-include-live').checked=true;
const context={DatasetCore:core,crypto:webcrypto,TextEncoder,Blob,URL,Option:function(text,value){this.textContent=text;this.value=value;},document:{readyState:'complete',getElementById:byId,createElement:()=>new Element()},ConstructionApp:{setData(rows){displayed=rows;}},setTimeout(callback){callback();}};context.window=context;
vm.runInNewContext(fs.readFileSync(__dirname+'/../frontend/snapshots.js','utf8'),context);
(async()=>{await new Promise(setImmediate);
 const live={updated_at:'2026-10-23',items:[{doc_number:'A',status:'Змінено'},{doc_number:'B',status:'Діючий'}]};
 context.DatasetManager.setLive(live);assert.equal(byId('snapshot-save').disabled,false);await byId('snapshot-save').handlers.click();
 const old={updated_at:'2026-10-16',items:[{doc_number:'A',status:'Діючий'}]};
 const files=[{name:'old.json',size:50,text:async()=>JSON.stringify(old)},{name:'new.json',size:50,text:async()=>JSON.stringify(live)}];
 await byId('snapshot-import').handlers.change({target:{files,value:'files'}});
 assert.equal(displayed.length,2);assert.equal(byId('snapshot-mode').value,'all');
 const baseline=byId('snapshot-baseline').children.find(option=>option.textContent==='old.json');assert(baseline);
 byId('snapshot-baseline').value=baseline.value;byId('snapshot-mode').value='new';byId('snapshot-mode').handlers.change();assert.deepEqual(displayed.map(x=>x.doc_number),['B']);
 byId('snapshot-mode').value='changed';byId('snapshot-mode').handlers.change();assert.deepEqual(displayed.map(x=>x.doc_number),['A']);
 console.log('Snapshot save/export, multiple imports and comparison UI with unavailable browser storage: passed');
})().catch(error=>{console.error(error);process.exitCode=1});
