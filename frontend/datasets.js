/* Snapshot comparison is independent of map and DOM. */
(function(root) {
  const fields=['reg_date','object_name','address','customer','status','doc_type','org_issuer','location_description'];
  const key = item => String(item.doc_number || '').trim();
  function parse(value) {
    const data=Array.isArray(value)?{items:value}:value;
    if(!data || !Array.isArray(data.items) || data.items.length>50000)throw Error('Очікується JSON із масивом items (до 50 000 записів).');
    const seen=new Map();
    for(const item of data.items) {
      if(!item || typeof item!=='object' || !key(item))throw Error('У кожному записі має бути номер документа doc_number.');
      const clean={};
      for(const [name,value] of Object.entries(item)) {
        if(['__proto__','constructor','prototype'].includes(name))continue;
        if(typeof value==='string')clean[name]=value.slice(0,20000);
        else if(value===null || typeof value==='number' || typeof value==='boolean')clean[name]=value;
        else if(name==='cadastral_numbers' && Array.isArray(value))clean[name]=value.filter(v=>typeof v==='string').slice(0,50);
      }
      clean.doc_number=key(item);seen.set(clean.doc_number,clean);
    }
    return {updated_at:typeof data.updated_at==='string'?data.updated_at:null,region:typeof data.region==='string'?data.region:'Львівська область',items:[...seen.values()]};
  }
  function changed(a,b){return fields.some(name=>JSON.stringify(a[name]??'')!==JSON.stringify(b[name]??''));}
  function combine(datasets,baseline,mode) {
    const merged=new Map(),old=new Map((baseline?.items||[]).map(row=>[key(row),row]));
    // Newer successful parser snapshots replace older versions of the same document.
    const ordered=[...datasets].sort((a,b)=>(Date.parse(a.updated_at)||0)-(Date.parse(b.updated_at)||0));
    for(const dataset of ordered)for(const row of dataset.items)merged.set(key(row),{...row});
    const rows=[...merged.values()].map(row=>({...row,comparison:baseline?(!old.has(key(row))?'new':changed(row,old.get(key(row)))?'changed':'same'):''}));
    return rows.filter(row=>mode==='new'?row.comparison==='new':mode==='changed'?row.comparison==='changed':true);
  }
  const api={parse,combine,changed};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DatasetCore=api;
})(typeof window==='undefined'?globalThis:window);
