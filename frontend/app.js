(() => {
const REMOTE_DATA = 'https://raw.githubusercontent.com/Redd1ngton/lviv-construction-monitor/main/data/';
const DATA_URLS = [REMOTE_DATA + 'constructions.json', './data.json', '../data/constructions.json'];
const geo = window.ConstructionGeo;
if (!geo) { document.getElementById("meta").textContent="Не завантажився модуль застосунку. Оновіть сторінку."; return; }
let placeLookup = new Map(), regionNames={}, placeRows=[], viewVersion=0;
const placeRequests=new Map();
const regionsReady=fetchJson('./regions.json').then(value=>{regionNames=value;return value;}).catch(()=>{regionNames={lviv:'Львівська'};return regionNames;});
async function ensurePlaces(rows) {
  await regionsReady;
  const keys=new Set(rows.map(row=>row.region_key || geo.region(row.address,regionNames)).filter(Boolean));
  await Promise.allSettled([...keys].map(key=>{
    if(!placeRequests.has(key))placeRequests.set(key,fetchJson('./places/'+key+'.json').then(data=>{placeRows.push(...data.places);placeLookup=geo.index(placeRows);}));
    return placeRequests.get(key);
  }));
}
let items = [], selected = new Set(), sortKey = 'reg_date', sortDir = -1;
let map, markersLayer, routeLayer, pinTarget = null;
let overrides = {};
try { overrides = JSON.parse(localStorage.getItem('construction-pins-v1') || '{}'); } catch (_) {}
const $ = id => document.getElementById(id);
const coordLabel = it => it.coord_source === 'registry_address' ? 'За вулицею та номером будинку · перевірте перед виїздом' : it.coord_source === 'registry_street' ? 'Приблизно · знайдена вулиця' : it.coord_source === 'manual' ? 'Уточнено вручну' : it.coord_source === 'registry_parcel' ? 'Центр кадастрової ділянки · реєстр' : it.coord_source === 'settlement' ? 'Приблизно · центр населеного пункту' : hasCoordinates(it) ? 'Координати з реєстру' : 'Місце не визначено';
function hasCoordinates(it) { return Number.isFinite(it.lat) && Number.isFinite(it.lon) && Math.abs(it.lat) <= 90 && Math.abs(it.lon) <= 180; }
function safeUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'e-construction.gov.ua' ? u.href : '#'; } catch (_) { return '#'; } }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const escapeAttr = escapeHtml;
async function fetchJson(url, force=false) {
  if(force)url+=(url.includes('?')?'&':'?')+'_refresh='+Date.now();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try { const r = await fetch(url, {cache:'no-store', signal:controller.signal}); if (!r.ok) throw Error(r.status); return await r.json(); }
  finally { clearTimeout(timer); }
}
let loadingData=false;
async function loadData(force=false, automatic=false) {
  if(loadingData)return false;
  loadingData=true;
  const button=$('btn-force-refresh');if(button){button.disabled=true;button.textContent='Оновлюю…';}
  if(force)$('data-refresh-message').textContent='Завантажую останні опубліковані дані без кешу…';
  try {
  for (const url of DATA_URLS) {
    try {
      const data = await fetchJson(url, force), rows = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(rows)) continue;
      await setData(rows, `Поточний парсер · Записів: ${rows.length}`);
      $('meta').textContent = `Оновлено: ${data.updated_at ? new Date(data.updated_at).toLocaleString('uk-UA') : '—'} · Записів: ${items.length}`;
      $('download-json').href = url;
      $('download-csv').href = url.endsWith('data.json') ? url.replace(/data\.json$/, 'data.csv') : url.replace(/constructions\.json$/, 'constructions.csv');
      if(force && !automatic && $('snapshot-mode'))$('snapshot-mode').value='live';
      if (window.DatasetManager) window.DatasetManager.setLive({...data, items:rows});
      if(force)$('data-refresh-message').textContent='Дані оновлено. Дата останнього збору: '+(data.updated_at?new Date(data.updated_at).toLocaleString('uk-UA'):'невідома')+'. Для нового збору відкрийте запуск обраних регіонів.';
      return true;
    } catch (error) { console.warn('Data unavailable', url, error); }
  }
  $('meta').textContent = 'Не вдалося завантажити дані. Спробуйте оновити сторінку.';
  if(force)$('data-refresh-message').textContent='Не вдалося оновити. Попередні дані залишаються на екрані.';
  refresh();
  return false;
  } finally { loadingData=false;if(button){button.disabled=false;button.textContent='Оновити дані';} }
}
function prepareItems(rows) {
  return rows.map(row => {
        const it = {...row, ...geo.address(row), region_key:row.region_key || geo.region(row.address,regionNames), settlement:geo.settlement(row.address), district:geo.district(row.address), object_category:geo.category(row.object_name)};
        it.original_coords = hasCoordinates(it) ? {lat:it.lat, lon:it.lon} : null;
        const approximate = !hasCoordinates(it) && geo.locate(it, placeLookup);
        if (approximate) Object.assign(it, approximate);
        it.base_coords = {lat:it.lat, lon:it.lon, coord_source:it.coord_source};
        if (hasCoordinates(overrides[it.doc_number] || {})) Object.assign(it, overrides[it.doc_number], {coord_source:'manual'});
        return it;
      });
}
async function setData(rows, label) {
  const version=++viewVersion;
  await ensurePlaces(rows);
  if(version!==viewVersion)return;
  const previous = {};
  for (const id of ['filter-region','filter-town','filter-category','filter-document']) previous[id]=$(id).value;
  items = prepareItems(rows);
  const available = new Set(items.map(it=>it.doc_number));
  selected = new Set([...selected].filter(id=>available.has(id)));
  populateFilters();
  for (const [id,value] of Object.entries(previous)) if ([...$(id).options].some(o=>o.value===value)) $(id).value=value;
  $('dataset-label').textContent=label;
  refresh();
}
window.ConstructionApp={setData, refresh, reload:(options={})=>loadData(true,Boolean(options.automatic)), regionChanged(){ $('filter-town').value='';refresh(); }};
function populateFilters() {
  for (const [id,key,empty] of [['filter-region','region_key','Усі області'],['filter-town','settlement','Усі населені пункти'],['filter-category','object_category','Усі типи об’єктів'],['filter-document','doc_type','Усі типи документів']]) {
    const counts = new Map(key==='region_key'?Object.keys(regionNames).map(key=>[key,0]):[]);
    for (const it of items) { const value = it[key] || 'Не визначено'; counts.set(value, (counts.get(value) || 0) + 1); }
    $(id).replaceChildren(new Option(empty, ''), ...[...counts].sort((a,b)=>a[0].localeCompare(b[0],'uk')).map(([value,count]) => new Option(`${key==='region_key'?(regionNames[value] || value):value} (${count})`,value)));
  }
}
function renderTabs() {
  const counts=new Map();for(const it of items)counts.set(it.object_category,(counts.get(it.object_category)||0)+1);
  const tabs=$('category-tabs');tabs.replaceChildren();
  for(const [value,label] of [['',`Усі (${items.length})`],...[...counts].sort((a,b)=>a[0].localeCompare(b[0],'uk')).map(([name,count])=>[name,`${name} (${count})`])]) {
    const button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected',String($('filter-category').value===value));button.className=$('filter-category').value===value?'tab active':'tab';button.textContent=label;
    button.addEventListener('click',()=>{$('filter-category').value=value;refresh();});tabs.appendChild(button);
  }
}
function renderSelection() {
  const tray=$('selected-stops');tray.replaceChildren();
  for(const it of items.filter(it=>selected.has(it.doc_number))) {
    const entry=document.createElement('span');entry.className='selected-stop';
    const text=document.createElement('span');text.textContent=`${it.settlement||'Об’єкт'} · ${it.doc_number}`;entry.appendChild(text);
    addButton(entry,'Прибрати',()=>toggleSelection(it.doc_number,false));tray.appendChild(entry);
  }
}
function filteredItems() {
  const q = geo.norm($('search').value), town = $('filter-town').value;
  return items.filter(it => (!window.CollectionManager || window.CollectionManager.selectedKeys.has(it.region_key)) && (!town || (it.settlement || 'Не визначено') === town) &&
    (!$('filter-category').value || it.object_category === $('filter-category').value) &&
    (!$('filter-document').value || (it.doc_type || 'Не визначено') === $('filter-document').value) &&
    (!$('filter-from').value || (it.reg_date && it.reg_date >= $('filter-from').value)) &&
    (!$('filter-to').value || (it.reg_date && it.reg_date <= $('filter-to').value)) &&
    (!$('filter-location').value || ($('filter-location').value === 'missing' ? !hasCoordinates(it) : $('filter-location').value === 'exact' ? hasCoordinates(it) && !['settlement','registry_street'].includes(it.coord_source) : hasCoordinates(it))) &&
    (!q || geo.norm([it.doc_number,it.object_name,it.address,it.customer,it.status,it.doc_type,it.settlement,it.object_category,it.location_description,it.full_address,it.street_address,...(it.cadastral_numbers || [])].join(' ')).includes(q)))
    .sort((a,b) => String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), 'uk') * sortDir);
}
function resetFilters() {
  for(const id of ['search','filter-region','filter-town','filter-category','filter-document','filter-from','filter-to','filter-location'])$(id).value='';
  const available=[...new Set(items.map(it=>it.region_key).filter(Boolean))];
  if(window.CollectionManager?.reset)window.CollectionManager.reset(available.includes('lviv')?['lviv']:available.slice(0,1));
  refresh();
}
function filterSummary() {
  const keys=window.CollectionManager?[...window.CollectionManager.selectedKeys]:[];
  const text=['Області: '+(window.CollectionManager?(keys.length?keys.map(key=>regionNames[key]||key).join(', '):'не обрані'):'усі завантажені')];
  if($('search').value.trim())text.push('Пошук: '+$('search').value.trim());
  for(const [id,label] of [['filter-town','Населений пункт'],['filter-category','Тип об’єкта'],['filter-document','Документ'],['filter-from','Від'],['filter-to','До'],['filter-location','Розташування']])if($(id).value)text.push(label+': '+$(id).value);
  if($('active-filters'))$('active-filters').textContent=text.join(' · ');
}
function refresh(fit = true) {
  filterSummary(); clearRoute(); renderTable(); renderTabs(); updateMarkers(fit); updateCounts();
}
function updateCounts() {
  const list = filteredItems(), located = list.filter(hasCoordinates).length;
  $('result-count').textContent = `Знайдено: ${list.length} із ${items.length} · На карті: ${located} · Без точки: ${list.length - located} · Обрано: ${selected.size}`;
  $('btn-route').disabled = selected.size < 2;
  renderSelection();
  $('btn-select-visible').disabled = !located;
  $('selection-count').textContent = `Спільний маршрут: ${selected.size} / 10. Вибір зберігається при зміні вкладок і фільтрів.`;
  $('map-count').textContent = `${located} об’єктів на карті. Помаранчеві точки — приблизні місця (населений пункт або вулиця), сині — точні / уточнені точки. Число на точці означає кількість об’єктів.`;
}
function renderTable() {
  const list = filteredItems(), tbody = $('tbody'); tbody.replaceChildren();
  $('empty').style.display = list.length ? 'none' : 'block';
  $('btn-empty-reset').hidden = Boolean(list.length) || !items.length;
  const scope=window.CollectionManager?.selectedKeys;
  $('empty').textContent = scope && !scope.size ? 'Не обрано жодної області. Відмітьте регіон або натисніть «Скинути всі фільтри».' : scope && items.length && !items.some(it=>scope.has(it.region_key)) ? 'Для обраних областей немає завантажених записів. Оберіть інший регіон або запустіть збір.' : 'Нічого не знайдено за активними фільтрами. Натисніть «Скинути всі фільтри».';
  for (const it of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" aria-label="Обрати ${escapeAttr(it.doc_number)}" ${selected.has(it.doc_number)?'checked':''} ${hasCoordinates(it)?'':'disabled'}></td>
      <td>${escapeHtml(it.reg_date || '—')}</td>
      <td><a href="${escapeAttr(safeUrl(it.detail_url))}" target="_blank" rel="noopener">${escapeHtml(it.doc_number)}</a>${it.comparison==='new'?'<br><span class="badge">Новий</span>':it.comparison==='changed'?'<br><span class="badge">Змінено</span>':''}</td>
      <td><strong>${escapeHtml(it.settlement || 'Не визначено')}</strong><br><small>${escapeHtml(it.district ? it.district + ' район' : '')}</small></td>
      <td>${escapeHtml(it.object_name || '—')}<br><span class="badge">${escapeHtml(it.object_category)}</span></td>
      <td>${escapeHtml(it.doc_type || '—')}</td><td>${escapeHtml(it.full_address || it.address || '—')}${it.location_description ? '<br><small>'+escapeHtml(it.location_description)+'</small>' : ''}</td>
      <td>${escapeHtml(it.customer || '—')}</td><td>${escapeHtml(it.status || '—')}</td>
      <td><span class="location-label">${escapeHtml(coordLabel(it))}</span><div class="row-actions"></div></td>`;
    tr.querySelector('input').addEventListener('change', event => { toggleSelection(it.doc_number,event.target.checked); });
    const actions = tr.querySelector('.row-actions');
    if (hasCoordinates(it)) addButton(actions,'На карті',()=>showOnMap(it));
    addButton(actions,'Уточнити точку',()=>startPin(it));
    if (it.cadastral_numbers?.length) { const a = document.createElement('a'); a.href='https://map.land.gov.ua/?cadnum='+encodeURIComponent(it.cadastral_numbers[0]); a.target='_blank'; a.rel='noopener'; a.textContent='Ділянка у кадастрі ↗'; actions.appendChild(a); }
    if (it.coord_source === 'manual') addButton(actions,'Скинути точку',()=>resetPin(it));
    tbody.appendChild(tr);
  }
}
function addButton(parent,label,callback) { const b=document.createElement('button'); b.type='button';b.className='small secondary';b.textContent=label;b.addEventListener('click',callback);parent.appendChild(b); }
function toggleSelection(id,on) {
  if (on && selected.size >= 10) { alert('Для одного маршруту можна обрати до 10 об’єктів.'); renderTable(); return; }
  if(on)selected.add(id);else selected.delete(id);
  clearRoute();renderTable();updateCounts();updateMarkers(false);
}
function initMap() {
  if(typeof L === 'undefined') { $('map').textContent='Карта недоступна. Перевірте інтернет і оновіть сторінку.';return; }
  map=L.map('map').setView([49,31],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap · населені пункти: <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)',maxZoom:19}).addTo(map);
  markersLayer=L.layerGroup().addTo(map);routeLayer=L.layerGroup().addTo(map);
  map.on('click',event=>{ if(pinTarget){$('pin-lat').value=event.latlng.lat.toFixed(6);$('pin-lon').value=event.latlng.lng.toFixed(6);$('pin-message').textContent='Точку обрано. Натисніть «Зберегти точку».';} });
}
function updateMarkers(fit=true) {
  if(!markersLayer)return;
  markersLayer.clearLayers();
  const groups=new Map(), bounds=[];
  for(const it of filteredItems().filter(hasCoordinates)) {
    const key=`${it.lat.toFixed(6)},${it.lon.toFixed(6)}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(it);
  }
  for(const group of groups.values()) {
    const first=group[0], approximate=group.every(it=>['settlement','registry_street'].includes(it.coord_source)), active=group.some(it=>selected.has(it.doc_number));
    const marker=L.marker([first.lat,first.lon],{icon:L.divIcon({className:'object-marker',html:`<span class="map-dot ${approximate?'approx':'exact'} ${active?'selected':''}">${group.length>1?group.length:'●'}</span>`,iconSize:[32,32],iconAnchor:[16,16]})});
    const popup=document.createElement('div');popup.className='object-popup';
    const heading=document.createElement('strong');heading.textContent=approximate?`${first.settlement} · приблизне розташування`:'Точка об’єкта';popup.appendChild(heading);
    const note=document.createElement('p');note.textContent=approximate?(first.coord_source==='registry_street'?'Знайдена вулиця без підтвердженого номера будинку.':'Центр населеного пункту. Це не точна адреса будівництва. Для виїзду уточніть точку.'):coordLabel(first);popup.appendChild(note);
    for(const it of group.slice(0,30)) {
      const entry=document.createElement('div');entry.className='popup-item';
      const text=document.createElement('p');text.textContent=`${it.doc_number} · ${it.object_name}`;entry.appendChild(text);
      addButton(entry,selected.has(it.doc_number)?'Прибрати з маршруту':'Додати до маршруту',()=>toggleSelection(it.doc_number,!selected.has(it.doc_number)));
      addButton(entry,'Уточнити точку',()=>startPin(it));popup.appendChild(entry);
    }
    if(group.length>30){const note=document.createElement('p');note.textContent='Решта об’єктів доступні у таблиці. Скористайтеся фільтром населеного пункту.';popup.appendChild(note);}
    marker.bindPopup(popup,{maxWidth:360,maxHeight:350});markersLayer.addLayer(marker);bounds.push([first.lat,first.lon]);
  }
  if(fit && bounds.length)map.fitBounds(bounds,{padding:[32,32],maxZoom:13});
}
function showOnMap(it) {
  if(!map)return;
  map.setView([it.lat,it.lon],['settlement','registry_street'].includes(it.coord_source)?13:17);
  $('map').scrollIntoView({behavior:'smooth',block:'center'});
  markersLayer.eachLayer(marker=>{const p=marker.getLatLng();if(Math.abs(p.lat-it.lat)<.000001 && Math.abs(p.lng-it.lon)<.000001)marker.openPopup();});
}
function startPin(it) {
  pinTarget=it;$('pin-editor').hidden=false;
  $('pin-heading').textContent=`Уточнити: ${it.doc_number} · ${it.settlement || 'населений пункт не визначений'}`;
  $('pin-lat').value=hasCoordinates(it)?it.lat:'';$('pin-lon').value=hasCoordinates(it)?it.lon:'';
  $('pin-message').textContent='Натисніть потрібне місце на карті або введіть координати. Точка зберігається у цьому браузері.';
  if(hasCoordinates(it))showOnMap(it);else $('pin-editor').scrollIntoView({behavior:'smooth',block:'center'});
}
function savePin(event) {
  event.preventDefault();if(!pinTarget)return;
  const lat=Number($('pin-lat').value),lon=Number($('pin-lon').value);
  if(!$('pin-lat').value || !$('pin-lon').value || !hasCoordinates({lat,lon}) || lat<44 || lat>53 || lon<22 || lon>41){$('pin-message').textContent='Введіть коректні координати в межах України.';return;}
  overrides[pinTarget.doc_number]={lat,lon};
  try{localStorage.setItem('construction-pins-v1',JSON.stringify(overrides));}catch(_){$('pin-message').textContent='Не вдалося зберегти. Дозвольте збереження даних у браузері.';return;}
  Object.assign(pinTarget,{lat,lon,coord_source:'manual'});pinTarget=null;$('pin-editor').hidden=true;refresh(false);
}
function resetPin(it) {
  const old=overrides[it.doc_number];delete overrides[it.doc_number];
  try{localStorage.setItem('construction-pins-v1',JSON.stringify(overrides));}catch(_){overrides[it.doc_number]=old;return;}
  Object.assign(it,it.base_coords);refresh(false);
}
function haversine(lat1,lon1,lat2,lon2) {
  const rad=x=>x*Math.PI/180,dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
}
function buildRoute(points) {
  const remaining=[...points],route=remaining.length?[remaining.shift()]:[];
  while(remaining.length){const last=route[route.length-1];let best=0;for(let i=1;i<remaining.length;i++)if(haversine(last.lat,last.lon,remaining[i].lat,remaining[i].lon)<haversine(last.lat,last.lon,remaining[best].lat,remaining[best].lon))best=i;route.push(remaining.splice(best,1)[0]);}return route;
}
function clearRoute(){if(routeLayer)routeLayer.clearLayers();$('route-panel').textContent='Оберіть 2–10 об’єктів у таблиці або на карті. Для приблизних точок спочатку перевірте адресу.';}
function onBuildRoute() {
  const route=buildRoute(items.filter(it=>selected.has(it.doc_number)&&hasCoordinates(it)));
  if(route.length<2)return;
  clearRoute();let km=0;for(let i=1;i<route.length;i++)km+=haversine(route[i-1].lat,route[i-1].lon,route[i].lat,route[i].lon);
  if(routeLayer){L.polyline(route.map(it=>[it.lat,it.lon]),{color:'#10b981',weight:4,dashArray:'7 6'}).addTo(routeLayer);map.fitBounds(route.map(it=>[it.lat,it.lon]),{padding:[32,32],maxZoom:15});}
  const approximate=route.some(it=>['settlement','registry_street'].includes(it.coord_source));
  const navigationTarget=it=>['settlement','registry_street'].includes(it.coord_source)&&it.street_address ? 'Україна, '+(it.full_address || it.address) : `${it.lat},${it.lon}`;
  const params=new URLSearchParams({api:'1',travelmode:'driving',origin:navigationTarget(route[0]),destination:navigationTarget(route.at(-1))});
  if(route.length>2)params.set('waypoints',route.slice(1,-1).map(navigationTarget).join('|'));
  $('route-panel').innerHTML=`<strong>Порядок об’їзду · ${km.toFixed(1)} км по прямій</strong><p>${approximate?'Увага: частина точок приблизна: центр населеного пункту або знайдена вулиця. Це не підтверджені позиції будівель. Уточніть точки для точного виїзду.':'Точки уточнено. Пунктир показує порядок відвідування, а не дороги.'}</p><ol>${route.map(it=>`<li>${escapeHtml(it.doc_number)} · ${escapeHtml(it.settlement || '')} · ${escapeHtml(it.address)} <small>(${escapeHtml(coordLabel(it))})</small></li>`).join('')}</ol><a href="https://www.google.com/maps/dir/?${escapeAttr(params)}" target="_blank" rel="noopener">Прокласти автомобільний маршрут у Google Maps ↗</a><p><small>Google Maps може обмежувати кількість проміжних зупинок у мобільному браузері.</small></p>`;
}
document.addEventListener('leaflet-ready',()=>{if(!map){try{initMap();updateMarkers();}catch(error){console.warn(error);}}});
function init(){
  $('btn-force-refresh').addEventListener('click',()=>{window.ParserStatus?.refresh(true);return loadData(true);});
  document.querySelectorAll('th[data-key]').forEach(th=>th.addEventListener('click',()=>{const key=th.dataset.key;if(key==='_select')return;if(sortKey===key)sortDir*=-1;else{sortKey=key;sortDir=key==='reg_date'?-1:1;}renderTable();}));
  $('search').addEventListener('input',()=>refresh());
  for(const id of ['filter-region','filter-town','filter-category','filter-document','filter-from','filter-to','filter-location'])$(id).addEventListener('change',()=>refresh());
  $('btn-reset-filters').addEventListener('click',resetFilters);
  $('btn-empty-reset').addEventListener('click',resetFilters);
  $('btn-clear').addEventListener('click',()=>{selected.clear();refresh(false);});
  $('btn-select-visible').addEventListener('click',()=>{for (const it of filteredItems().filter(hasCoordinates)) { if(selected.size>=10)break; selected.add(it.doc_number); }clearRoute();renderTable();updateCounts();updateMarkers(false);});
  $('btn-route').addEventListener('click',onBuildRoute);
  $('pin-editor').addEventListener('submit',savePin);
  $('pin-cancel').addEventListener('click',()=>{pinTarget=null;$('pin-editor').hidden=true;});
  loadData();
  try { initMap(); } catch(error) { $('map-note').textContent='Карта не завантажилася. Фільтри, знімки та вибір працюють.'; console.warn(error); }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
