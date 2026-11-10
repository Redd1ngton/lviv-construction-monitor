import regions from '../../frontend/regions.json';
const BASE='https://e-construction.gov.ua';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
// Stateless, bounded requests: no credentials, workflow or background job required.
export async function onRequest({request}){
  if(request.method!=='GET')return json({message:'Метод не підтримується.'},405);
  const url=new URL(request.url),p=url.searchParams;
  if(!p.has('action'))return json({configured:true});
  let target;
  if(p.get('action')==='list'){
    const region=p.get('region'),start=p.get('start'),end=p.get('end'),page=Number(p.get('page'));
    const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s));
    if(!Object.hasOwn(regions,region)||!validDate(start)||!validDate(end)||start>end||Date.parse(end)-Date.parse(start)>90*86400000||!Number.isInteger(page)||page<1||page>1000)return json({message:'Некоректні параметри пошуку.'},400);
    target=`${BASE}/document/optype=100/filter=${encodeURIComponent(`1061_${regions[region]},1060_1,1057_${start}_${end}`)}${page===1?'':'/page='+page}`;
  }else if(p.get('action')==='parcel'){
    const number=p.get('number');
    if(!/^\d{10}:\d{2}:\d{3}:\d{4}$/.test(number||''))return json({message:'Некоректний кадастровий номер.'},400);
    target=`${BASE}/api-user/gis-url-proxy?cadparcel=${encodeURIComponent(number)}`;
  }else if(p.get('action')==='detail'){
    const id=p.get('id');
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id||''))return json({message:'Некоректний номер картки.'},400);
    target=`${BASE}/document_detail/doc_id=${id}/optype=100`;
  }else return json({message:'Невідома дія.'},400);
  try{
    const signal=AbortSignal.timeout(25000);
    let response;
    for(let hop=0;hop<5;hop++){
      response=await fetch(target,{redirect:'manual',signal,headers:{'User-Agent':'ConstructionMonitor/3.0','Accept':'text/html'}});
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('Location');
      if(!location)return json({message:'Реєстр повернув некоректне перенаправлення.'},502);
      const next=new URL(location,target);
      if(next.origin!==BASE||next.username||next.password||!/^\/(document\/|document_detail\/)/.test(next.pathname))return json({message:'Реєстр перенаправляє на недоступну сторінку.'},502);
      target=next.href;
    }
    if(!response.ok){
      const status=response.status;
      const code=status===429?'RATE_LIMIT':status===401||status===403?'ACCESS_DENIED':status===404?'NOT_FOUND':status>=500?'REGISTRY_FAILURE':'REQUEST_REJECTED';
      const advice=code==='RATE_LIMIT'?'Реєстр обмежив частоту запитів. Зачекайте кілька хвилин і повторіть пошук.':code==='ACCESS_DENIED'?'Реєстр відмовив у доступі серверу. Зміна фільтрів не усуне цю причину.':code==='NOT_FOUND'?'Сторінка або картка відсутня. Потрібно перевірити адресу джерела.':code==='REGISTRY_FAILURE'?'Збій на боці реєстру. Повторіть пошук пізніше; причина не підтверджує помилку фільтрів.':'Реєстр відхилив запит. Потрібно перевірити параметри запиту.';
      return json({code,advice,source_url:target,upstream_status:status,retryable:status===429||status>=500,message:`Реєстр повернув HTTP ${status}.`},status===429?429:502);
    }
    if(p.get('action')==='parcel'){
      const payload=await response.json(),coords=payload?.centroid?.coordinates;
      const valid=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=44&&lat<=53&&lon>=22&&lon<=41;
      let point=null;
      if(Array.isArray(coords)&&coords.length===2){const [a,b]=coords.map(Number);if(valid(a,b))point={lat:a,lon:b,coord_source:'registry_parcel'};else if(valid(b,a))point={lat:b,lon:a,coord_source:'registry_parcel'};}
      return json({point,url:target});
    }
    const html=await response.text();
    if(html.length>5000000)return json({message:'Відповідь реєстру завелика.'},502);
    return json({html,url:target});
  }catch(error){const timeout=error.name==='TimeoutError'||error.name==='AbortError';return json({code:timeout?'TIMEOUT':'CONNECTION_FAILED',retryable:true,source_url:target,message:timeout?'Реєстр не відповів за 25 секунд.':'Не вдалося з’єднатися з реєстром.',advice:'Повторіть пошук пізніше. Можна спробувати одну область і коротший період для перевірки; вплив фільтрів на збій не підтверджено.'},502);}
}
