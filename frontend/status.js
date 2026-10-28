/* Live progress from the parser heartbeat; GitHub steps supply lifecycle and publication. */
(() => {
  const repo='Redd1ngton/lviv-construction-monitor',api=`https://api.github.com/repos/${repo}/actions`;
  const $=id=>document.getElementById(id);
  if(!$('parser-state'))return;
  let preferredRunId='';
  try{preferredRunId=sessionStorage.getItem('construction-requested-run')||'';}catch(_){}
  const labels={starting:'Підключення до реєстру',listing:'Читання списку документів',details:'Обробка карток',coordinates:'Пошук координат та адрес',saving:'Збереження результатів',publishing:'Публікація даних',success:'Картки зібрано',failure:'Помилка збору',cancelled:'Збір скасовано'};
  const stages=['Підготовка','Встановлення','Перевірки','Збір карток','Публікація'];
  let run=null,regionJob=null,publishJob=null,heartbeat=null,liveRegion='lviv',steps=[],busy=false;
  let refreshAgain=false;
  let lastApi=0,lastChecked=null,apiError='',heartbeatError='',reloaded='',retryAt=0,detectedRun='';
  const date=value=>value?new Date(value).toLocaleString('uk-UA'):'—';
  async function get(url){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error(String(response.status));return await response.json();}
    finally{clearTimeout(timer);}
  }
  function stageIndex(name){
    if(name.startsWith('Post '))return -1;
    if(/Set up job|checkout/.test(name))return 0;
    if(/setup-python|pip install/.test(name))return 1;
    if(/unittest|tests\//.test(name))return 2;
    if(/Collect and verify/.test(name))return 3;
    if(/Publish final|Merge and publish|Commit successful/.test(name))return 4;
    return -1;
  }
  function currentHeartbeat(){return heartbeat && run && String(heartbeat.run_id)===String(run.id) && String(heartbeat.run_attempt||1)===String(run.run_attempt||1)?heartbeat:null;}
  function clock(){
    const state=currentHeartbeat(),parts=[];
    if(run?.run_started_at){const ended=(regionJob?.conclusion==='failure'?regionJob.completed_at:null)||publishJob?.completed_at||(run.status==='completed'?run.updated_at:null);const seconds=Math.max(0,Math.floor(((ended?Date.parse(ended):Date.now())-Date.parse(run.run_started_at))/1000));if(Number.isFinite(seconds))parts.push(`${ended?'Тривалість':'Від початку'}: ${Math.floor(seconds/60)} хв ${seconds%60} с`);}
    if(state?.updated_at){const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(state.updated_at))/1000));if(Number.isFinite(seconds))parts.push(`Остання активність: ${seconds} с тому`);}
    if($('parser-age'))$('parser-age').textContent=parts.join(' · ');
  }
  function render(){
    const state=currentHeartbeat(),published=publishJob?.conclusion==='success';
    const collectionFailed=['failure','cancelled'].includes(regionJob?.conclusion)||['failure','cancelled'].includes(state?.stage);
    const publishFailed=!collectionFailed&&publishJob?.status==='completed'&&!['success','skipped'].includes(publishJob.conclusion);
    const failed=publishFailed || collectionFailed;
    const finished=!collectionFailed&&(published || (!publishJob&&run?.status==='completed'&&run.conclusion==='success'));
    const fresh=state && Date.now()-Date.parse(state.updated_at)<300000;
    const collecting=!failed&&!finished&&fresh&&['starting','listing','details','coordinates','saving'].includes(state.stage);
    const waitingPublication=!finished&&!failed&&!collecting&&(regionJob?.conclusion==='success'||state?.stage==='publishing'||state?.stage==='success'||publishJob?.status==='in_progress');
    const active=collecting || regionJob?.status==='in_progress';
    const noRegion=run&&!regionJob&&run.status==='completed';
    const title=noRegion?'Область не збиралася в цьому запуску':failed?(collectionFailed?'⚠ Помилка збору карток':'⚠ Помилка публікації'):finished?'✓ Дані опубліковано':waitingPublication?'● Публікація результатів':active?'● Парсер працює':!run?(apiError?'Статус недоступний':'Запусків ще немає'):noRegion?'Область не збиралася в цьому запуску':'Очікує запуску';
    $('parser-state').textContent=title;
    $('parser-state').dataset.kind=failed?'failure':finished?'success':active||waitingPublication?'active':'';
    if(run)$('parser-run').href=run.html_url;
    const statuses=stages.map(()=> 'pending');
    for(const step of steps){const i=stageIndex(step.name);if(i<0)continue;if(step.conclusion&&!['success','skipped'].includes(step.conclusion))statuses[i]='failure';else if(step.status==='in_progress')statuses[i]='active';else if(step.conclusion==='success'&&statuses[i]==='pending')statuses[i]='done';}
    if(collecting){for(let i=0;i<3;i++)statuses[i]='done';statuses[3]='active';statuses[4]='pending';}
    if(waitingPublication){for(let i=0;i<4;i++)statuses[i]='done';statuses[4]='active';}
    if(finished)statuses.fill('done');
    if(noRegion)statuses.fill('pending');
    if(collectionFailed){statuses[3]='failure';statuses[4]='pending';}
    if(publishFailed)statuses[4]='failure';
    $('parser-steps').replaceChildren(...stages.map((name,i)=>{const li=document.createElement('li');li.dataset.state=statuses[i];li.textContent=`${statuses[i]==='done'?'✓':statuses[i]==='active'?'●':statuses[i]==='failure'?'!':i+1} ${name}`;if(statuses[i]==='active')li.setAttribute('aria-current','step');return li;}));
    const parts=[];
    const option=[...($('filter-region')?.options||[])].find(o=>o.value===liveRegion);
    parts.push('Область: '+(option?.textContent||liveRegion));
    if(run)parts.push(`Запуск №${run.run_number||run.id}`);
    if(state){
      parts.push(collectionFailed?'Збір зупинено · останній відомий прогрес':publishFailed?'Публікацію не завершено':(labels[state.stage]||state.stage));
      if(state.page)parts.push(`Сторінка: ${state.page}`);
      if(Number.isFinite(state.processed))parts.push(`Оброблено: ${state.processed}${state.total?' / приблизно '+state.total:''}`);
      if(Number.isFinite(state.accepted))parts.push(`Підтверджено: ${state.accepted}`);
      if(active&&!fresh)parts.push('⚠ Понад 5 хвилин без активності. Перевірте журнал.');
      if(failed&&state.message)parts.push(state.message);
    }else if(active)parts.push('Очікую перший знімок прогресу…');
    if(waitingPublication)parts.push('Зібрані картки ще не опубліковані. Таблиця оновиться після публікації.');
    if(failed)parts.push('Останні успішні дані збережені. Причина — у журналі запуску.');
    if(apiError)parts.push('GitHub тимчасово недоступний; показано останній відомий стан.');
    if(heartbeatError&&active)parts.push('Немає нового знімка активності; повторюю перевірку.');
    $('parser-detail').textContent=parts.join(' · ');
    const bar=$('parser-progress');bar.dataset.kind=failed?'failure':finished?'success':'active';bar.hidden=noRegion||(!state&&!active&&!waitingPublication&&!finished);
    if(finished)bar.value=100;else if(state?.total>0)bar.value=Math.min(99,100*(state.processed||0)/state.total);else bar.removeAttribute('value');
    $('parser-time').textContent=`Перевірено: ${date(lastChecked)} · Автоперевірка прогресу кожні 10 с`;
    clock();
  }
  async function refresh(force=false){
    if(busy){if(force)refreshAgain=true;return;}busy=true;$('parser-refresh').disabled=true;
    try{
      if(force||Date.now()-lastApi>=180000){
        try{
          const result=await get(`${api}/runs?per_page=10`),runs=result.workflow_runs.filter(r=>r.path==='.github/workflows/daily-scrape.yml');
          run=runs.find(r=>String(r.id)===preferredRunId)||runs.find(r=>r.status==='in_progress')||runs[0]||null;
          if(preferredRunId&&!runs.some(r=>String(r.id)===preferredRunId)){try{run=await get(`https://api.github.com/repos/${repo}/actions/runs/${preferredRunId}`);}catch(_){}}
          const all=run?(await get(`${api}/runs/${run.id}/jobs?per_page=100`)).jobs:[];
          const selected=$('filter-region')?.value;
          const chosen=selected?(all.find(j=>j.name.includes('('+selected+')'))||(selected==='lviv'?all.find(j=>j.name==='scrape'):null)):all.find(j=>j.name.startsWith('scrape (')&&j.status==='in_progress')||all.find(j=>j.name.startsWith('scrape ('))||all.find(j=>j.name==='scrape');
          liveRegion=selected||chosen?.name.match(/\(([^)]+)\)/)?.[1]||'lviv';regionJob=chosen||null;publishJob=all.find(j=>j.name==='publish')||null;steps=chosen?.steps||[];apiError='';
        }catch(error){apiError=error.message;}
        lastApi=Date.now();
      }
      try{heartbeat=await get(`https://raw.githubusercontent.com/${repo}/parser-status/status-${liveRegion}.json?t=${Math.floor(Date.now()/10000)}`);heartbeatError='';}
      catch(error){heartbeatError=error.message;}
      if(heartbeat && run && String(heartbeat.run_id)!==String(run.id) && String(heartbeat.run_id)!==detectedRun && Date.parse(heartbeat.updated_at)>Date.parse(run.created_at||run.run_started_at||0)){detectedRun=String(heartbeat.run_id);lastApi=0;}
      lastChecked=new Date().toISOString();render();
      const published=publishJob?.conclusion==='success'||(!publishJob&&run?.status==='completed'&&run.conclusion==='success');
      const key=run?`${run.id}:${run.run_attempt||1}`:'';
      if(published&&key!==reloaded&&Date.now()>=retryAt&&window.ConstructionApp?.reload){
        retryAt=Date.now()+60000;
        const ok=await window.ConstructionApp.reload({automatic:true});if(ok)reloaded=key;
      }
    }finally{busy=false;$('parser-refresh').disabled=false;if(refreshAgain){refreshAgain=false;setTimeout(()=>refresh(true),0);}}
  }
  let scopeTimer;
  const scopeChanged=()=>{clearTimeout(scopeTimer);scopeTimer=setTimeout(()=>{lastApi=0;heartbeat=null;refresh();},400);};
  $('filter-region')?.addEventListener('change',scopeChanged);
  document.addEventListener('collection-change',scopeChanged);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  $('parser-refresh').addEventListener('click',()=>refresh(true));
  window.ParserStatus={refresh,watchRun(requested){if(!/^\d+$/.test(String(requested.id)))return;preferredRunId=String(requested.id);try{sessionStorage.setItem('construction-requested-run',preferredRunId);}catch(_){}heartbeat=null;lastApi=0;reloaded='';refresh(true);}};
  refresh();setInterval(()=>{if(!document.hidden)refresh();},10000);setInterval(()=>{if(!document.hidden)clock();},1000);
})();
