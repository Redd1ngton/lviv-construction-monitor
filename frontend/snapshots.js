(() => {
  const core=window.DatasetCore;
  let live=null,archives=[],active=new Set(),db=null,storageError='';
  const byId=id=>document.getElementById(id);
  function message(text){byId('snapshot-message').textContent=text;}
  function database(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open('construction-snapshots',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('snapshots',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });}
  function transact(mode,operation){return new Promise((resolve,reject)=>{
    const tx=db.transaction('snapshots',mode),request=operation(tx.objectStore('snapshots'));
    tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}
  async function remember(data,name){
    const parsed=core.parse(data);
    const bytes=new TextEncoder().encode(JSON.stringify(parsed));
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    const id=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    if(archives.some(item=>item.id===id)){active.add(id);return;}
    const entry={...parsed,id,name,saved_at:new Date().toISOString()};
    if(db)try{await transact('readwrite',store=>store.put(entry));}catch(_){storageError='Не вдалося зберегти у браузері. Завантажте JSON на пристрій.';}
    archives.push(entry);active.add(id);
  }
  function draw(){
    const container=byId('snapshot-list');container.replaceChildren();
    for(const entry of archives){
      const row=document.createElement('div');row.className='snapshot-row';
      const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=active.has(entry.id);
      check.addEventListener('change',()=>{check.checked?active.add(entry.id):active.delete(entry.id);apply();});
      const text=document.createElement('span');text.textContent=`${entry.name} · ${entry.items.length} записів · ${entry.updated_at?new Date(entry.updated_at).toLocaleString('uk-UA'):'дата збору невідома'}`;
      label.append(check,text);row.appendChild(label);
      const download=document.createElement('button');download.textContent='Завантажити JSON';download.className='small secondary';download.addEventListener('click',()=>exportFile(entry));row.appendChild(download);
      container.appendChild(row);
    }
    if(!archives.length)container.textContent='Знімків ще немає. Збережіть поточні дані або імпортуйте JSON-файли.';
    const old=byId('snapshot-baseline').value;
    byId('snapshot-baseline').replaceChildren(new Option('Оберіть попередній знімок',''),...archives.map(item=>new Option(item.name,item.id)));
    if(archives.some(item=>item.id===old))byId('snapshot-baseline').value=old;
    byId('snapshot-save').disabled=!live;
  }
  function exportFile(entry){
    const payload={format:'lviv-construction-snapshot/v1',updated_at:entry.updated_at,region:entry.region,count:entry.items.length,items:entry.items};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`construction-snapshot-${(entry.updated_at||new Date().toISOString()).replace(/[^0-9T-]/g,'-')}.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function apply(){
    if(!window.ConstructionApp)return;
    const mode=byId('snapshot-mode').value,baseline=archives.find(item=>item.id===byId('snapshot-baseline').value);
    if(['new','changed'].includes(mode)&&!baseline){window.ConstructionApp.setData([], 'Оберіть попередній знімок для порівняння');message('Оберіть попередній знімок для порівняння.');return;}
    const datasets=mode==='live'?(live?[live]:[]):[...(byId('snapshot-include-live').checked&&live?[live]:[]),...archives.filter(item=>active.has(item.id))];
    const rows=core.combine(datasets,baseline,mode);
    window.ConstructionApp.setData(rows,mode==='live'?'Поточний парсер':`Знімків / джерел: ${datasets.length} · ${mode==='new'?'Лише нові':mode==='changed'?'Змінені':'Усі записи'}`);
    message(`${rows.length} записів · ${baseline?'Порівняння з «'+baseline.name+'»':'Обрано джерел: '+datasets.length}${storageError?' · '+storageError:''}`);
  }
  window.DatasetManager={setLive(data){live=core.parse(data);draw();apply();}};
  async function init(){
    try{db=await database();archives=await transact('readonly',store=>store.getAll());active=new Set(archives.map(item=>item.id));}
    catch(_){storageError='Пам’ять браузера недоступна. Збережіть JSON-файли на пристрій.';}
    draw();
    byId('snapshot-save').addEventListener('click',async()=>{
      if(!live)return;
      byId('snapshot-save').disabled=true;
      try{await remember(live,`Збір ${live.updated_at?new Date(live.updated_at).toLocaleString('uk-UA'):'без дати'}`);draw();exportFile(live);message('Знімок збережено. JSON можна повторно імпортувати пізніше.'+(storageError?' '+storageError:''));}
      catch(_){message('Не вдалося зберегти у браузері. Завантажую JSON на пристрій.');exportFile(live);}
      finally{byId('snapshot-save').disabled=false;}
    });
    byId('snapshot-import').addEventListener('change',async event=>{
      let imported=0,errors=[];
      for(const file of event.target.files){
        try{if(file.size>20*1024*1024)throw Error('файл більший за 20 МБ');await remember(JSON.parse(await file.text()),file.name);imported++;}
        catch(error){errors.push(file.name+': '+error.message);}
      }
      draw();if(imported){byId('snapshot-mode').value='all';apply();}
      message(`Імпортовано: ${imported}${errors.length?' · '+errors.join('; '):''}${storageError?' · '+storageError:''}`);event.target.value='';
    });
    for(const id of ['snapshot-mode','snapshot-baseline','snapshot-include-live'])byId(id).addEventListener('change',apply);
    apply();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
