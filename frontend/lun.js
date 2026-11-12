window.initLunLayer = function initLunLayer(map, route, regionNamesReady) {
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
  const layer = L.layerGroup();

  let regions = {};
  let activeRegion = '';
  let pending;
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

  function renderListings(items) {
    const groups = new Map();
    for (const listing of items) {
      const key = listing.lat.toFixed(6) + ',' + listing.lon.toFixed(6);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(listing);
    }

    for (const group of groups.values()) {
      const listing = group[0];
      const title = ['ЛУН', listing.locality, listing.address].filter(Boolean).join(' · ');
      const marker = L.marker([listing.lat, listing.lon], {
        icon: L.divIcon({
          className: 'lun-marker',
          html: '<span class="lun-pin">' + (group.length > 1 ? group.length : '⌂') + '</span>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        }),
        title,
        alt: title,
        zIndexOffset: 250,
        bubblingMouseEvents: false
      });
      marker.on('mouseover click', () => showGroup(group));
      marker.addTo(layer);
    }
  }

  async function updateLayer() {
    const selected = [...(window.CollectionManager?.selectedKeys ?? [])];
    const region = regionSelect.value || (selected.length === 1 ? selected[0] : '');
    if (toggle.checked && region && region === activeRegion) return;

    pending?.abort();
    pending = undefined;
    activeRegion = '';
    activeGroup = [];
    activeListing = undefined;
    preview.hidden = true;
    map.removeLayer(layer);
    layer.clearLayers();

    if (!toggle.checked) {
      status.textContent = 'Увімкніть точки, щоб переглянути будинки.';
      return;
    }
    if (!region) {
      status.textContent = 'Оберіть одну область у панелі ЛУН.';
      return;
    }
    if (!Object.hasOwn(regions, region)) {
      status.textContent = 'Для цієї області добірка ЛУН недоступна. Виберіть іншу область у панелі.';
      return;
    }

    activeRegion = region;
    const controller = new AbortController();
    pending = controller;
    status.textContent = 'Завантажуємо оголошення ЛУН…';
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/lun?' + new URLSearchParams({ region }), { signal: controller.signal });
      const data = await response.json();
      if (!response.ok || data.region !== region || !Array.isArray(data.items)) throw new Error('Invalid LUN response');
      if (pending !== controller) return;

      renderListings(data.items);
      layer.addTo(map);
      if (data.items.length) {
        map.fitBounds(data.items.map(({ lat, lon }) => [lat, lon]), { padding: [28, 28], maxZoom: 13 });
      }
      const snapshotDate = data.snapshot && data.fetchedAt
        ? ' · збережені дані від ' + new Date(data.fetchedAt).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' })
        : '';
      status.textContent = data.items.length
        ? `${data.items.length} оголошень із першої сторінки${snapshotDate}. Наведіть або натисніть точку.`
        : 'Для цієї області немає оголошень із координатами.';
    } catch {
      if (pending !== controller) return;
      activeRegion = '';
      layer.clearLayers();
      toggle.checked = false;
      status.textContent = 'ЛУН тимчасово недоступний. Увімкніть точки повторно, щоб спробувати ще раз.';
    } finally {
      clearTimeout(timeout);
      if (pending === controller) pending = undefined;
    }
  }

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
