(() => {
  let selected=new Set(['lviv']);
  try{const old=JSON.parse(localStorage.getItem('construction-regions-v1')||'null');if(Array.isArray(old))selected=new Set(old);}catch(_){}
  let regions={};
  const byId=id=>document.getElementById(id);
  const manager={get selectedKeys(){return selected;}};
  window.CollectionManager=manager;
  function update(){
    try{localStorage.setItem('construction-regions-v1',JSON.stringify([...selected]));}catch(_){}
    byId('collection-count').textContent=`Обрано регіонів: ${selected.size} із ${Object.keys(regions).length}`;
    byId('collection-codes').value=[...selected].join(',');
    byId('collection-launch').setAttribute('aria-disabled',String(!selected.size));
    byId('filter-region').value=selected.size===1?[...selected][0]:'';
    if(window.ConstructionApp?.regionChanged)window.ConstructionApp.regionChanged();else window.ConstructionApp?.refresh();
    document.dispatchEvent(new Event('collection-change'));
  }
  function draw(){
    const list=byId('region-checks');list.replaceChildren();
    for(const [key,name] of Object.entries(regions).sort((a,b)=>a[1].localeCompare(b[1],'uk'))){
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=selected.has(key);
      input.addEventListener('change',()=>{input.checked?selected.add(key):selected.delete(key);update();});
      const text=document.createElement('span');text.textContent=name;label.append(input,text);
      const only=document.createElement('button');only.type='button';only.className='small secondary region-only';only.textContent='Лише ця';only.setAttribute('aria-label','Лише '+name);only.addEventListener('click',()=>{selected=new Set([key]);draw();});label.appendChild(only);list.appendChild(label);
    }
    update();
  }
  async function init(){
    try{const response=await fetch('./regions.json');if(!response.ok)throw Error();regions=await response.json();selected=new Set([...selected].filter(key=>key in regions));draw();}
    catch(_){byId('collection-message').textContent='Не вдалося завантажити перелік регіонів. Оновіть сторінку.';return;}
    byId('collection-clear').addEventListener('click',()=>{selected.clear();draw();});
    byId('collection-all').addEventListener('click',()=>{if(!confirm('Обрати всі регіони України? Перед загальним збором потрібне окреме підтвердження.'))return;selected=new Set(Object.keys(regions));draw();});
    byId('collection-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(byId('collection-codes').value);byId('collection-message').textContent='Коди скопійовано. Вставте їх у поле regions у Run workflow.';}catch(_){byId('collection-codes').select();byId('collection-message').textContent='Скопіюйте виділені коди й вставте у поле regions у Run workflow.';}});
    byId('collection-launch').addEventListener('click',event=>{
      if(!selected.size){event.preventDefault();byId('collection-message').textContent='Оберіть хоча б один регіон.';return;}
      if(selected.size===Object.keys(regions).length&&!confirm('Запустити збір по всій Україні? У GitHub також увімкніть confirm_country для цього запуску.')){event.preventDefault();return;}
      navigator.clipboard?.writeText(byId('collection-codes').value).catch(()=>{});
      byId('collection-message').textContent='У GitHub натисніть Run workflow та вставте коди у regions. Це запускає збір обраних областей.';
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
