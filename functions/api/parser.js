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
    target=`${BASE}/document/optype=100/filter=${encodeURIComponent(`1061_${regions[region]},1060_1,1057_${start}_${end}`)}/page=${page}`;
  }else if(p.get('action')==='detail'){
    const id=p.get('id');
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id||''))return json({message:'Некоректний номер картки.'},400);
    target=`${BASE}/document_detail/doc_id=${id}`;
  }else return json({message:'Невідома дія.'},400);
  try{
    const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{'User-Agent':'ConstructionMonitor/3.0','Accept':'text/html'}});
    if(!response.ok)return json({message:'Реєстр тимчасово недоступний. Спробуйте пізніше.'},502);
    const html=await response.text();
    if(html.length>5000000)return json({message:'Відповідь реєстру завелика.'},502);
    return json({html,url:target});
  }catch(_){return json({message:'Не вдалося отримати відповідь реєстру. Повторіть спробу.'},502);}
}
