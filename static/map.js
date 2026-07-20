(() => {
  const projectId = window.PROJECT.id;
  let counties = window.PROJECT.counties || [];
  const clientId = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  const status = document.getElementById('status');
  const LABEL_MIN_ZOOM = 7;
  let stateFilter = '';
  let strFilter = 0;
  let searchFilter = '';

  const map = L.map('map', { zoomControl: true }).setView([38.2, -96.5], 4);
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap' });
  streetLayer.addTo(map);
  L.control.layers({ Calles: streetLayer, 'Satélite': satelliteLayer, 'Topográfico': topoLayer }, {}, { position: 'topleft', collapsed: false }).addTo(map);

  const countyLayer = L.geoJSON(null, { style: countyStyle, onEachFeature: onEachCounty }).addTo(map);
  const countyLabels = L.layerGroup();
  const drawings = new L.FeatureGroup().addTo(map);
  let applyingRemote = false;
  map.addControl(new L.Control.Draw({
    edit: { featureGroup: drawings, remove: true },
    draw: { polyline: false, marker: false, circlemarker: false, circle: false, rectangle: true, polygon: { allowIntersection: false } }
  }));

  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function numericStr(c) { const n = Number(c?.str_value); return Number.isFinite(n) ? n : null; }
  function visibleCounty(c) {
    if (!c) return false;
    if (stateFilter && c.state !== stateFilter) return false;
    const avg = numericStr(c);
    if (strFilter && (avg === null || avg < strFilter)) return false;
    if (searchFilter && !`${c.county} ${c.state}`.toLowerCase().includes(searchFilter)) return false;
    return true;
  }
  function countyMatch(feature) {
    const id = String(feature.id || '').padStart(5, '0');
    const sf = id.slice(0, 2);
    const name = String(feature.properties?.name || '').trim().toLocaleLowerCase();
    return counties.find(c => c.state_fips === sf && c.county_key === name);
  }
  function marketTemperature(value) {
    if (value === null) return { color:'#64748b', label:'SIN DATOS', icon:'⚪' };
    if (value >= 200) return { color:'#dc2626', label:'HOT', icon:'🔥' };
    if (value >= 150) return { color:'#f97316', label:'MEDIO', icon:'🟠' };
    if (value >= 100) return { color:'#eab308', label:'BAJO', icon:'🟡' };
    return { color:'#2563eb', label:'CONGELADO', icon:'❄️' };
  }
  function strColor(value) { return marketTemperature(value).color; }
  function countyStyle(feature) {
    const hit = countyMatch(feature);
    if (!hit || !visibleCounty(hit)) return { color:'#64748b', weight:.25, fillOpacity:.01, fillColor:'#cbd5e1' };
    const color = strColor(numericStr(hit));
    return { color, weight:1.5, fillOpacity:.58, fillColor:color };
  }
  function strRows(hit) {
    const rows = [
      ['2–5 acres', hit.str_2_5], ['5–10 acres', hit.str_5_10], ['10–20 acres', hit.str_10_20],
      ['20–60 acres', hit.str_20_60], ['60–100 acres', hit.str_60_100], ['100+ acres', hit.str_100_plus]
    ].filter(([,v]) => v);
    if (!rows.length) return '<div class="empty-str">No hay valores STR por acreage en el Excel.</div>';
    return `<table class="str-table"><tbody>${rows.map(([band,v]) => `<tr><td>${esc(band)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</tbody></table>`;
  }
  function popupHtml(feature, hit) {
    if (!hit) return `<div class="county-popup"><h3>${esc(feature.properties.name)} County</h3><p>No está incluido en el Excel.</p></div>`;
    return `<div class="county-popup">
      <h3>${esc(feature.properties.name)} County, ${esc(hit.state)}</h3>
      <div class="market-temp" style="background:${strColor(numericStr(hit))}">${marketTemperature(numericStr(hit)).icon} ${marketTemperature(numericStr(hit)).label}</div>
      <div class="avg-card" style="border-color:${strColor(numericStr(hit))}"><span>Average STR</span><strong>${esc(hit.str || 'N/D')}</strong></div>
      <div class="popup-meta"><b>Status:</b> ${esc(hit.status || 'Downloaded')}${hit.date ? `<br><b>Fecha:</b> ${esc(hit.date)}` : ''}</div>
      <h4>STR por acreage</h4>${strRows(hit)}
      <div class="form-grid">
        <label>Prioridad<input class="county-priority" value="${esc(hit.priority || '')}" placeholder="A, B, Alta..."></label>
        <label>Asignado a<input class="county-assigned" value="${esc(hit.assigned_to || '')}" placeholder="Nombre"></label>
        <label>Próxima revisión<input class="county-review" value="${esc(hit.next_review || '')}" placeholder="Fecha o nota"></label>
      </div>
      <label class="notes-label">Notas</label><textarea class="county-note" maxlength="5000" placeholder="Escribe notas para este county…">${esc(hit.notes || '')}</textarea>
      <div class="popup-actions"><button type="button" class="save-note">Guardar información</button><span class="note-state"></span></div>
    </div>`;
  }
  function bindNoteSaver(layer, hit) {
    const el = layer.getPopup()?.getElement(); if (!el || !hit) return;
    const button = el.querySelector('.save-note');
    button?.addEventListener('click', async () => {
      button.disabled = true; el.querySelector('.note-state').textContent = 'Guardando…';
      try {
        const res = await fetch(`/api/projects/${projectId}/counties/notes`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
          state_fips:hit.state_fips, county_key:hit.county_key, notes:el.querySelector('.county-note').value,
          priority:el.querySelector('.county-priority').value, assigned_to:el.querySelector('.county-assigned').value,
          next_review:el.querySelector('.county-review').value, sender:clientId
        })});
        const data = await res.json(); if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
        Object.assign(hit, data.county); el.querySelector('.note-state').textContent = 'Guardado';
        renderAllPanels(); status.textContent = `Información guardada en ${hit.county} County.`;
      } catch (e) { el.querySelector('.note-state').textContent = e.message; }
      finally { button.disabled = false; }
    });
  }
  function onEachCounty(feature, layer) {
    layer.on('click', () => { const hit = countyMatch(feature); layer.bindPopup(popupHtml(feature, hit), { maxWidth:420, minWidth:300 }).openPopup(); setTimeout(() => bindNoteSaver(layer, hit), 0); });
  }
  async function loadCountyBoundaries() {
    status.textContent = 'Cargando límites de counties…';
    try {
      const res = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
      const topo = await res.json(); countyLayer.addData(topojson.feature(topo, topo.objects.counties));
      refreshCountyStyles(); status.textContent = 'Mapa listo.';
      fitVisibleCounties();
    } catch { status.textContent = 'No se pudieron cargar los límites. Verifica la conexión.'; }
  }
  function refreshCountyStyles() { countyLayer.eachLayer(l => l.setStyle(countyStyle(l.feature))); renderCountyLabels(); renderAllPanels(); }
  function renderCountyLabels() {
    countyLabels.clearLayers();
    if (map.getZoom() < LABEL_MIN_ZOOM) { if (map.hasLayer(countyLabels)) map.removeLayer(countyLabels); return; }
    countyLayer.eachLayer(layer => { const hit = countyMatch(layer.feature); if (!visibleCounty(hit)) return; const center = layer.getBounds().getCenter(); countyLabels.addLayer(L.marker(center, { interactive:false, keyboard:false, icon:L.divIcon({ className:'county-name-label', html:`<span>${esc(hit.county)}</span>`, iconSize:null }) })); });
    if (!map.hasLayer(countyLabels)) countyLabels.addTo(map);
  }
  function filteredCounties() { return counties.filter(visibleCounty); }
  function renderCountyList() {
    const shown = filteredCounties(); document.getElementById('countyCount').textContent = `${shown.length} / ${counties.length}`;
    document.getElementById('countyList').innerHTML = shown.map(c => `<button type="button" class="county-item county-jump" data-key="${esc(c.state_fips)}|${esc(c.county_key)}"><b>${esc(c.county)}, ${esc(c.state)}</b><span class="str-badge" style="background:${strColor(numericStr(c))}22;color:${strColor(numericStr(c))}">${marketTemperature(numericStr(c)).icon} ${marketTemperature(numericStr(c)).label} · AVG ${esc(c.str || 'N/D')}</span><br>${esc(c.status)}${c.priority ? ` · Prioridad ${esc(c.priority)}` : ''}${c.notes ? `<span class="note-preview">📝 ${esc(c.notes)}</span>` : ''}</button>`).join('') || '<div class="county-item">No hay counties con estos filtros.</div>';
    document.querySelectorAll('.county-jump').forEach(btn => btn.onclick = () => { const [sf,key] = btn.dataset.key.split('|'); zoomToCounty(counties.find(c => c.state_fips===sf && c.county_key===key)); });
  }
  function renderStats() {
    const list = filteredCounties(); const vals = list.map(numericStr).filter(v => v !== null);
    const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    const best = list.filter(c => numericStr(c)!==null).sort((a,b)=>numericStr(b)-numericStr(a))[0];
    document.getElementById('stats').innerHTML = `<div><b>${list.length}</b><span>Counties visibles</span></div><div><b>${avg===null?'N/D':avg.toFixed(1)+'%'}</b><span>Average STR</span></div><div><b>${vals.filter(v=>v>100).length}</b><span>STR &gt; 100%</span></div><div><b>${vals.filter(v=>v>150).length}</b><span>STR &gt; 150%</span></div>${best?`<div class="wide"><b>${esc(best.county)}, ${esc(best.state)} · ${esc(best.str)}</b><span>Mayor Average STR</span></div>`:''}`;
  }
  function renderStateOptions() {
    const select = document.getElementById('stateFilter'); const current = select.value;
    const states = [...new Set(counties.map(c=>c.state).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Todos los estados</option>' + states.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join(''); select.value = current;
  }
  function renderAllPanels() { renderStateOptions(); renderStats(); renderCountyList(); }
  function zoomToCounty(target) { if (!target) return; let found; countyLayer.eachLayer(l => { const h=countyMatch(l.feature); if (h && h.state_fips===target.state_fips && h.county_key===target.county_key) found=l; }); if (found) { map.fitBounds(found.getBounds(), {padding:[35,35],maxZoom:9}); setTimeout(()=>found.fire('click'),250); } }
  function fitVisibleCounties() { const bounds=[]; countyLayer.eachLayer(l=>{ const h=countyMatch(l.feature); if (visibleCounty(h)) bounds.push(l.getBounds()); }); if (bounds.length) { const b=bounds[0]; bounds.slice(1).forEach(x=>b.extend(x)); map.fitBounds(b,{padding:[20,20]}); } }

  function drawingsGeoJSON(){ return drawings.toGeoJSON(); }
  async function saveDrawings(){ if(applyingRemote)return; status.textContent='Guardando zonas…'; const res=await fetch(`/api/projects/${projectId}/drawings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({drawings:drawingsGeoJSON(),sender:clientId})}); status.textContent=res.ok?'Zonas guardadas y sincronizadas.':'Error guardando zonas.'; }
  function replaceDrawings(geojson){ applyingRemote=true; drawings.clearLayers(); L.geoJSON(geojson,{style:{color:'#7c3aed',weight:3,fillColor:'#a78bfa',fillOpacity:.25},onEachFeature:(f,l)=>drawings.addLayer(l)}); applyingRemote=false; }
  function upsertCounty(updated){ const i=counties.findIndex(c=>c.state_fips===updated.state_fips&&c.county_key===updated.county_key); if(i>=0)counties[i]=updated; }

  map.on('zoomend', renderCountyLabels);
  map.on(L.Draw.Event.CREATED,e=>{e.layer.setStyle?.({color:'#7c3aed',weight:3,fillColor:'#a78bfa',fillOpacity:.25});drawings.addLayer(e.layer);saveDrawings();});
  map.on(L.Draw.Event.EDITED,saveDrawings); map.on(L.Draw.Event.DELETED,saveDrawings);

  document.getElementById('countySearch').addEventListener('input', e=>{ searchFilter=e.target.value.trim().toLowerCase(); refreshCountyStyles(); });
  document.getElementById('stateFilter').addEventListener('change', e=>{ stateFilter=e.target.value; refreshCountyStyles(); fitVisibleCounties(); });
  document.getElementById('strFilter').addEventListener('change', e=>{ strFilter=Number(e.target.value)||0; refreshCountyStyles(); fitVisibleCounties(); });
  document.getElementById('clearFilters').onclick=()=>{ stateFilter='';strFilter=0;searchFilter='';document.getElementById('countySearch').value='';document.getElementById('stateFilter').value='';document.getElementById('strFilter').value='0';refreshCountyStyles();fitVisibleCounties(); };

  const socket=io();
  socket.on('connect',()=>{socket.emit('join_project',{project_id:projectId});status.textContent='Conectado en tiempo real.';});
  socket.on('disconnect',()=>status.textContent='Sin conexión. Reconectando…');
  socket.on('drawings_updated',d=>{if(d.sender!==clientId){replaceDrawings(d.drawings);status.textContent='Otra persona actualizó las zonas.';}});
  socket.on('counties_updated',d=>{counties=d.counties||[];refreshCountyStyles();status.textContent='El Excel fue actualizado por otro usuario.';});
  socket.on('county_note_updated',d=>{if(d.sender!==clientId&&d.county){upsertCounty(d.county);renderAllPanels();status.textContent=`Otra persona actualizó ${d.county.county} County.`;map.closePopup();}});

  document.getElementById('uploadForm').addEventListener('submit',async e=>{e.preventDefault();const file=document.getElementById('excelFile').files[0];if(!file)return;const fd=new FormData();fd.append('file',file);status.textContent='Procesando Excel…';const res=await fetch(`/api/projects/${projectId}/excel`,{method:'POST',body:fd});const data=await res.json();if(!res.ok){status.textContent=data.error||'Error al cargar Excel';return;}counties=data.counties;refreshCountyStyles();status.textContent=`${data.count} counties cargados.`;fitVisibleCounties();});
  document.getElementById('shareUrl').textContent=location.href;
  document.getElementById('copyLink').onclick=async()=>{await navigator.clipboard.writeText(location.href);status.textContent='Link copiado.';};

  renderAllPanels(); replaceDrawings(window.PROJECT.drawings||{type:'FeatureCollection',features:[]}); loadCountyBoundaries();
})();
