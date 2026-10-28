import regions from '../../frontend/regions.json';

const REPO='Redd1ngton/lviv-construction-monitor';
const WORKFLOW='daily-scrape.yml';
const API=`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const configured=env=>Boolean(env.GITHUB_TOKEN&&env.PARSER_ADMIN_KEY);
async function sameSecret(a,b){
  const encode=new TextEncoder();
  const hashes=await Promise.all([a,b].map(value=>crypto.subtle.digest('SHA-256',encode.encode(value))));
  const left=new Uint8Array(hashes[0]),right=new Uint8Array(hashes[1]);let difference=0;
  for(let i=0;i<left.length;i++)difference|=left[i]^right[i];return difference===0;
}
async function github(env,url,options={}){
  return fetch(url,{...options,signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',Authorization:`Bearer ${env.GITHUB_TOKEN}`,'X-GitHub-Api-Version':'2026-03-10','User-Agent':'ConstructionAggregator',...options.headers}});
}
function runView(run){return {id:run.id,run_number:run.run_number,status:run.status,conclusion:run.conclusion,html_url:run.html_url,run_attempt:run.run_attempt};}

export async function onRequest({request,env}){
  const url=new URL(request.url);
  let dispatchedId=null;
  try{
    if(request.method==='GET'){
      if(url.searchParams.get('action')!=='request')return json({configured:configured(env),missing:['GITHUB_TOKEN','PARSER_ADMIN_KEY'].filter(key=>!env[key])});
      if(!configured(env))return json({error:'NOT_CONFIGURED',message:'Сервер запуску ще не налаштований.'},503);
      const id=url.searchParams.get('id')||'';
      if(!/^[a-f0-9-]{36}$/.test(id))return json({error:'BAD_REQUEST',message:'Некоректний ідентифікатор запиту.'},400);
      const response=await github(env,`${API}/runs?event=workflow_dispatch&per_page=30`);
      if(!response.ok)return json({error:'GITHUB_UNAVAILABLE',message:'Не вдалося перевірити чергу GitHub.'},502);
      const data=await response.json(),run=data.workflow_runs.find(run=>run.display_title?.includes(id));
      return json({request_id:id,run:run?runView(run):null});
    }
    if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
    const origin=request.headers.get('Origin');
    if(origin&&origin!==url.origin)return json({error:'ORIGIN_DENIED',message:'Запуск дозволений лише з цього сайту.'},403);
    if(!configured(env))return json({error:'NOT_CONFIGURED',message:'Додайте GITHUB_TOKEN та PARSER_ADMIN_KEY у секрети Cloudflare й повторно розгорніть сайт.'},503);
    const supplied=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]||'';
    if(!supplied||!await sameSecret(supplied,String(env.PARSER_ADMIN_KEY)))return json({error:'UNAUTHORIZED',message:'Введіть правильний ключ керування парсером.'},401);
    const raw=await request.text();if(raw.length>4000)return json({error:'TOO_LARGE',message:'Завеликий запит.'},413);
    let body;try{body=JSON.parse(raw);}catch(_){return json({error:'BAD_REQUEST',message:'Некоректний JSON.'},400);}
    if(!body||!Array.isArray(body.regions)||!body.regions.length||body.regions.some(key=>typeof key!=='string'||!Object.hasOwn(regions,key)))return json({error:'BAD_REGIONS',message:'Оберіть коректні регіони.'},400);
    const selected=[...new Set(body.regions)],days=body.days??7;
    if(!Number.isInteger(days)||days<1||days>90)return json({error:'BAD_DAYS',message:'Період має бути від 1 до 90 днів.'},400);
    const country=selected.length===Object.keys(regions).length;
    if(country&&body.confirm_country!==true)return json({error:'COUNTRY_CONFIRMATION_REQUIRED',message:'Потрібне окреме підтвердження збору всієї країни.'},400);
    const queued=await github(env,`${API}/runs?per_page=15`);
    if(!queued.ok)return json({error:'GITHUB_UNAVAILABLE',message:'Не вдалося перевірити чергу. Запит не відправлено.'},502);
    const queue=await queued.json(),pending=queue.workflow_runs.find(run=>['queued','pending','waiting','requested'].includes(run.status));
    if(pending)return json({error:'QUEUE_BUSY',message:'У черзі вже є збір. Дочекайтеся його запуску перед новим запитом.',run:runView(pending)},409);
    const requestId=crypto.randomUUID();
    dispatchedId=requestId;
    const response=await github(env,`${API}/dispatches`,{method:'POST',body:JSON.stringify({ref:'main',inputs:{regions:selected.join(','),days:String(days),confirm_country:country?'true':'false',request_id:requestId}})});
    if(!response.ok)return json({error:'DISPATCH_FAILED',message:response.status===401||response.status===403?'Перевірте серверний токен GitHub: потрібен доступ Actions: write до цього репозиторію.':'GitHub не прийняв запуск. Перевірте workflow на гілці main.'},502);
    let accepted={};if(response.status!==204)try{accepted=await response.json();}catch(_){}
    const id=accepted.workflow_run_id;
    return json({accepted:true,request_id:requestId,regions:selected,run:id?{id,status:'queued',run_attempt:1,html_url:accepted.html_url||`https://github.com/${REPO}/actions/runs/${id}`} : null},202);
  }catch(_){return json({error:'UPSTREAM_TIMEOUT',request_id:dispatchedId,message:'Не вдалося підтвердити відповідь GitHub. Перевірте чергу перед повторною спробою.'},502);}
}
