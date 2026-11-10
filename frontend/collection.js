(() => {
  const $=id=>document.getElementById(id);
  let regions={},selected=new Set(['lviv']),running=false;
  try{const saved=JSON.parse(localStorage.getItem('construction-regions-v1'));if(Array.isArray(saved))selected=new Set(saved);}catch(_){}
  const manager={get selectedKeys(){return selected;},reset(keys=['lviv']){selected=new Set(keys.filter(k=>k in regions));draw();}};
  window.CollectionManager=manager;
  function draw(){
    $('region-checks').replaceChildren();
    for(const [key,name] of Object.entries(regions).sort((a,b)=>a[1].localeCompare(b[1],'uk'))){
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=selected.has(key);input.disabled=running;
      input.addEventListener('change',()=>{input.checked?selected.add(key):selected.delete(key);draw();});
      label.append(input,document.createTextNode(name));$('region-checks').appendChild(label);
    }
    $('collection-count').textContent=`Обрано областей: ${selected.size}`;
    try{localStorage.setItem('construction-regions-v1',JSON.stringify([...selected]));}catch(_){}
    document.dispatchEvent(new Event('collection-change'));
  }
  function diagnose(error,context){
    const panel=$('collection-diagnostics'),entry=document.createElement('div');
    entry.className='collection-panel';
    const title=document.createElement('strong');title.textContent=context;
    const reason=document.createElement('p');reason.textContent=error.message;
    const advice=document.createElement('p');advice.textContent=error.advice||'Не вдалося розпізнати відповідь реєстру. Потрібно перевірити формат сторінки; зміна фільтрів може не допомогти.';
    entry.append(title,reason,advice);
    if(error.source_url){const link=document.createElement('a');link.href=error.source_url;link.target='_blank';link.rel='noopener';link.textContent='Відкрити запит у реєстрі';entry.appendChild(link);}
    panel.appendChild(entry);
  }
  async function api(params){
    let lastError;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await fetch('/api/parser?'+new URLSearchParams(params),{cache:'no-store',signal:AbortSignal.timeout(35000)});
        let data;try{data=await response.json();}catch(_){throw Error('Сервер пошуку повернув некоректну відповідь.');}
        if(response.ok)return data;
        const error=Error(data.message||'Помилка реєстру.');
        error.retryable=data.retryable??(response.status===429||response.status>=500);error.code=data.code;error.advice=data.advice;error.source_url=data.source_url;throw error;
      }catch(error){lastError=error;if(!error.advice)error.advice='Перевірте інтернет-з’єднання. Якщо сайт доступний, повторіть пошук пізніше: сервер або реєстр міг не відповісти вчасно.';if(error.retryable===false)throw error;}
      if(attempt<2){
        $('collection-message').textContent=`Реєстр не відповів. Повторна спроба ${attempt+2} із 3…`;
        await new Promise(resolve=>setTimeout(resolve,3000*(attempt+1)));
      }
    }
    throw lastError;
  }
  const clean=node=>(node?.textContent||'').replace(/\s+/g,' ').trim();
  function detail(html,url,region){
    const doc=new DOMParser().parseFromString(html,'text/html'),fields=new Map();
    for(const row of doc.querySelectorAll('.object-info-item')){
      const key=clean(row.querySelector('.object-info_left')).replace(/[’ʼ]/g,"'").toLowerCase();
      if(key&&!fields.has(key))fields.set(key,clean(row.querySelector('.object-info_right')));
    }
    const field=(...names)=>names.map(n=>fields.get(n.toLowerCase())).find(Boolean)||'';
    const number=field('Реєстраційний номер в ЄДЕССБ');if(!/^[А-ЯІЇЄҐA-Z]{1,3}\d{8,}$/.test(number))throw Error('Не вдалося прочитати картку реєстру.');
    const date=field('Дата реєстрації в ЄДЕССБ','Дата реєстрації').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const parcels=[...new Set((doc.body?.textContent||'').match(/\b\d{10}:\d{2}:\d{3}:\d{4}\b/g)||[])];
    return {cadastral_numbers:parcels,doc_number:number,reg_date:date?`${date[3]}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}`:null,object_name:field("Назва об'єкта","Назва об'єкта будівництва"),address:field('Адреса'),status:field('Статус документу','Статус документа'),doc_type:field('Тип'),org_issuer:field('Орган, що видав'),customer:[...doc.querySelectorAll('#applicants_info + table tbody tr td:first-child')].map(clean).join('; '),location_description:field('Опис місцезнаходження'),region_key:region,region:regions[region],detail_url:url};
  }
  const pause=()=>new Promise(resolve=>setTimeout(resolve,1200));
  async function start(){
    if(running)return;
    const scope=[...selected],days=Number($('collection-days').value);
    if(!scope.length){$('collection-message').textContent='Оберіть хоча б одну область.';return;}
    if(!Number.isInteger(days)||days<1||days>90){$('collection-message').textContent='Оберіть період від 1 до 90 днів.';return;}
    $('collection-diagnostics').replaceChildren();
    running=true;draw();$('collection-launch').disabled=true;
    if($('snapshot-mode'))$('snapshot-mode').value='live';
    const end=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Kyiv'}),start=new Date(Date.parse(end)-days*86400000).toISOString().slice(0,10);
    const items=new Map(),seen=new Set(),excluded=new Set(window.DatasetManager?.excludedIds||[]);
    let processed=0,skipped=0,filtered=0,complete=false,completedRegions=0;
    const failures=[];
    const publish=()=>window.DatasetManager?.setLive({updated_at:new Date().toISOString(),region:scope.map(k=>regions[k]).join(', '),partial:!complete,items:[...items.values()]});
    const jobs=scope.map(region=>({region,page:1})),signatures=new Map(scope.map(region=>[region,new Set()]));
    let located=0;
    const geo=window.ConstructionGeo;
    let placeLookup=new Map();
    if(geo){
      $('collection-message').textContent='Завантажую довідники населених пунктів для карти…';
      const placeRows=[];
      await Promise.all(scope.map(async region=>{
        try{const response=await fetch('./places/'+region+'.json',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();const data=await response.json();placeRows.push(...data.places.filter(place=>Array.isArray(place.names)&&Number.isFinite(place.lat)&&Number.isFinite(place.lon)));}
        catch(_){diagnose({message:'Не вдалося завантажити довідник населених пунктів.',advice:'Документи збиратимуться далі. Оновіть сторінку для повторного завантаження довідника карти.'},regions[region]);}
      }));
      placeLookup=geo.index(placeRows);
    }
    try{
      while(jobs.length){
        const {region,page}=jobs.shift();
        try{
          $('collection-message').textContent=`Спільний збір ${scope.length} областей · ${regions[region]} · сторінка ${page} · оброблено ${processed} · знайдено ${items.size} · на карті за населеним пунктом ${located}.`;
          const result=await api({action:'list',region,start,end,page});
          const doc=new DOMParser().parseFromString(result.html,'text/html'),list=doc.querySelector('.datasets__list');
          if(!list&&!/^0\s+(записів|записи|запис)$/.test(clean(doc.querySelector('.opendata__top p'))))throw Error('Змінився формат реєстру або доступ обмежено.');
          const ids=[...new Set([...doc.querySelectorAll('.datasets__list a[href*="document_detail/doc_id="]')].map(a=>a.getAttribute('href').match(/doc_id=([a-zA-Z0-9_-]+)/)?.[1]).filter(Boolean))];
          const signature=ids.join(',');if(ids.length&&signatures.get(region).has(signature))throw Error('Реєстр повторює сторінки. Ця область зібрана не повністю.');signatures.get(region).add(signature);
          for(const id of ids){
            if(seen.has(id))continue;await pause();
            $('collection-message').textContent=`Спільний збір ${scope.length} областей · ${regions[region]} · оброблено ${processed} · знайдено ${items.size} · на карті за населеним пунктом ${located}. Читаю картку…`;
            try{
              const card=await api({action:'detail',id}),row=detail(card.html,card.url,region);processed++;seen.add(id);
              if(excluded.has(row.doc_number)){skipped++;continue;}
              if(row.status!=='Діючий'||!row.reg_date||row.reg_date<start||row.reg_date>end){filtered++;continue;}
              const actualRegion=window.ConstructionGeo?.region(row.address,regions);
              if(actualRegion&&!scope.includes(actualRegion)){filtered++;continue;}
              if(actualRegion){row.region_key=actualRegion;row.region=regions[actualRegion];}
              if(geo){
                row.settlement=geo.settlement(row.address)||geo.settlement(row.location_description)||geo.settlement(row.object_name);
                row.district=geo.district(row.address);
                const point=geo.locate(row,placeLookup);
                if(point)Object.assign(row,point);
              }
              items.set(row.doc_number,row);if(Number.isFinite(row.lat))located++;
              publish();
            }catch(error){failures.push(`${regions[region]} · картка ${id}: ${error.message}`);diagnose(error,`${regions[region]} · сторінка ${page} · картка ${id}`);if(processed)publish();}
          }
          if(doc.querySelector('.pagination__next:not(.disabled) a[filter-user]')){
            if(page===1000)throw Error('Досягнуто ліміт сторінок. Скоротіть період пошуку.');
            jobs.push({region,page:page+1});
          }else completedRegions++;
          await pause();
        }catch(error){failures.push(`${regions[region]}: ${error.message}`);diagnose(error,`${regions[region]} · сторінка ${page} · період ${start} — ${end}`);}
      }
      complete=failures.length===0;
      if(completedRegions||processed)publish();
      if(!complete){$('collection-message').textContent=`Збір неповний: ${items.size} записів, помилок: ${failures.length}. ${failures.slice(0,3).join('; ')}. Причини та подальші дії — у повідомленнях вище. ${completedRegions||processed?'Отримані записи можна зберегти.':'Нових результатів немає; попередні дані залишено.'}`;return;}
      if(!items.size){const note=document.createElement('p');note.textContent=`За вибраними умовами немає нових записів. Виключено вашим файлом: ${skipped}; не відповідають статусу «Діючий» або періоду: ${filtered}. Спробуйте збільшити період, вибрати іншу область або скасувати виключення. Фільтри таблиці та карти не впливають на запити до реєстру.`;$('collection-diagnostics').appendChild(note);}
      publish();$('collection-message').textContent=`Готово: ${items.size} записів з усіх ${scope.length} областей; приблизні точки на карті: ${located}. Виключено: ${skipped}. Натисніть «Зберегти результати».`;
    }catch(error){if(processed)publish();$('collection-message').textContent=error.message+(processed?' Збір неповний; отримані записи можна зберегти.':' Попередні результати залишено.');}
    finally{running=false;draw();$('collection-launch').disabled=false;}
  }
  async function init(){
    try{const r=await fetch('./regions.json');if(!r.ok)throw Error();regions=await r.json();selected=new Set([...selected].filter(k=>k in regions));draw();}
    catch(_){$('collection-message').textContent='Не вдалося завантажити області. Оновіть сторінку.';return;}
    $('collection-all').addEventListener('click',()=>{if(!running){selected=new Set(Object.keys(regions));draw();}});
    $('collection-clear').addEventListener('click',()=>{if(!running){selected.clear();draw();}});
    $('collection-launch').addEventListener('click',start);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
