window.initLunLayer = function initLunLayer(map) {
  const toggle = document.getElementById('lun-toggle');
  const status = document.getElementById('lun-status');
  const layer = L.layerGroup();
  let loaded = false;

  toggle.disabled = false;
  toggle.addEventListener('change', async () => {
    if (!toggle.checked) {
      map.removeLayer(layer);
      return;
    }
    if (loaded) {
      layer.addTo(map);
      return;
    }

    toggle.disabled = true;
    status.textContent = 'Завантажуємо оголошення ЛУН…';
    try {
      const response = await fetch('/api/lun', { signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      for (const item of data.items) {
        const popup = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = item.locality || 'Будинок на продаж';
        const price = document.createElement('p');
        price.textContent = item.price && item.currency
          ? new Intl.NumberFormat('uk-UA', { style: 'currency', currency: item.currency, maximumFractionDigits: 0 }).format(item.price)
          : 'Ціну не вказано';
        const link = document.createElement('a');
        link.href = data.source;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Переглянути добірку на ЛУН';
        popup.append(title, price, link);

        L.circleMarker([item.lat, item.lon], {
          radius: 7, color: '#6d28d9', fillColor: '#a78bfa', fillOpacity: 0.9
        }).bindPopup(popup).addTo(layer);
      }
      loaded = true;
      layer.addTo(map);
      if (data.items.length) map.fitBounds(data.items.map(({ lat, lon }) => [lat, lon]), { padding: [24, 24], maxZoom: 13 });
      const snapshotDate = data.snapshot && data.fetchedAt
        ? ' · збережені дані від ' + new Date(data.fetchedAt).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' })
        : '';
      status.textContent = `ЛУН · ${data.items.length} точок із першої сторінки добірки${snapshotDate}`;
    } catch {
      layer.clearLayers();
      toggle.checked = false;
      status.textContent = 'ЛУН тимчасово недоступний. Увімкніть шар повторно, щоб спробувати ще раз.';
    } finally {
      toggle.disabled = false;
    }
  });
};
