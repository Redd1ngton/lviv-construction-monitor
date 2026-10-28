(() => {
  let selected=new Set(['lviv']);
  try{const old=JSON.parse(localStorage.getItem('construction-regions-v1')||'null');if(Array.isArray(old))selected=new Set(old);}catch(_){}
  let regions={}, backendReady=false, launching=false;
  let requestTimer=null;
  const byId=id=>document.getElementById(id);
  const manager={get selectedKeys(){return selected;},reset(keys=['lviv']){selected=new Set(keys.filter(key=>key in regions));draw();}};
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
  async function api(path,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch(path,{...options,cache:'no-store',signal:controller.signal});
      let value;try{value=await response.json();}catch(_){throw Error('Сервер запуску недоступний. Перевірте розгортання Cloudflare Pages Functions.');}
      if(!response.ok){const error=Error(value.message||'Помилка сервера запуску.');error.data=value;throw error;}
      return value;
    }finally{clearTimeout(timer);}
  }
  async function checkBackend(){
    try{const config=await api('/api/parser');backendReady=config.configured===true;byId('collection-backend').textContent=backendReady?'Запуск із сайту підключено.':'Запуск із сайту ще не підключено: потрібні секрети Cloudflare.';}
    catch(error){backendReady=false;byId('collection-backend').textContent=error.message;}
    return backendReady;
  }
  function watchRequest(id,attempt=0){
    clearTimeout(requestTimer);
    requestTimer=setTimeout(async()=>{
      try{
        const result=await api('/api/parser?action=request&id='+encodeURIComponent(id));
        if(result.run){window.ParserStatus?.watchRun(result.run);byId('collection-message').textContent='Запуск №'+(result.run.run_number||result.run.id)+' зареєстровано. Стан і прогрес — у панелі парсера.';return;}
        if(attempt<29)watchRequest(id,attempt+1);else byId('collection-message').textContent='Запит прийнято, але запуск ще не знайдено. Перевірте журнал перед повторною спробою.';
      }catch(error){byId('collection-message').textContent=error.message;if(attempt<29)watchRequest(id,attempt+1);}
    },4000);
  }
  async function startCollection(event){
    event.preventDefault();if(launching)return;
    if(!selected.size){byId('collection-message').textContent='Оберіть хоча б один регіон.';return;}
    const scope=[...selected];
    const country=scope.length===Object.keys(regions).length;
    if(country&&!confirm('Почати збір усієї України? Це може зайняти тривалий час.'))return;
    const days=Number(byId('collection-days').value);
    if(!Number.isInteger(days)||days<1||days>90){byId('collection-message').textContent='Вкажіть період від 1 до 90 днів.';return;}
    if(!backendReady&&!await checkBackend()){
      byId('collection-setup').open=true;
      byId('collection-message').textContent='Сервер запуску не налаштований. Збір не розпочато. Відкрийте інструкцію нижче або скористайтеся ручним запуском GitHub.';
      return;
    }
    const key=byId('collection-key').value.trim();
    if(!key){byId('collection-message').textContent='Введіть ключ керування, заданий у Cloudflare як PARSER_ADMIN_KEY.';byId('collection-key').focus();return;}
    launching=true;byId('collection-launch').disabled=true;byId('collection-launch').textContent='Відправляю запит…';
    byId('collection-message').textContent='Надсилаю запит для: '+scope.map(key=>regions[key]).join(', ');
    try{
      const result=await api('/api/parser',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({regions:scope,days,confirm_country:country})});
      if(!result.accepted)throw Error('Сервер не підтвердив прийняття запиту.');
      byId('collection-message').textContent='Запит прийнято. Збір обраних регіонів очікує запуску; відстежуйте стан у панелі парсера.';
      if(result.run)window.ParserStatus?.watchRun(result.run);else watchRequest(result.request_id);
    }catch(error){
      byId('collection-message').textContent=error.message;
      if(error.data?.error==='NOT_CONFIGURED'){backendReady=false;byId('collection-setup').open=true;}
      if(error.data?.request_id)watchRequest(error.data.request_id);
      if(error.data?.run)window.ParserStatus?.watchRun(error.data.run);
    }finally{launching=false;byId('collection-launch').disabled=false;byId('collection-launch').textContent='Почати збір обраних регіонів';}
  }
  async function init(){
    try{const response=await fetch('./regions.json');if(!response.ok)throw Error();regions=await response.json();selected=new Set([...selected].filter(key=>key in regions));draw();}
    catch(_){byId('collection-message').textContent='Не вдалося завантажити перелік регіонів. Оновіть сторінку.';return;}
    byId('collection-clear').addEventListener('click',()=>{selected.clear();draw();});
    byId('collection-all').addEventListener('click',()=>{selected=new Set(Object.keys(regions));draw();});
    byId('collection-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(byId('collection-codes').value);byId('collection-message').textContent='Коди скопійовано. Вставте їх у поле regions у Run workflow.';}catch(_){byId('collection-codes').select();byId('collection-message').textContent='Скопіюйте виділені коди й вставте у поле regions у Run workflow.';}});
    byId('collection-launch').addEventListener('click',startCollection);
    checkBackend();

  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
