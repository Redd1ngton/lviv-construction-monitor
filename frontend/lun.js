async function loadLunPage(region, page, signal) {
  const params = new URLSearchParams({ region, page: String(page) });
  let response;
  try {
    response = await fetch('/api/lun?' + params, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(23000)])
    });
  } catch (error) {
    signal.throwIfAborted();
    throw Object.assign(error, { retryable: true });
  }
  const data = await response.json().catch(() => null);
  const retryAfter = response.headers.get('Retry-After');
  const retryMs = retryAfter && (/^\d+$/.test(retryAfter)
    ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now());
  if (!response.ok) {
    throw Object.assign(new Error(data?.message || `Сервер повернув HTTP ${response.status}.`), {
      retryable: data?.retryable ?? [429, 502, 503, 504].includes(response.status),
      retryMs
    });
  }
  if (data?.region !== region || data.page !== page || !Array.isArray(data.items)) {
    throw new Error('ЛУН повернув іншу сторінку.');
  }
  return { ...data, retryMs };
}

async function readSavedLunCatalog(region, signal) {
  try {
    const response = await fetch('./lun-data/' + encodeURIComponent(region) + '.json.gz', { signal });
    if (!response.ok) return null;
    const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
    const data = await new Response(stream).json();
    if (data.region !== region || !Array.isArray(data.items) ||
        !Number.isSafeInteger(data.pagesLoaded) || !Number.isSafeInteger(data.totalPages) ||
        data.pagesLoaded < 1 || data.pagesLoaded > data.totalPages) return null;
    return data;
  } catch {
    return null;
  }
}

function waitForLun(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

async function collectLunCatalog(catalog, signal, onPage, wait = waitForLun) {
  let failures = 0;
  while (!catalog.complete) {
    signal.throwIfAborted();
    const page = catalog.nextPage;
    let data;
    let failure;
    try {
      data = await loadLunPage(catalog.region, page, signal);
    } catch (error) {
      failure = error;
    }
    signal.throwIfAborted();
    if (data?.snapshot) {
      if (!catalog.pagesLoaded && !catalog.saved) {
        catalog.saved = { ...data, items: new Map(data.items.map(item => [item.id, item])), pagesLoaded: 1 };
      }
      failure = Object.assign(new Error(data.message || 'ЛУН тимчасово недоступний.'), data);
    }
    if (failure) {
      if (!failure.retryable || failures >= 3) throw failure;
      const delay = Math.max(2000 * 2 ** failures++, failure.retryMs || 0);
      // Long source pauses require a later user retry rather than a browser timer.
      if (delay > 300000) throw failure;
      catalog.retryMessage = `Сторінка ${page} · ${failure.message} Повтор через ${Math.ceil(delay / 1000)} с.`;
      onPage();
      await wait(delay, signal);
      catalog.retryMessage = '';
      continue;
    }
    failures = 0;

    if (!Number.isSafeInteger(data.totalPages) || data.totalPages < 1) {
      throw new Error('ЛУН не повідомив кількість сторінок.');
    }
    if (page === 1) catalog.fetchedAt = data.fetchedAt;
    for (const item of data.items) catalog.items.set(item.id, item);
    catalog.pagesLoaded = page;
    catalog.totalPages = data.totalPages;
    catalog.nextPage = page + 1;
    catalog.complete = page >= data.totalPages;
    if (catalog.complete || catalog.saved?.totalPages === null) catalog.saved = null;
    onPage();

    if (!catalog.complete) await wait(900, signal);
  }
}

function newLunCatalog(region, saved = null) {
  return { region, saved, items: new Map(), pagesLoaded: 0, totalPages: null, nextPage: 1, complete: false };
}

function listingsWithinRadius(items, map, center, meters) {
  return [...items].filter(item => !meters || !center || map.distance(center, [item.lat, item.lon]) <= meters);
}

if (typeof module !== 'undefined') module.exports = { collectLunCatalog, listingsWithinRadius };

if (typeof window !== 'undefined') window.initLunLayer = function initLunLayer(map, route, regionNamesReady) {
  const byId = id => document.getElementById(id);
  const panel = byId('lun-panel');
  const toggle = byId('lun-toggle');
  const regionSelect = byId('lun-region');
  const status = byId('lun-status');
  const preview = byId('lun-preview');
  const chooser = byId('lun-listing');
  const photo = byId('lun-photo');
  const photoStatus = byId('lun-photo-status');
  const routeButton = byId('lun-route');
  const radiusInput = byId('lun-radius');
  const centerButton = byId('lun-pick-center');
  const centerStatus = byId('lun-center-status');
  const retryButton = byId('lun-retry');
  const progress = byId('lun-progress');
  const layer = L.layerGroup();
  const radiusLayer = L.layerGroup();
  const catalogs = new Map();

  let regions = {};
  let catalog;
  let pending;
  let center;
  let centerName;
  let radiusTimer;
  let pickingCenter = false;
  let visibleItems = [];
  let renderTimer;
  let activeGroup = [];
  let activeListing;

  function syncRouteButton() {
    const selected = Boolean(activeListing && route.has(activeListing.id));
    routeButton.textContent = selected ? 'Прибрати з маршруту' : 'Додати до маршруту';
    routeButton.setAttribute('aria-pressed', String(selected));
  }

  function showListing(listing) {
    activeListing = listing;
    byId('lun-address').textContent = [listing.address, listing.locality]
      .filter((value, index, values) => value && values.indexOf(value) === index).join(', ') || 'Будинок на продаж';
    byId('lun-price').textContent = listing.price && listing.currency
      ? new Intl.NumberFormat('uk-UA', { style: 'currency', currency: listing.currency, maximumFractionDigits: 0 }).format(listing.price)
      : 'Ціну не вказано';
    byId('lun-link').href = listing.url;
    photo.hidden = !listing.photo;
    photoStatus.hidden = Boolean(listing.photo);
    if (listing.photo) {
      photo.alt = 'Фото будинку' + (listing.locality ? ' · ' + listing.locality : '');
      photo.src = listing.photo;
    } else {
      photo.removeAttribute('src');
    }
    preview.hidden = false;
    syncRouteButton();
  }

  function showGroup(group) {
    panel.open = true;
    if (activeGroup === group) return;

    activeGroup = group;
    byId('lun-listing-label').hidden = group.length === 1;
    chooser.replaceChildren(...group.map((listing, index) =>
      new Option(listing.address || 'Будинок ' + (index + 1), String(index))
    ));
    chooser.value = '0';
    showListing(group[0]);
  }

  function drawMarkers() {
    layer.clearLayers();
    const groups = new Map();
    const zoom = map.getZoom();
    const cluster = visibleItems.length > 150 && zoom < 15;

    for (const listing of visibleItems) {
      const point = cluster && map.project([listing.lat, listing.lon], zoom);
      const key = point
        ? Math.floor(point.x / 34) + ',' + Math.floor(point.y / 34)
        : listing.lat.toFixed(6) + ',' + listing.lon.toFixed(6);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(listing);
    }

    for (const group of groups.values()) {
      const listing = group[0];
      const title = group.length > 1
        ? 'ЛУН · ' + group.length + ' оголошень'
        : ['ЛУН', listing.locality, listing.address].filter(Boolean).join(' · ');
      const size = group.length > 99 ? 34 : 24;
      const marker = L.marker([listing.lat, listing.lon], {
        icon: L.divIcon({
          className: 'lun-marker',
          html: '<span class="lun-pin">' + (group.length > 1 ? group.length : '⌂') + '</span>',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2]
        }),
        title,
        alt: title,
        zIndexOffset: 250,
        bubblingMouseEvents: false
      });
      marker.on('mouseover', () => { if (!pickingCenter) showGroup(group); });
      marker.on('click', event => {
        if (pickingCenter) chooseCenter(event.latlng);
        else showGroup(group);
      });
      marker.addTo(layer);
    }
  }

  function radiusMeters() {
    const value = radiusInput.valueAsNumber;
    return Number.isFinite(value) && value > 0 ? value * 1000 : 0;
  }

  function updateStatus() {
    progress.hidden = !pending || !catalog;
    retryButton.hidden = !toggle.checked || Boolean(pending) || !(catalog?.error || catalog?.complete);
    if (!toggle.checked || !catalog) return;

    const displayed = catalog.saved ?? catalog;
    const pages = displayed.totalPages === null
      ? `Сторінок ${displayed.pagesLoaded}`
      : `Сторінки ${displayed.pagesLoaded} із ${displayed.totalPages}`;
    if (pending && catalog.totalPages !== null) {
      progress.max = catalog.totalPages;
      progress.value = catalog.pagesLoaded;
    } else {
      progress.removeAttribute('value');
    }

    const count = `На карті ${visibleItems.length} із ${displayed.items.size} оголошень`;
    const date = catalog.saved?.fetchedAt && new Date(catalog.saved.fetchedAt).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' });
    const savedNotice = date ? ' Збережені дані від ' + date + '.' : '';
    retryButton.textContent = catalog.nextPage === 1 || catalog.complete ? 'Оновити з ЛУН' : 'Продовжити завантаження';
    if (catalog.retryMessage && pending) {
      status.textContent = `${count} · ${pages}.${savedNotice} ${catalog.retryMessage}`;
    } else if (catalog.error) {
      status.textContent = `${count} · ${pages}.${savedNotice} ${catalog.error}`;
    } else if (pending) {
      const activity = catalog.saved ? 'Оновлюємо з ЛУН' : 'Завантажуємо сторінки ЛУН';
      const livePages = catalog.saved && catalog.totalPages !== null
        ? ` · сторінки ${catalog.pagesLoaded} із ${catalog.totalPages}` : '';
      status.textContent = `${activity}${livePages}. ${count} · ${pages}.${savedNotice}`;
    } else {
      status.textContent = `${count} · ${pages}.${savedNotice}`;
    }
  }

  function fitPoints(points) {
    if (!points.length) return;
    const size = map.getSize();
    const useSidePadding = size.x - panel.offsetWidth > 240;
    const paddingTopLeft = [24, useSidePadding ? 24 : Math.min(panel.offsetHeight + 24, size.y * 0.62)];
    const paddingBottomRight = [useSidePadding ? panel.offsetWidth + 24 : 24, 24];
    map.fitBounds(points, { paddingTopLeft, paddingBottomRight, maxZoom: 13 });
  }

  function showListings(fit = false) {
    clearTimeout(renderTimer);
    renderTimer = undefined;
    if (!toggle.checked || !catalog) return;
    const meters = radiusMeters();
    const displayed = catalog.saved ?? catalog;
    visibleItems = listingsWithinRadius(displayed.items.values(), map, center, meters);
    if (activeListing && !visibleItems.some(item => item.id === activeListing.id)) {
      activeGroup = [];
      activeListing = undefined;
      preview.hidden = true;
    }
    drawMarkers();
    updateStatus();
    if (fit) fitPoints(visibleItems.map(({ lat, lon }) => [lat, lon]));
  }

  function updateCenterStatus() {
    centerStatus.textContent = pickingCenter ? 'Натисніть на карті, щоб задати центр.'
      : radiusMeters() ? (centerName ? 'Центр радіуса · ' + centerName : 'Центр обрано на карті.')
        : 'Порожнє поле показує всю область.';
  }

  function applyRadius(fit = false) {
    radiusLayer.clearLayers();
    const meters = radiusMeters();
    updateCenterStatus();
    showListings(fit && !meters);
    if (meters && toggle.checked && catalog) {
      const circle = L.circle(center, {
        radius: meters, color: '#7c3aed', weight: 2, fillOpacity: 0.08, interactive: false
      }).addTo(radiusLayer);
      if (fit) fitPoints([circle.getBounds().getSouthWest(), circle.getBounds().getNorthEast()]);
    }
  }

  function setPickingCenter(active) {
    pickingCenter = active;
    centerButton.textContent = active ? 'Скасувати вибір' : 'Вказати центр на карті';
    map.getContainer().classList.toggle('lun-pick-center', active);
    updateCenterStatus();
  }

  function chooseCenter(latlng) {
    center = latlng;
    centerName = '';
    if (!radiusMeters()) radiusInput.value = '45';
    setPickingCenter(false);
    applyRadius(true);
  }

  async function loadPages() {
    if (!catalog || pending || catalog.complete) return;
    const current = catalog;
    const controller = new AbortController();
    pending = controller;
    current.error = '';
    current.retryMessage = '';
    updateStatus();
    try {
      if (!current.pagesLoaded && !current.saved) {
        const saved = await readSavedLunCatalog(current.region, controller.signal);
        controller.signal.throwIfAborted();
        if (saved) {
          current.saved = { ...saved, items: new Map(saved.items.map(item => [item.id, item])) };
          showListings(!radiusMeters());
        }
      }
      await collectLunCatalog(current, controller.signal, () => {
        if (pending !== controller) return;
        const firstPage = current.saved?.totalPages === null || (!current.saved && current.pagesLoaded === 1);
        if (firstPage || current.complete) {
          showListings(firstPage && !radiusMeters());
        } else if (!current.saved && !renderTimer) {
          renderTimer = setTimeout(showListings, 1300);
        }
        updateStatus();
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        const reason = error.name === 'TimeoutError' ? 'Сервер не відповів за 23 секунди.'
          : error.name === 'TypeError' ? 'Немає з’єднання із сервером.'
            : error.message || 'ЛУН тимчасово недоступний.';
        current.error = `Сторінка ${current.nextPage} · ${reason}`;
      }
    } finally {
      if (pending === controller) {
        pending = undefined;
        showListings();
      }
    }
  }

  function refreshCatalog() {
    if (catalog?.complete) {
      catalog = newLunCatalog(catalog.region, catalog);
      catalogs.set(catalog.region, catalog);
    }
    loadPages();
  }

  function updateLayer() {
    const selected = [...(window.CollectionManager?.selectedKeys ?? [])];
    const region = regionSelect.value || (selected.length === 1 ? selected[0] : '');
    if (toggle.checked && catalog?.region === region && map.hasLayer(layer)) return;

    pending?.abort();
    pending = undefined;
    clearTimeout(radiusTimer);
    clearTimeout(renderTimer);
    renderTimer = undefined;
    setPickingCenter(false);
    activeGroup = [];
    activeListing = undefined;
    preview.hidden = true;
    map.removeLayer(layer);
    map.removeLayer(radiusLayer);
    layer.clearLayers();
    radiusLayer.clearLayers();
    visibleItems = [];

    const ready = toggle.checked && Object.hasOwn(regions, region);
    radiusInput.disabled = !ready;
    centerButton.disabled = !ready;
    if (!ready) {
      updateStatus();
      retryButton.hidden = true;
      status.textContent = !toggle.checked ? 'Увімкніть точки, щоб переглянути будинки.'
        : !region ? 'Оберіть одну область у панелі ЛУН.'
          : 'Для цієї області добірка ЛУН недоступна. Виберіть іншу область.';
      return;
    }

    const changedRegion = catalog?.region !== region;
    if (changedRegion) {
      if (catalog) radiusInput.value = '';
      if (!catalogs.has(region)) catalogs.set(region, newLunCatalog(region));
      catalog = catalogs.get(region);
      center = regions[region].center;
      centerName = regions[region].city;
    }
    radiusLayer.addTo(map);
    layer.addTo(map);
    applyRadius(changedRegion);
    if (!catalog.error) loadPages();
  }

  centerButton.addEventListener('click', () => setPickingCenter(!pickingCenter));
  radiusInput.addEventListener('input', () => {
    clearTimeout(radiusTimer);
    radiusTimer = setTimeout(applyRadius, 180);
  });
  radiusInput.addEventListener('change', () => {
    clearTimeout(radiusTimer);
    applyRadius(true);
  });
  map.on('click', event => {
    if (!pickingCenter) return;
    event.lunCenterPicked = true;
    chooseCenter(event.latlng);
  });
  map.on('zoomend', () => { if (toggle.checked) drawMarkers(); });
  retryButton.addEventListener('click', refreshCatalog);

  photo.addEventListener('error', () => {
    photo.hidden = true;
    photoStatus.hidden = false;
  });
  chooser.addEventListener('change', () => {
    const listing = activeGroup[Number(chooser.value)];
    if (listing) showListing(listing);
  });
  routeButton.addEventListener('click', () => {
    if (activeListing) route.toggle(activeListing);
    syncRouteButton();
  });
  toggle.addEventListener('change', updateLayer);
  regionSelect.addEventListener('change', updateLayer);
  document.addEventListener('collection-change', () => {
    if (!regionSelect.value && toggle.checked) updateLayer();
  });

  Promise.all([
    fetch('./lun-regions.json').then(response => {
      if (!response.ok) throw new Error('Missing LUN regions');
      return response.json();
    }),
    regionNamesReady
  ]).then(([pages, names]) => {
    regions = pages;
    const options = Object.keys(pages).map(key => [key, names[key] ?? key]);
    options.sort((left, right) => left[1].localeCompare(right[1], 'uk'));
    for (const [key, name] of options) {
      regionSelect.appendChild(new Option(key === 'kyiv-city' ? 'Київ (місто)' : name + ' область', key));
    }
    toggle.disabled = false;
    regionSelect.disabled = false;
  }).catch(() => {
    status.textContent = 'Не вдалося завантажити перелік областей ЛУН.';
  });

  return syncRouteButton;
};
