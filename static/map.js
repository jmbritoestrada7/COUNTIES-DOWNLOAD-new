(() => {
  const projectId = window.PROJECT.id;
  let counties = window.PROJECT.counties || [];
  const clientId = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  const status = document.getElementById('status');
  const LABEL_MIN_ZOOM = 7;
  const savedSettings = window.PROJECT.view_settings || {};
  let stateFilter = savedSettings.state_filter || '';
  let strMin = Number.isFinite(Number(savedSettings.str_min)) && savedSettings.str_min !== null ? Number(savedSettings.str_min) : null;
  let strMax = Number.isFinite(Number(savedSettings.str_max)) && savedSettings.str_max !== null ? Number(savedSettings.str_max) : null;
  let searchFilter = savedSettings.search_filter || '';
  let layerSettings = Object.assign({ counties:true, county_labels:true, str_colors:true, drawings:true, drawing_labels:true }, savedSettings.layers || {});
  let settingsTimer = null;

  const map = L.map('map', { zoomControl: true }).setView([38.2, -96.5], 4);
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap' });
  streetLayer.addTo(map);
  L.control.layers({ Streets: streetLayer, Satellite: satelliteLayer, Topographic: topoLayer }, {}, { position: 'topleft', collapsed: false }).addTo(map);

  const countyLayer = L.geoJSON(null, { style: countyStyle, onEachFeature: onEachCounty }).addTo(map);
  const countyLabels = L.layerGroup();
  const drawings = new L.FeatureGroup().addTo(map);
  const drawingLabels = L.layerGroup().addTo(map);
  let applyingRemote = false;
  map.addControl(new L.Control.Draw({
    edit: { featureGroup: drawings, remove: true },
    draw: {
      polyline: false,
      marker: false,
      circlemarker: false,
      circle: { shapeOptions: drawingStyle() },
      rectangle: { shapeOptions: drawingStyle() },
      polygon: { allowIntersection: false, shapeOptions: drawingStyle() }
    }
  }));

  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function drawingStyle(color = '#7c3aed') { return { color, weight:3, fillColor:color, fillOpacity:.25 }; }
  function numericStr(c) { const n = Number(c?.str_value); return Number.isFinite(n) ? n : null; }
  function visibleCounty(c) {
    if (!c) return false;
    if (stateFilter && c.state !== stateFilter) return false;
    const avg = numericStr(c);
    if (strMin !== null && (avg === null || avg < strMin)) return false;
    if (strMax !== null && (avg === null || avg > strMax)) return false;
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
    if (value === null) return { color:'#64748b', label:'NO DATA', icon:'⚪' };
    if (value >= 200) return { color:'#dc2626', label:'HOT', icon:'🔥' };
    if (value >= 150) return { color:'#f97316', label:'WARM', icon:'🟠' };
    if (value >= 100) return { color:'#eab308', label:'COOL', icon:'🟡' };
    return { color:'#2563eb', label:'FROZEN', icon:'❄️' };
  }
  function strColor(value) { return marketTemperature(value).color; }
  function countyStyle(feature) {
    const hit = countyMatch(feature);
    if (!layerSettings.counties || !hit || !visibleCounty(hit)) return { color:'#64748b', weight:.25, opacity:0, fillOpacity:0, fillColor:'#cbd5e1' };
    const color = layerSettings.str_colors ? strColor(numericStr(hit)) : '#2f855a';
    return { color, weight:1.5, opacity:1, fillOpacity:.58, fillColor:color };
  }
  function strRows(hit) {
    const rows = [
      ['2–5 acres', hit.str_2_5], ['5–10 acres', hit.str_5_10], ['10–20 acres', hit.str_10_20],
      ['20–60 acres', hit.str_20_60], ['60–100 acres', hit.str_60_100], ['100+ acres', hit.str_100_plus]
    ].filter(([,v]) => v);
    if (!rows.length) return '<div class="empty-str">No STR-by-acreage values were found in the uploaded file.</div>';
    return `<table class="str-table"><tbody>${rows.map(([band,v]) => `<tr><td>${esc(band)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</tbody></table>`;
  }
  function popupHtml(feature, hit) {
    if (!hit) return `<div class="county-popup inactive-county"><h3>${esc(feature.properties.name)} County</h3><p>This county is not active in this project.</p><p class="small">Activate it with a neutral color. STR information can be added later by uploading a new Excel/CSV file.</p><button type="button" class="activate-county">Activate County</button><span class="activate-state"></span></div>`;
    return `<div class="county-popup">
      <h3>${esc(feature.properties.name)} County, ${esc(hit.state)}</h3>
      <div class="market-temp" style="background:${strColor(numericStr(hit))}">${marketTemperature(numericStr(hit)).icon} ${marketTemperature(numericStr(hit)).label}</div>
      <div class="avg-card" style="border-color:${strColor(numericStr(hit))}"><span>Average STR</span><strong>${esc(hit.str || 'N/A')}</strong></div>
      <div class="popup-meta"><b>Status:</b> ${esc(hit.status || 'Downloaded')}${hit.date ? `<br><b>Date:</b> ${esc(hit.date)}` : ''}</div>
      <h4>STR by acreage</h4>${strRows(hit)}
      <div class="form-grid">
        <label>Priority<input class="county-priority" value="${esc(hit.priority || '')}" placeholder="A, B, High..."></label>
        <label>Assigned to<input class="county-assigned" value="${esc(hit.assigned_to || '')}" placeholder="Name"></label>
        <label>Next review<input class="county-review" value="${esc(hit.next_review || '')}" placeholder="Date or note"></label>
      </div>
      <label class="notes-label">Notes</label><textarea class="county-note" maxlength="5000" placeholder="Enter notes for this county…">${esc(hit.notes || '')}</textarea>
      <div class="popup-actions"><button type="button" class="save-note">Save Information</button><span class="note-state"></span></div>
    </div>`;
  }
  function bindNoteSaver(layer, hit) {
    const el = layer.getPopup()?.getElement(); if (!el || !hit) return;
    const button = el.querySelector('.save-note');
    button?.addEventListener('click', async () => {
      button.disabled = true; el.querySelector('.note-state').textContent = 'Saving…';
      try {
        const res = await fetch(`/api/projects/${projectId}/counties/notes`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
          state_fips:hit.state_fips, county_key:hit.county_key, notes:el.querySelector('.county-note').value,
          priority:el.querySelector('.county-priority').value, assigned_to:el.querySelector('.county-assigned').value,
          next_review:el.querySelector('.county-review').value, sender:clientId
        })});
        const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not save');
        Object.assign(hit, data.county); el.querySelector('.note-state').textContent = 'Saved';
        renderAllPanels(); status.textContent = `Information saved for ${hit.county} County.`;
      } catch (e) { el.querySelector('.note-state').textContent = e.message; }
      finally { button.disabled = false; }
    });
  }
  function bindCountyActions(layer, feature, hit) {
    if (hit) { bindNoteSaver(layer, hit); return; }
    const el = layer.getPopup()?.getElement();
    const button = el?.querySelector('.activate-county');
    const state = el?.querySelector('.activate-state');
    button?.addEventListener('click', async () => {
      button.disabled = true; if (state) state.textContent = ' Activating…';
      try {
        const id = String(feature.id || '').padStart(5, '0');
        const res = await fetch(`/api/projects/${projectId}/counties/activate`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ state_fips:id.slice(0,2), county:feature.properties?.name }) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not activate county');
        counties = data.counties || [...counties, data.county];
        refreshCountyStyles(); renderAllPanels();
        status.textContent = `${data.county.county} County activated with neutral color.`;
        layer.bindPopup(popupHtml(feature, data.county), { maxWidth:420, minWidth:300 }).openPopup();
        setTimeout(() => bindCountyActions(layer, feature, data.county), 0);
      } catch (e) { if (state) state.textContent = ` ${e.message}`; button.disabled = false; }
    });
  }
  function onEachCounty(feature, layer) {
    layer.on('click', () => { const hit = countyMatch(feature); layer.bindPopup(popupHtml(feature, hit), { maxWidth:420, minWidth:300 }).openPopup(); setTimeout(() => bindCountyActions(layer, feature, hit), 0); });
  }
  async function loadCountyBoundaries() {
    status.textContent = 'Loading county boundaries…';
    try {
      const res = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
      const topo = await res.json(); countyLayer.addData(topojson.feature(topo, topo.objects.counties));
      refreshCountyStyles(); status.textContent = 'Map ready.';
      fitVisibleCounties();
    } catch { status.textContent = 'County boundaries could not be loaded. Check the connection.'; }
  }
  function refreshCountyStyles() { countyLayer.eachLayer(l => l.setStyle(countyStyle(l.feature))); renderCountyLabels(); renderAllPanels(); }
  function renderCountyLabels() {
    countyLabels.clearLayers();
    if (!layerSettings.county_labels || !layerSettings.counties || map.getZoom() < LABEL_MIN_ZOOM) { if (map.hasLayer(countyLabels)) map.removeLayer(countyLabels); return; }
    countyLayer.eachLayer(layer => { const hit = countyMatch(layer.feature); if (!visibleCounty(hit)) return; const center = layer.getBounds().getCenter(); countyLabels.addLayer(L.marker(center, { interactive:false, keyboard:false, icon:L.divIcon({ className:'county-name-label', html:`<span>${esc(hit.county)}</span>`, iconSize:null }) })); });
    if (!map.hasLayer(countyLabels)) countyLabels.addTo(map);
  }
  function filteredCounties() { return counties.filter(visibleCounty); }
  function renderCountyList() {
    const shown = filteredCounties(); document.getElementById('countyCount').textContent = `${shown.length} / ${counties.length}`;
    document.getElementById('countyList').innerHTML = shown.map(c => `<button type="button" class="county-item county-jump" data-key="${esc(c.state_fips)}|${esc(c.county_key)}"><b>${esc(c.county)}, ${esc(c.state)}</b><span class="str-badge" style="background:${strColor(numericStr(c))}22;color:${strColor(numericStr(c))}">${marketTemperature(numericStr(c)).icon} ${marketTemperature(numericStr(c)).label} · AVG ${esc(c.str || 'N/A')}</span><br>${esc(c.status)}${c.priority ? ` · Priority ${esc(c.priority)}` : ''}${c.notes ? `<span class="note-preview">📝 ${esc(c.notes)}</span>` : ''}</button>`).join('') || '<div class="county-item">No counties match these filters.</div>';
    document.querySelectorAll('.county-jump').forEach(btn => btn.onclick = () => { const [sf,key] = btn.dataset.key.split('|'); zoomToCounty(counties.find(c => c.state_fips===sf && c.county_key===key)); });
  }
  function renderStats() {
    const list = filteredCounties(); const vals = list.map(numericStr).filter(v => v !== null);
    const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    const best = list.filter(c => numericStr(c)!==null).sort((a,b)=>numericStr(b)-numericStr(a))[0];
    document.getElementById('stats').innerHTML = `<div><b>${list.length}</b><span>Visible counties</span></div><div><b>${avg===null?'N/A':avg.toFixed(1)+'%'}</b><span>Average STR</span></div><div><b>${vals.filter(v=>v>=100).length}</b><span>STR ≥ 100%</span></div><div><b>${vals.filter(v=>v>=150).length}</b><span>STR ≥ 150%</span></div>${best?`<div class="wide"><b>${esc(best.county)}, ${esc(best.state)} · ${esc(best.str)}</b><span>Highest Average STR</span></div>`:''}`;
  }
  function renderStateOptions() {
    const select = document.getElementById('stateFilter'); const current = select.value;
    const states = [...new Set(counties.map(c=>c.state).filter(Boolean))].sort();
    select.innerHTML = '<option value="">All states</option>' + states.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join(''); select.value = current;
  }
  function renderAllPanels() { renderStateOptions(); renderStats(); renderCountyList(); renderDrawnAreas(); }
  function zoomToCounty(target) { if (!target) return; let found; countyLayer.eachLayer(l => { const h=countyMatch(l.feature); if (h && h.state_fips===target.state_fips && h.county_key===target.county_key) found=l; }); if (found) { map.fitBounds(found.getBounds(), {padding:[35,35],maxZoom:9}); setTimeout(()=>found.fire('click'),250); } }
  function fitVisibleCounties() { const bounds=[]; countyLayer.eachLayer(l=>{ const h=countyMatch(l.feature); if (visibleCounty(h)) bounds.push(l.getBounds()); }); if (bounds.length) { const b=bounds[0]; bounds.slice(1).forEach(x=>b.extend(x)); map.fitBounds(b,{padding:[20,20]}); } }

  function currentViewSettings() {
    return { state_filter:stateFilter, str_min:strMin, str_max:strMax, search_filter:searchFilter, layers:{...layerSettings} };
  }
  function setAutosave(text) { const el=document.getElementById('autosaveState'); if(el) el.textContent=text; }
  function queueSettingsSave() {
    setAutosave('Saving…'); clearTimeout(settingsTimer);
    settingsTimer=setTimeout(async()=>{
      try {
        const res=await fetch(`/api/projects/${projectId}/settings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({view_settings:currentViewSettings(),sender:clientId})});
        if(!res.ok) throw new Error('Could not save settings');
        setAutosave('Saved');
      } catch(e) { setAutosave('Save failed'); }
    },500);
  }
  function applyLayerSettings() {
    document.querySelectorAll('[data-layer]').forEach(box=>{ box.checked=layerSettings[box.dataset.layer] !== false; });
    if (layerSettings.drawings) { if(!map.hasLayer(drawings)) drawings.addTo(map); } else if(map.hasLayer(drawings)) map.removeLayer(drawings);
    if (!layerSettings.drawing_labels && map.hasLayer(drawingLabels)) map.removeLayer(drawingLabels);
    refreshCountyStyles(); refreshDrawingLabels(); renderDrawnAreas();
  }
  function applySettingsToInputs() {
    document.getElementById('countySearch').value=searchFilter;
    document.getElementById('strMin').value=strMin===null?'':strMin;
    document.getElementById('strMax').value=strMax===null?'':strMax;
    document.getElementById('stateFilter').value=stateFilter;
  }

  function layerMeta(layer) {
    layer.feature = layer.feature || { type:'Feature', properties:{} };
    layer.feature.properties = layer.feature.properties || {};
    const p = layer.feature.properties;
    p.id = p.id || uid();
    p.name = p.name || 'Unnamed Area';
    p.color = p.color || '#7c3aed';
    p.visible = p.visible !== false;
    if (!p.shapeType) p.shapeType = layer instanceof L.Circle ? 'Circle' : layer instanceof L.Rectangle ? 'Rectangle' : 'Polygon';
    if (layer instanceof L.Circle) p.radius = layer.getRadius();
    return p;
  }
  function drawingCenter(layer) {
    if (layer.getBounds) return layer.getBounds().getCenter();
    if (layer.getLatLng) return layer.getLatLng();
    return null;
  }
  function applyDrawingAppearance(layer) {
    const p = layerMeta(layer);
    layer.setStyle?.(drawingStyle(p.color));
    if (!layerSettings.drawings || p.visible === false) {
      layer.setStyle?.({ opacity:0, fillOpacity:0 });
      if (layer._path) layer._path.style.pointerEvents = 'none';
    } else if (layer._path) layer._path.style.pointerEvents = '';
  }
  function refreshDrawingLabels() {
    drawingLabels.clearLayers();
    drawings.eachLayer(layer => {
      const p = layerMeta(layer);
      if (!layerSettings.drawings || !layerSettings.drawing_labels || p.visible === false) return;
      const center = drawingCenter(layer); if (!center) return;
      drawingLabels.addLayer(L.marker(center, { interactive:false, keyboard:false, icon:L.divIcon({ className:'area-label', html:`<span>${esc(p.name)}</span>`, iconSize:null }) }));
    });
    if (layerSettings.drawings && layerSettings.drawing_labels) { if(!map.hasLayer(drawingLabels)) drawingLabels.addTo(map); }
    else if(map.hasLayer(drawingLabels)) map.removeLayer(drawingLabels);
  }
  function drawingsGeoJSON() {
    const features = [];
    drawings.eachLayer(layer => {
      const p = { ...layerMeta(layer) };
      let feature;
      if (layer instanceof L.Circle) {
        const ll = layer.getLatLng();
        p.radius = layer.getRadius();
        feature = { type:'Feature', properties:p, geometry:{ type:'Point', coordinates:[ll.lng,ll.lat] } };
      } else {
        feature = layer.toGeoJSON();
        feature.properties = p;
      }
      features.push(feature);
    });
    return { type:'FeatureCollection', features };
  }
  async function saveDrawings() {
    if (applyingRemote) return;
    refreshDrawingLabels(); renderDrawnAreas();
    status.textContent = 'Saving drawn areas…'; setAutosave('Saving…');
    const res = await fetch(`/api/projects/${projectId}/drawings`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({drawings:drawingsGeoJSON(),sender:clientId}) });
    status.textContent = res.ok ? 'Drawn areas saved permanently and synchronized.' : 'Error saving drawn areas.'; setAutosave(res.ok?'Saved':'Save failed');
  }
  function addFeatureAsLayer(feature) {
    const p = feature.properties || {};
    let layer;
    if (p.shapeType === 'Circle' && feature.geometry?.type === 'Point') {
      const [lng,lat] = feature.geometry.coordinates;
      layer = L.circle([lat,lng], { ...drawingStyle(p.color), radius:Number(p.radius)||1000 });
      layer.feature = { type:'Feature', properties:{...p} };
    } else {
      L.geoJSON(feature, { style:drawingStyle(p.color), onEachFeature:(f,l)=>{ layer=l; } });
    }
    if (layer) { layerMeta(layer); applyDrawingAppearance(layer); drawings.addLayer(layer); }
  }
  function replaceDrawings(geojson) {
    applyingRemote = true; drawings.clearLayers(); drawingLabels.clearLayers();
    (geojson?.features || []).forEach(addFeatureAsLayer);
    applyingRemote = false; refreshDrawingLabels(); renderDrawnAreas();
  }
  function findDrawing(id) { let found=null; drawings.eachLayer(l=>{ if(layerMeta(l).id===id) found=l; }); return found; }
  function renderDrawnAreas() {
    const items=[]; drawings.eachLayer(layer=>items.push({layer,p:layerMeta(layer)}));
    document.getElementById('drawnCount').textContent = `${items.length}`;
    document.getElementById('drawnList').innerHTML = items.map(({p})=>`<div class="drawn-item"><div><div class="drawn-name">${esc(p.name)}</div><div class="drawn-type">${esc(p.shapeType)}</div></div><div class="drawn-actions"><button data-action="focus" data-id="${esc(p.id)}">Focus</button><button data-action="toggle" data-id="${esc(p.id)}" class="secondary">${p.visible===false?'Show':'Hide'}</button><button data-action="rename" data-id="${esc(p.id)}" class="secondary">Rename</button><button data-action="delete" data-id="${esc(p.id)}" class="danger">Delete</button></div></div>`).join('') || '<div class="county-item">No areas have been drawn yet.</div>';
    document.querySelectorAll('#drawnList button').forEach(btn=>btn.onclick=async()=>{
      const layer=findDrawing(btn.dataset.id); if(!layer)return; const p=layerMeta(layer);
      if(btn.dataset.action==='focus') { if(layer.getBounds) map.fitBounds(layer.getBounds(),{padding:[40,40]}); else map.setView(layer.getLatLng(),12); }
      if(btn.dataset.action==='toggle') { p.visible=p.visible===false; applyDrawingAppearance(layer); await saveDrawings(); }
      if(btn.dataset.action==='rename') { const name=prompt('Area name:',p.name); if(name?.trim()){p.name=name.trim();await saveDrawings();} }
      if(btn.dataset.action==='delete' && confirm(`Delete “${p.name}”?`)){drawings.removeLayer(layer);await saveDrawings();}
    });
  }
  function upsertCounty(updated) { const i=counties.findIndex(c=>c.state_fips===updated.state_fips&&c.county_key===updated.county_key); if(i>=0)counties[i]=updated; }

  map.on('zoomend', () => { renderCountyLabels(); refreshDrawingLabels(); });
  map.on(L.Draw.Event.CREATED, e => {
    const proposed = prompt('Name this area:', `Area ${drawings.getLayers().length + 1}`);
    if (proposed === null) return;
    const layer=e.layer; layer.feature={type:'Feature',properties:{id:uid(),name:proposed.trim()||`Area ${drawings.getLayers().length+1}`,shapeType:e.layerType==='circle'?'Circle':e.layerType==='rectangle'?'Rectangle':'Polygon',color:'#7c3aed',visible:true}};
    layerMeta(layer); applyDrawingAppearance(layer); drawings.addLayer(layer); saveDrawings();
  });
  map.on(L.Draw.Event.EDITED, e => { e.layers.eachLayer(layer=>layerMeta(layer)); saveDrawings(); });
  map.on(L.Draw.Event.DELETED, saveDrawings);

  document.getElementById('countySearch').addEventListener('input', e=>{ searchFilter=e.target.value.trim().toLowerCase(); refreshCountyStyles(); queueSettingsSave(); });
  document.getElementById('stateFilter').addEventListener('change', e=>{ stateFilter=e.target.value; refreshCountyStyles(); fitVisibleCounties(); queueSettingsSave(); });
  function updateStrRange() {
    const minRaw=document.getElementById('strMin').value, maxRaw=document.getElementById('strMax').value;
    strMin=minRaw===''?null:Number(minRaw); strMax=maxRaw===''?null:Number(maxRaw);
    document.querySelectorAll('.quick-ranges button').forEach(b=>b.classList.toggle('active',String(b.dataset.min)===minRaw&&String(b.dataset.max)===maxRaw));
    refreshCountyStyles(); fitVisibleCounties(); queueSettingsSave();
  }
  document.getElementById('strMin').addEventListener('change',updateStrRange);
  document.getElementById('strMax').addEventListener('change',updateStrRange);
  document.querySelectorAll('.quick-ranges button').forEach(btn=>btn.onclick=()=>{document.getElementById('strMin').value=btn.dataset.min;document.getElementById('strMax').value=btn.dataset.max;updateStrRange();});
  document.getElementById('clearFilters').onclick=()=>{ stateFilter='';strMin=null;strMax=null;searchFilter='';document.getElementById('countySearch').value='';document.getElementById('stateFilter').value='';document.getElementById('strMin').value='';document.getElementById('strMax').value='';document.querySelectorAll('.quick-ranges button').forEach(b=>b.classList.remove('active'));refreshCountyStyles();fitVisibleCounties();queueSettingsSave(); };
  document.querySelectorAll('[data-layer]').forEach(box=>box.addEventListener('change',()=>{layerSettings[box.dataset.layer]=box.checked;applyLayerSettings();queueSettingsSave();}));

  const socket=io();
  socket.on('connect',()=>{socket.emit('join_project',{project_id:projectId});status.textContent='Connected in real time.';});
  socket.on('disconnect',()=>status.textContent='Connection lost. Reconnecting…');
  socket.on('drawings_updated',d=>{if(d.sender!==clientId){replaceDrawings(d.drawings);status.textContent='Another user updated the drawn areas.';}});
  socket.on('counties_updated',d=>{counties=d.counties||[];refreshCountyStyles();status.textContent='The county data was updated by another user.';});
  socket.on('county_note_updated',d=>{if(d.sender!==clientId&&d.county){upsertCounty(d.county);renderAllPanels();status.textContent=`Another user updated ${d.county.county} County.`;map.closePopup();}});
  socket.on('settings_updated',d=>{if(d.sender!==clientId&&d.view_settings){const v=d.view_settings;stateFilter=v.state_filter||'';strMin=v.str_min??null;strMax=v.str_max??null;searchFilter=v.search_filter||'';layerSettings=Object.assign(layerSettings,v.layers||{});applySettingsToInputs();applyLayerSettings();status.textContent='Another user updated the map view.';}});
  socket.on('project_renamed',d=>{if(d.name){document.querySelector('.panel h2').textContent=d.name;document.title=d.name;}});

  document.getElementById('uploadForm').addEventListener('submit',async e=>{e.preventDefault();const file=document.getElementById('excelFile').files[0];if(!file)return;const fd=new FormData();fd.append('file',file);status.textContent='Processing file…';const res=await fetch(`/api/projects/${projectId}/excel`,{method:'POST',body:fd});const data=await res.json();if(!res.ok){status.textContent=data.error||'Error uploading file';return;}counties=data.counties;refreshCountyStyles();status.textContent=`${data.count} counties loaded.`;fitVisibleCounties();});
  document.getElementById('shareUrl').textContent=location.href;
  document.getElementById('copyLink').onclick=async()=>{await navigator.clipboard.writeText(location.href);status.textContent='Link copied.';};
  document.getElementById('renameProject').onclick=async()=>{const name=prompt('Project name:',document.querySelector('.panel h2').textContent);if(!name?.trim())return;const r=await fetch(`/api/projects/${projectId}/rename`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});const d=await r.json();if(!r.ok)return alert(d.error||'Could not rename');document.querySelector('.panel h2').textContent=d.name;document.title=d.name;};
  document.getElementById('duplicateProject').onclick=async()=>{const r=await fetch(`/api/projects/${projectId}/duplicate`,{method:'POST'});const d=await r.json();if(!r.ok)return alert(d.error||'Could not duplicate');location.href=d.url;};

  renderAllPanels(); replaceDrawings(window.PROJECT.drawings||{type:'FeatureCollection',features:[]}); applySettingsToInputs(); applyLayerSettings(); loadCountyBoundaries();
})();
