/**
 * Frontend для монітора забудови Львівської області
 * Читає constructions.json і показує таблицю + карту + простий маршрут
 */

const DATA_URLS = [
  "./data.json",                    // якщо скопіювали в frontend/
  "../data/constructions.json",     // локально
  "/data/constructions.json",       // якщо Pages віддає з кореня
];

let items = [];
let sortKey = "reg_date";
let sortDir = -1; // новіші спочатку
let selected = new Set();
let map, markersLayer;

async function loadData() {
  for (const url of DATA_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      items = data.items || data || [];
      document.getElementById("meta").textContent =
        `Оновлено: ${data.updated_at || "—"} · Записів: ${items.length} · ${data.region || "Львівська"}`;
      return true;
    } catch (e) {
      console.warn("Не вдалося завантажити", url, e);
    }
  }
  document.getElementById("meta").textContent = "Дані не знайдено. Запустіть парсер.";
  document.getElementById("empty").style.display = "block";
  return false;
}

function filteredItems() {
  const q = (document.getElementById("search").value || "").toLowerCase().trim();
  let list = items;
  if (q) {
    list = list.filter(it => {
      const blob = [
        it.doc_number, it.object_name, it.address, it.customer, it.status
      ].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }
  list = [...list].sort((a, b) => {
    let va = a[sortKey] ?? "";
    let vb = b[sortKey] ?? "";
    if (sortKey === "reg_date") {
      va = va || "0000";
      vb = vb || "0000";
    }
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  });
  return list;
}

function renderTable() {
  const tbody = document.getElementById("tbody");
  const list = filteredItems();
  tbody.innerHTML = "";

  if (!list.length) {
    document.getElementById("empty").style.display = "block";
    return;
  }
  document.getElementById("empty").style.display = "none";

  for (const it of list) {
    const tr = document.createElement("tr");
    const hasCoords = it.lat != null && it.lon != null;
    const checked = selected.has(it.doc_number) ? "checked" : "";

    tr.innerHTML = `
      <td><input type="checkbox" data-id="${escapeAttr(it.doc_number)}" ${checked} ${hasCoords ? "" : "disabled"} title="${hasCoords ? "Обрати для маршруту" : "Немає координат"}" /></td>
      <td>${escapeHtml(it.reg_date || "—")}</td>
      <td><a href="${escapeAttr(it.detail_url || "#")}" target="_blank" rel="noopener">${escapeHtml(it.doc_number || "—")}</a></td>
      <td>${escapeHtml(it.object_name || "—")}</td>
      <td>${escapeHtml(it.address || "—")}</td>
      <td>${escapeHtml(it.customer || "—")}</td>
      <td>${escapeHtml(it.status || "—")}</td>
    `;
    tbody.appendChild(tr);
  }

  // Чекбокси
  tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      if (cb.checked) selected.add(id);
      else selected.delete(id);
      document.getElementById("btn-route").disabled = selected.size < 2;
      updateMarkers();
    });
  });
}

function initMap() {
  map = L.map("map").setView([49.84, 24.03], 9); // Львів
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 18,
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  updateMarkers();
}

function updateMarkers() {
  if (!markersLayer) return;
  markersLayer.clearLayers();
  const withCoords = items.filter(it => it.lat != null && it.lon != null);
  const bounds = [];

  for (const it of withCoords) {
    const isSel = selected.has(it.doc_number);
    const marker = L.circleMarker([it.lat, it.lon], {
      radius: isSel ? 9 : 6,
      color: isSel ? "#10b981" : "#3b82f6",
      fillColor: isSel ? "#10b981" : "#3b82f6",
      fillOpacity: 0.8,
      weight: 2,
    });
    marker.bindPopup(`
      <strong>${escapeHtml(it.object_name || it.doc_number)}</strong><br/>
      ${escapeHtml(it.address || "")}<br/>
      <small>${escapeHtml(it.reg_date || "")}</small><br/>
      <a href="${escapeAttr(it.detail_url || "#")}" target="_blank">Картка →</a>
    `);
    markersLayer.addLayer(marker);
    bounds.push([it.lat, it.lon]);
  }

  if (bounds.length) {
    try { map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 }); } catch (_) {}
  }
}

/** Простий nearest-neighbor TSP */
function buildRoute(points) {
  if (points.length < 2) return points;
  const remaining = [...points];
  const route = [remaining.shift()];
  while (remaining.length) {
    const last = route[route.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((p, i) => {
      const d = haversine(last.lat, last.lon, p.lat, p.lon);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    route.push(remaining.splice(bestIdx, 1)[0]);
  }
  return route;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function onBuildRoute() {
  const selectedItems = items.filter(it => selected.has(it.doc_number) && it.lat != null);
  if (selectedItems.length < 2) {
    alert("Оберіть щонайменше 2 об’єкти з координатами");
    return;
  }

  const route = buildRoute(selectedItems);
  let totalKm = 0;
  for (let i = 1; i < route.length; i++) {
    totalKm += haversine(route[i-1].lat, route[i-1].lon, route[i].lat, route[i].lon);
  }

  // Лінія на карті
  const latlngs = route.map(r => [r.lat, r.lon]);
  L.polyline(latlngs, { color: "#10b981", weight: 4, opacity: 0.8 }).addTo(markersLayer);

  // Текст
  const listHtml = route.map((r, i) =>
    `${i + 1}. ${escapeHtml(r.object_name || r.doc_number)} — ${escapeHtml(r.address || "")}`
  ).join("<br/>");

  // Google Maps multi-stop (до ~10 точок добре працює)
  const gmapsPoints = route.map(r => `${r.lat},${r.lon}`).join("/");
  const gmapsUrl = `https://www.google.com/maps/dir/${gmapsPoints}`;

  document.getElementById("route-panel").innerHTML = `
    <strong>Приблизний маршрут</strong> (~${totalKm.toFixed(1)} км, nearest-neighbor)<br/>
    ${listHtml}<br/><br/>
    <a href="${gmapsUrl}" target="_blank" rel="noopener">Відкрити в Google Maps →</a>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

// Ініціалізація
document.addEventListener("DOMContentLoaded", async () => {
  // Сортування по кліку на th
  document.querySelectorAll("th[data-key]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (key === "_select") return;
      if (sortKey === key) sortDir *= -1;
      else { sortKey = key; sortDir = key === "reg_date" ? -1 : 1; }
      renderTable();
    });
  });

  document.getElementById("search").addEventListener("input", () => renderTable());
  document.getElementById("btn-route").addEventListener("click", onBuildRoute);
  document.getElementById("btn-clear").addEventListener("click", () => {
    selected.clear();
    document.getElementById("btn-route").disabled = true;
    document.getElementById("route-panel").textContent =
      "Оберіть кілька об’єктів з координатами і натисніть «Побудувати маршрут».";
    renderTable();
    updateMarkers();
  });

  initMap();
  const ok = await loadData();
  if (ok) {
    renderTable();
    updateMarkers();
  }
});
