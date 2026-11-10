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
  async function api(params){
    const response=await fetch('/api/parser?'+new URLSearchParams(params),{cache:'no-store',signal:AbortSignal.timeout(35000)});
    let data;try{data=await response.json();}catch(_){throw Error('Сервер пошуку недоступний. Потрібне розгортання сайту з папкою functions.');}
    if(!response.ok)throw Error(data.message||'Помилка реєстру.');return data;
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
    const date=field('Дата реєстрації в ЄДЕССБ','Дата реєстрації').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return {doc_number:number,reg_date:date?`${date[3]}-${date[2]}-${date[1]}`:null,object_name:field("Назва об'єкта","Назва об'єкта будівництва"),address:field('Адреса'),status:field('Статус документу','Статус документа'),doc_type:field('Тип'),org_issuer:field('Орган, що видав'),customer:[...doc.querySelectorAll('#applicants_info + table tbody tr td:first-child')].map(clean).join('; '),location_description:field('Опис місцезнаходження'),region_key:region,region:regions[region],detail_url:url};
  }
  const pause=()=>new Promise(resolve=>setTimeout(resolve,1200));
  async function start(){
    if(running)return;
    const scope=[...selected],days=Number($('collection-days').value);
    if(!scope.length){$('collection-message').textContent='Оберіть хоча б одну область.';return;}
    if(!Number.isInteger(days)||days<1||days>90){$('collection-message').textContent='Оберіть період від 1 до 90 днів.';return;}
    running=true;draw();$('collection-launch').disabled=true;
    if($('snapshot-mode'))$('snapshot-mode').value='live';
    const end=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Kyiv'}),start=new Date(Date.parse(end)-days*86400000).toISOString().slice(0,10);
    const items=new Map(),seen=new Set(),excluded=new Set(window.DatasetManager?.excludedIds||[]);
    let processed=0,skipped=0,complete=false;
    const publish=()=>window.DatasetManager?.setLive({updated_at:new Date().toISOString(),region:scope.map(k=>regions[k]).join(', '),partial:!complete,items:[...items.values()]});
    try{
      for(const region of scope){
        const signatures=new Set();
        for(let page=1;page<=1000;page++){
          $('collection-message').textContent=`${regions[region]} · сторінка ${page} · оброблено ${processed} · знайдено ${items.size} · виключено ${skipped}. Залишайте вкладку відкритою.`;
          const result=await api({action:'list',region,start,end,page});
          const doc=new DOMParser().parseFromString(result.html,'text/html'),list=doc.querySelector('.datasets__list');
          if(!list&&!/^0\s+(записів|записи|запис)$/.test(clean(doc.querySelector('.opendata__top p'))))throw Error('Змінився формат реєстру або доступ обмежено.');
          const ids=[...new Set([...doc.querySelectorAll('.datasets__list a[href*="document_detail/doc_id="]')].map(a=>a.getAttribute('href').match(/doc_id=([a-zA-Z0-9_-]+)/)?.[1]).filter(Boolean))];
          const signature=ids.join(',');if(ids.length&&signatures.has(signature))throw Error('Реєстр повторює сторінки. Збір зупинено, щоб не втратити дані.');signatures.add(signature);
          for(const id of ids){
            if(seen.has(id))continue;seen.add(id);await pause();
            const card=await api({action:'detail',id}),row=detail(card.html,card.url,region);processed++;
            if(excluded.has(row.doc_number)){skipped++;continue;}
            if(row.status==='Діючий'&&row.reg_date>=start&&row.reg_date<=end)items.set(row.doc_number,row);
            if(processed%10===0)publish();
          }
          if(!doc.querySelector('.pagination__next:not(.disabled) a[filter-user]'))break;
          if(page===1000)throw Error('Досягнуто ліміт сторінок. Скоротіть період пошуку.');
          await pause();
        }
      }
      complete=true;publish();$('collection-message').textContent=`Готово: ${items.size} записів. Виключено: ${skipped}. Натисніть «Зберегти результати».`;
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
