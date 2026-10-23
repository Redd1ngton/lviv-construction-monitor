const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const geo=require('../frontend/geo.js');
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
}
const elements={},listeners={},groups=[];let polylineCount=0;
const byId=id=>elements[id]??=new Element();
const group=()=>{const x={layers:[],addTo(){return this},clearLayers(){this.layers=[]},addLayer(m){this.layers.push(m)},eachLayer(cb){this.layers.forEach(cb)}};groups.push(x);return x;};
const fixtures=[
 {doc_number:'one',reg_date:'2026-10-22',address:'Львівська обл., Львівський район, с. Скнилів',object_name:'Нове будівництво житлового будинку',doc_type:'Повідомлення',lat:null,lon:null},
 {doc_number:'two',reg_date:'2026-10-21',address:'Львівська обл., Львівський район, с. Скнилів',object_name:'Будівництво складу',doc_type:'Дозвіл',lat:null,lon:null},
 {doc_number:'three',reg_date:'2026-10-20',address:'Львівська обл., Львівський район, м. Львів',object_name:'Будівництво магазину',doc_type:'Дозвіл',lat:49.84,lon:24.03},
];
const context={ConstructionGeo:geo,Option:function(text,value){this.text=text;this.value=value},localStorage:{getItem(){return null},setItem(){}},document:{getElementById:byId,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener:(name,cb)=>listeners[name]=cb},AbortController,setTimeout,clearTimeout,URL,URLSearchParams,console,alert(){},fetch:async url=>({ok:true,json:async()=>url.includes('places.json')?JSON.parse(fs.readFileSync(__dirname+'/../frontend/places.json')):{items:fixtures}}),L:{map:()=>({setView(){return this},on(){},fitBounds(){}}),tileLayer:()=>({addTo(){}}),layerGroup:group,divIcon:x=>x,marker:(p)=>({bindPopup(){return this},getLatLng(){return {lat:p[0],lng:p[1]}},openPopup(){}}),polyline:()=>({addTo(){polylineCount++}})}};
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../frontend/app.js','utf8'),context);
(async()=>{
 listeners.DOMContentLoaded();await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(groups[0].layers.length,2,'Objects at the same place form one marker');
 byId('filter-town').value='Скнилів';vm.runInContext('refresh()',context);
 assert.equal(vm.runInContext('filteredItems().length',context),2);
 byId('filter-category').value='Склади / логістика';vm.runInContext('refresh()',context);
 assert.equal(vm.runInContext('filteredItems()[0].doc_number',context),'two');
 byId('filter-category').value='';vm.runInContext("toggleSelection('one',true);toggleSelection('two',true);onBuildRoute()",context);
 assert.equal(byId('btn-route').disabled,false);assert.equal(polylineCount,1);
 assert(byId('route-panel').innerHTML.includes('центри населених пунктів'));
 byId('filter-town').value='Львів';vm.runInContext('refresh()',context);assert.equal(byId('btn-route').disabled,true,'Hidden stops removed');
 vm.runInContext("startPin(items[2])",context);byId('pin-lat').value='49.85';byId('pin-lon').value='24.04';
 vm.runInContext('savePin({preventDefault(){}})',context);assert.equal(vm.runInContext('items[2].coord_source',context),'manual');
 console.log('Settlement matching, filters, markers, route, hidden selection and manual pin: passed');
})().catch(error=>{console.error(error);process.exitCode=1});
