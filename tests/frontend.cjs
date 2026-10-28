const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const geo=require('../frontend/geo.js');
assert(geo.address({address:'Львівська обл., м. Львів',location_description:'вулиця Шевченка, буд. 12'}).full_address.includes('буд. 12'));
const idx=geo.index(JSON.parse(fs.readFileSync(__dirname+'/../frontend/places.json')).places);
assert.equal(geo.settlement('Львівська обл., Львівський район, с. Скнилів (станом на 01.01.2021)'),'Скнилів');
assert.equal(geo.locate({settlement:'Скнилів',district:'Львівський'},idx).lon,23.95);
assert.equal(geo.locate({settlement:'Скнилів',district:''},idx),null,'Duplicate village names require district');
class Element {
 constructor(){this.value='';this.textContent='';this.style={};this.children=[];this.handlers={};this.dataset={};this.hidden=false;}
 appendChild(child){this.children.push(child);return child;}
 replaceChildren(...children){this.children=children;}
 addEventListener(name,callback){this.handlers[name]=callback;}
 querySelector(){return new Element();}
 set innerHTML(value){this.html=value;}
 get innerHTML(){return this.html||'';}
 scrollIntoView(){}
 setAttribute(name,value){this[name]=value;}
 get options(){return this.children;}
}
const elements={},listeners={},groups=[];let polylineCount=0;
const byId=id=>elements[id]??=new Element();
const group=()=>{const x={layers:[],addTo(){return this},clearLayers(){this.layers=[]},addLayer(m){this.layers.push(m)},eachLayer(cb){this.layers.forEach(cb)}};groups.push(x);return x;};
const fixtures=[
 {doc_number:'one',reg_date:'2026-10-22',address:'Львівська обл., Львівський район, с. Скнилів',object_name:'Нове будівництво житлового будинку',doc_type:'Повідомлення',lat:null,lon:null},
 {doc_number:'two',reg_date:'2026-10-21',address:'Львівська обл., Львівський район, с. Скнилів',object_name:'Будівництво складу',doc_type:'Дозвіл',lat:null,lon:null},
 {doc_number:'three',reg_date:'2026-10-20',address:'Львівська обл., Львівський район, м. Львів',object_name:'Будівництво магазину',doc_type:'Дозвіл',lat:49.84,lon:24.03},
];
const context={ConstructionGeo:geo,Option:function(text,value){this.text=text;this.value=value},localStorage:{getItem(){return null},setItem(){}},document:{readyState:'loading',getElementById:byId,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener:(name,cb)=>listeners[name]=cb},AbortController,setTimeout,clearTimeout,URL,URLSearchParams,console,alert(){},fetch:async url=>({ok:true,json:async()=>url.includes('regions.json')?JSON.parse(fs.readFileSync(__dirname+'/../frontend/regions.json')):url.includes('/places/')?JSON.parse(fs.readFileSync(__dirname+'/../frontend/places/lviv.json')):{items:fixtures}}),L:{map:()=>({setView(){return this},on(){},fitBounds(){}}),tileLayer:()=>({addTo(){}}),layerGroup:group,divIcon:x=>x,marker:(p)=>({bindPopup(){return this},getLatLng(){return {lat:p[0],lng:p[1]}},openPopup(){}}),polyline:()=>({addTo(){polylineCount++}})}};
context.window=context;
vm.createContext(context);
let appSource=fs.readFileSync(__dirname+'/../frontend/app.js','utf8').replace("if(document.readyState==='loading')","window.testEval=code=>eval(code); if(document.readyState==='loading')");
vm.runInContext(appSource,context);
const call=code=>vm.runInContext('testEval('+JSON.stringify(code)+')',context);
(async()=>{
 listeners.DOMContentLoaded();await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(groups[0].layers.length,2,'Objects at the same place form one marker');
 byId('filter-town').value='Скнилів';call('refresh()');
 assert.equal(call('filteredItems().length'),2);
 byId('filter-category').value='Склади / логістика';call('refresh()');
 assert.equal(call('filteredItems()[0].doc_number'),'two');
 byId('filter-category').value='';call("toggleSelection('one',true);toggleSelection('two',true);onBuildRoute()");
 assert.equal(byId('btn-route').disabled,false);assert.equal(polylineCount,1);
 assert(byId('route-panel').innerHTML.includes('частина точок приблизна'));
 byId('filter-town').value='Львів';call('refresh()');assert.equal(byId('btn-route').disabled,false,'Stops retained across filters and tabs');
 call("startPin(items[2])");byId('pin-lat').value='49.85';byId('pin-lon').value='24.04';
 call('savePin({preventDefault(){}})');assert.equal(call('items[2].coord_source'),'manual');
 const late={...context,document:{...context.document,readyState:'complete'}};late.window=late;late.L=undefined;vm.createContext(late);vm.runInContext(appSource,late);await new Promise(resolve=>setTimeout(resolve,20));assert(late.ConstructionApp,'App starts after DOMContentLoaded as well');
 await byId('btn-force-refresh').handlers.click();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(byId('btn-force-refresh').disabled,false);assert(byId('data-refresh-message').textContent.includes('Дані оновлено'));
 const oldFetch=late.fetch;late.fetch=async()=>{throw Error('offline')};late.console={...console,warn(){}};await byId('btn-force-refresh').handlers.click();assert.equal(byId('btn-force-refresh').disabled,false);assert(byId('data-refresh-message').textContent.includes('Попередні дані'));late.fetch=oldFetch;
 console.log('Settlement matching, filters, cross-tab route selection and manual pin: passed');
})().catch(error=>{console.error(error);process.exitCode=1});
