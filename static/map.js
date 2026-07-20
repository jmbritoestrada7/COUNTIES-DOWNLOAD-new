(() => {
  const projectId = window.PROJECT.id;
  let counties = window.PROJECT.counties || [];
  const clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
  const status = document.getElementById('status');
  const LABEL_MIN_ZOOM = 7;

  const map = L.map('map', { zoomControl: true }).setView([38.2, -96.5], 4);
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });
  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' }
  );
  const topoLayer = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap' }
  );
  streetLayer.addTo(map);
  L.control.layers(
    { 'Calles': streetLayer, 'Satélite': satelliteLayer, 'Topográfico': topoLayer },
    {},
    { position: 'topleft', collapsed: false }
  ).addTo(map);

  const countyLayer = L.geoJSON(null, { style: countyStyle, onEachFeature: onEachCounty }).addTo(map);
  const countyLabels = L.layerGroup();
  const drawings = new L.FeatureGroup().addTo(map);
  let applyingRemote = false;

  const drawControl = new L.Control.Draw({
    edit: { featureGroup: drawings, remove: true },
    draw: { polyline: false, marker: false, circlemarker: false, circle: false, rectangle: true, polygon: { allowIntersection: false } }
  });
  map.addControl(drawControl);

  function countyMatch(feature) {
    const id = String(feature.id || '').padStart(5, '0');
    const sf = id.slice(0, 2);
    const name = String(feature.properties?.name || '').trim().toLocaleLowerCase();
    return counties.find(c => c.state_fips === sf && c.county_key === name);
  }

  function countyStyle(feature) {
    const hit = countyMatch(feature);
    if (!hit) return { color: '#64748b', weight: 0.35, fillOpacity: 0.015, fillColor: '#cbd5e1' };
    const downloaded = /download|descarg|complete|done|yes|si/i.test(hit.status || '');
    return { color: downloaded ? '#166534' : '#b45309', weight: 1.4, fillOpacity: .55, fillColor: downloaded ? '#16a34a' : '#f59e0b' };
  }

  function esc(v) {
    return String(v || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function strRows(hit) {
    const rows = [
      ['2–5 acres', hit.str_2_5],
      ['5–10 acres', hit.str_5_10],
      ['10–20 acres', hit.str_10_20],
      ['20–60 acres', hit.str_20_60],
      ['60–100 acres', hit.str_60_100],
      ['100+ acres', hit.str_100_plus]
    ].filter(([, value]) => value);
    if (!rows.length && hit.str) rows.push(['Average STR', hit.str]);
    if (!rows.length) return '<div class="empty-str">No hay valores STR en el Excel.</div>';
    return `<table class="str-table"><tbody>${rows.map(([band, value]) => `<tr><td>${esc(band)}</td><td><b>${esc(value)}</b></td></tr>`).join('')}</tbody></table>`;
  }

  function popupHtml(feature, hit) {
    const stateFips = String(feature.id || '').padStart(5, '0').slice(0, 2);
    if (!hit) {
      return `<div class="county-popup"><h3>${esc(feature.properties.name)} County</h3><div class="small">State FIPS: ${esc(stateFips)}</div><p>No está incluido en el Excel.</p></div>`;
    }
    return `<div class="county-popup">
      <h3>${esc(feature.properties.name)} County, ${esc(hit.state)}</h3>
      <div class="popup-meta"><b>Status:</b> ${esc(hit.status || 'Downloaded')}${hit.date ? `<br><b>Fecha:</b> ${esc(hit.date)}` : ''}</div>
      <h4>STR por acreage</h4>
      ${strRows(hit)}
      <label class="notes-label" for="countyNote">Notas</label>
      <textarea id="countyNote" class="county-note" maxlength="5000" placeholder="Escribe notas para este county…">${esc(hit.notes || '')}</textarea>
      <div class="popup-actions"><button type="button" class="save-note">Guardar nota</button><span class="note-state"></span></div>
    </div>`;
  }

  function bindNoteSaver(layer, hit) {
    const popup = layer.getPopup();
    if (!popup || !hit) return;
    const el = popup.getElement();
    if (!el) return;
    const button = el.querySelector('.save-note');
    const textarea = el.querySelector('.county-note');
    const noteState = el.querySelector('.note-state');
    if (!button || !textarea) return;
    button.addEventListener('click', async () => {
      button.disabled = true;
      noteState.textContent = 'Guardando…';
      try {
        const res = await fetch(`/api/projects/${projectId}/counties/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state_fips: hit.state_fips,
            county_key: hit.county_key,
            notes: textarea.value,
            sender: clientId
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
        Object.assign(hit, data.county);
        noteState.textContent = 'Guardada';
        renderCountyList();
        status.textContent = `Nota guardada en ${hit.county} County.`;
      } catch (err) {
        noteState.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  function onEachCounty(feature, layer) {
    layer.on('click', () => {
      const hit = countyMatch(feature);
      layer.bindPopup(popupHtml(feature, hit), { maxWidth: 380, minWidth: 290 }).openPopup();
      setTimeout(() => bindNoteSaver(layer, hit), 0);
    });
  }

  async function loadCountyBoundaries() {
    status.textContent = 'Cargando límites de counties…';
    try {
      const res = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
      const topo = await res.json();
      const geo = topojson.feature(topo, topo.objects.counties);
      countyLayer.addData(geo);
      refreshCountyStyles();
      status.textContent = 'Mapa listo. Acerca el mapa para ver los nombres.';
    } catch (e) {
      status.textContent = 'No se pudieron cargar los límites. Verifica la conexión a internet.';
    }
  }

  function refreshCountyStyles() {
    countyLayer.eachLayer(l => l.setStyle(countyStyle(l.feature)));
    renderCountyLabels();
    renderCountyList();
  }

  function renderCountyLabels() {
    countyLabels.clearLayers();
    if (map.getZoom() < LABEL_MIN_ZOOM) {
      if (map.hasLayer(countyLabels)) map.removeLayer(countyLabels);
      return;
    }
    countyLayer.eachLayer(layer => {
      const hit = countyMatch(layer.feature);
      if (!hit) return;
      const center = layer.getBounds().getCenter();
      countyLabels.addLayer(L.marker(center, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'county-name-label', html: `<span>${esc(hit.county)}</span>`, iconSize: null })
      }));
    });
    if (!map.hasLayer(countyLabels)) countyLabels.addTo(map);
  }

  function renderCountyList() {
    document.getElementById('countyCount').textContent = counties.length;
    document.getElementById('countyList').innerHTML = counties.map((c, i) => {
      const avg = c.str ? `<span class="str-badge">AVG ${esc(c.str)}</span>` : '';
      const note = c.notes ? `<br><span class="note-preview">📝 ${esc(c.notes)}</span>` : '';
      return `<button type="button" class="county-item county-jump" data-index="${i}"><b>${esc(c.county)}, ${esc(c.state)}</b>${avg}<br>${esc(c.status)} ${c.date ? '— ' + esc(c.date) : ''}${note}</button>`;
    }).join('') || '<div class="county-item">Sube un Excel para comenzar.</div>';
    document.querySelectorAll('.county-jump').forEach(btn => btn.addEventListener('click', () => zoomToCounty(counties[Number(btn.dataset.index)])));
  }

  function zoomToCounty(target) {
    let found = null;
    countyLayer.eachLayer(layer => {
      const hit = countyMatch(layer.feature);
      if (hit && hit.state_fips === target.state_fips && hit.county_key === target.county_key) found = layer;
    });
    if (found) {
      map.fitBounds(found.getBounds(), { padding: [35, 35], maxZoom: 9 });
      setTimeout(() => found.fire('click'), 250);
    }
  }

  function drawingsGeoJSON() { return drawings.toGeoJSON(); }

  async function saveDrawings() {
    if (applyingRemote) return;
    status.textContent = 'Guardando zonas…';
    const res = await fetch(`/api/projects/${projectId}/drawings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawings: drawingsGeoJSON(), sender: clientId })
    });
    status.textContent = res.ok ? 'Zonas guardadas y sincronizadas.' : 'Error guardando zonas.';
  }

  function replaceDrawings(geojson) {
    applyingRemote = true;
    drawings.clearLayers();
    L.geoJSON(geojson, {
      style: { color: '#7c3aed', weight: 3, fillColor: '#a78bfa', fillOpacity: .25 },
      onEachFeature: (f, l) => drawings.addLayer(l)
    });
    applyingRemote = false;
  }

  function upsertCounty(updated) {
    const index = counties.findIndex(c => c.state_fips === updated.state_fips && c.county_key === updated.county_key);
    if (index >= 0) counties[index] = updated;
  }

  map.on('zoomend', renderCountyLabels);
  map.on(L.Draw.Event.CREATED, e => {
    e.layer.setStyle?.({ color: '#7c3aed', weight: 3, fillColor: '#a78bfa', fillOpacity: .25 });
    drawings.addLayer(e.layer);
    saveDrawings();
  });
  map.on(L.Draw.Event.EDITED, saveDrawings);
  map.on(L.Draw.Event.DELETED, saveDrawings);

  const socket = io();
  socket.on('connect', () => {
    socket.emit('join_project', { project_id: projectId });
    status.textContent = 'Conectado en tiempo real.';
  });
  socket.on('disconnect', () => status.textContent = 'Sin conexión en tiempo real. Reconectando…');
  socket.on('drawings_updated', data => {
    if (data.sender !== clientId) {
      replaceDrawings(data.drawings);
      status.textContent = 'Otra persona actualizó las zonas.';
    }
  });
  socket.on('counties_updated', data => {
    counties = data.counties || [];
    refreshCountyStyles();
    status.textContent = 'El Excel fue actualizado por otro usuario.';
  });
  socket.on('county_note_updated', data => {
    if (data.sender !== clientId && data.county) {
      upsertCounty(data.county);
      renderCountyList();
      status.textContent = `Otra persona actualizó una nota en ${data.county.county} County.`;
      map.closePopup();
    }
  });

  document.getElementById('uploadForm').addEventListener('submit', async e => {
    e.preventDefault();
    const file = document.getElementById('excelFile').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    status.textContent = 'Procesando Excel…';
    const res = await fetch(`/api/projects/${projectId}/excel`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || 'Error al cargar Excel';
      return;
    }
    counties = data.counties;
    refreshCountyStyles();
    status.textContent = `${data.count} counties cargados.`;
    const bounds = [];
    countyLayer.eachLayer(l => { if (countyMatch(l.feature)) bounds.push(l.getBounds()); });
    if (bounds.length) {
      const b = bounds[0];
      bounds.slice(1).forEach(x => b.extend(x));
      map.fitBounds(b, { padding: [20, 20] });
    }
  });

  document.getElementById('shareUrl').textContent = location.href;
  document.getElementById('copyLink').onclick = async () => {
    await navigator.clipboard.writeText(location.href);
    status.textContent = 'Link copiado.';
  };

  renderCountyList();
  replaceDrawings(window.PROJECT.drawings || { type: 'FeatureCollection', features: [] });
  loadCountyBoundaries();
})();
