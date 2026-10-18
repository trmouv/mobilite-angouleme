const $ = s => document.querySelector(s);
const state = { home: null, data: null, stopDirections: {} };
const DEFAULT_ADDRESS = '165 avenue Gambetta 16000 Angoulême';
const SAVED_PLACES_KEY = 'savedPlacesV1';

function fmtDistance(m){ return m < 1000 ? `${m} m` : `${(m/1000).toFixed(1)} km`; }
function leaveClock(arrival, walkMin, bufferMin){
  const d = new Date();
  if (arrival?.epoch) d.setTime(arrival.epoch * 1000);
  else d.setTime(Date.now() + Number(arrival?.minutes || 0) * 60000);
  d.setMinutes(d.getMinutes() - walkMin - bufferMin);
  return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}
function setStatus(t, error=false){ $('#status').textContent=t; $('#status').classList.toggle('error',error); }
function esc(v=''){ return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function safeColor(v=''){ return /^[0-9A-Fa-f]{6}$/.test(v) ? v : '111827'; }

async function readJsonResponse(response, context='Réponse serveur'){
  const text = await response.text();
  if(!text.trim()) throw new Error(`${context} : réponse vide du serveur`);
  let data;
  try { data = JSON.parse(text); }
  catch {
    const preview = text.replace(/\s+/g,' ').trim().slice(0,140);
    throw new Error(`${context} : réponse serveur invalide${preview ? ` — ${preview}` : ''}`);
  }
  if(!response.ok) throw new Error(data?.error || `${context} : erreur ${response.status}`);
  return data;
}

async function geocode(address){
  const r = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
  const j = await readJsonResponse(r,'Recherche d’adresse');
  if(!j.results?.length) throw new Error(j.error || 'Adresse introuvable');
  return j.results[0];
}

function getSavedPlaces(){
  try {
    const places = JSON.parse(localStorage.getItem(SAVED_PLACES_KEY) || '[]');
    return Array.isArray(places) ? places : [];
  } catch { return []; }
}
function setSavedPlaces(places){ localStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(places)); }
function placeTitle(place){
  if(place.type === 'home') return 'Domicile';
  if(place.type === 'work') return 'Travail';
  return place.name || place.label || place.address || 'Adresse enregistrée';
}
function renderSavedPlaces(){
  const select = $('#savedPlaces');
  if(!select) return;
  const places = getSavedPlaces();
  select.innerHTML = '<option value="">Adresses enregistrées…</option>' + places.map(p =>
    `<option value="${esc(p.id)}">${esc(placeTitle(p))} — ${esc(p.address || p.label || '')}</option>`
  ).join('');
  $('#useSavedPlace').disabled = !select.value;
  $('#deleteSavedPlace').disabled = !select.value;
}
function currentAddressValue(){ return $('#address')?.value.trim() || ''; }

async function saveCurrentPlace(){
  try {
    const address = currentAddressValue();
    if(!address) throw new Error('Saisis d’abord une adresse.');
    const point = state.home && (state.home.label === address || localStorage.getItem('homeAddress') === address)
      ? state.home : await geocode(address);
    const type = $('#savePlaceType')?.value || 'other';
    const customName = $('#savePlaceName')?.value.trim() || '';
    const places = getSavedPlaces();
    const normalized = address.toLocaleLowerCase('fr-FR');
    let id = (type === 'home' || type === 'work') ? type : `other-${Date.now()}`;
    const existingIndex = (type === 'home' || type === 'work')
      ? places.findIndex(p => p.type === type)
      : places.findIndex(p => (p.address || '').toLocaleLowerCase('fr-FR') === normalized && p.type === 'other');
    const place = { id, type, name: type === 'other' ? (customName || point.label || address) : '', address, label: point.label || address, lat: point.lat, lon: point.lon };
    if(existingIndex >= 0){ place.id = places[existingIndex].id; places[existingIndex] = place; }
    else places.push(place);
    setSavedPlaces(places);
    renderSavedPlaces();
    setStatus(`${placeTitle(place)} enregistré.`);
  } catch(e){ setStatus(e.message,true); }
}

async function useSavedPlace(){
  const id = $('#savedPlaces')?.value;
  const place = getSavedPlaces().find(p => p.id === id);
  if(!place) return;
  $('#address').value = place.address || place.label || '';
  state.home = { lat: place.lat, lon: place.lon, label: place.label || place.address };
  localStorage.setItem('homeAddress', $('#address').value.trim());
  localStorage.setItem('homePoint', JSON.stringify(state.home));
  $('#geocodeState').textContent = `Adresse sélectionnée : ${state.home.label}`;
  await loadMobility();
}
function deleteSavedPlace(){
  const id = $('#savedPlaces')?.value;
  if(!id) return;
  setSavedPlaces(getSavedPlaces().filter(p => p.id !== id));
  renderSavedPlaces();
  setStatus('Adresse enregistrée supprimée.');
}

async function loadMobility(){
  if(!state.home) return;
  setStatus('Actualisation des transports et vélos…');
  const speed = $('#speed').value;
  const url = `/api/mobility?lat=${encodeURIComponent(state.home.lat)}&lon=${encodeURIComponent(state.home.lon)}&speedKmh=${encodeURIComponent(speed)}&maxWalkMin=10&bikeLimit=4`;
  const r = await fetch(url);
  const j = await readJsonResponse(r,'Données mobilité');
  state.data = j;
  render();
  const t = new Date(j.generatedAt || Date.now()).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  setStatus(`Mis à jour à ${t} · ${state.home.label}`);
}

function directionRows(direction){
  return (direction?.routeDirections || []).filter(r => Array.isArray(r.passages) && r.passages.length > 0);
}
function visibleDirections(stop){
  const directions = stop.directions?.length ? stop.directions : [{ id: `${stop.id}:default`, label: 'Direction', routeDirections: stop.routeDirections || [] }];
  return directions.map(d => ({...d, routeDirections: directionRows(d)})).filter(d => d.routeDirections.length > 0);
}
function stopHasPassages(stop){ return visibleDirections(stop).length > 0; }

function render(){
  const buffer = Number($('#buffer').value);
  const bikes = state.data?.bikes || [];
  $('#bikes').innerHTML = bikes.length ? bikes.map((b,i)=>`
    <article class="card">
      <span class="rank">#${i+1} · ${b.walkMinutes} min à pied · ${fmtDistance(b.distanceMeters)}</span>
      <h3>${esc(b.name)}</h3>
      <div class="bike-numbers">
        <div class="metric"><b>${b.bikesAvailable}</b><span>vélo${b.bikesAvailable===1?'':'s'} disponible${b.bikesAvailable===1?'':'s'}</span></div>
        <div class="metric"><b>${b.docksAvailable}</b><span>place${b.docksAvailable===1?'':'s'} libre${b.docksAvailable===1?'':'s'}</span></div>
      </div>
    </article>`).join('') : '<div class="empty">Aucune station vélo trouvée dans le rayon défini.</div>';

  const stops = (state.data?.busStops || []).filter(stopHasPassages);
  $('#busCount').textContent = `${stops.length} arrêt${stops.length===1?'':'s'} avec passage · ≤ 10 min`;
  $('#buses').innerHTML = stops.length ? stops.map((s,i)=>{
    const directions = visibleDirections(s);
    let selected = Number(state.stopDirections[s.id] ?? 0);
    if (!Number.isInteger(selected) || selected < 0 || selected >= directions.length) selected = 0;
    state.stopDirections[s.id] = selected;
    const direction = directions[selected];
    const rows = direction.routeDirections || [];
    const canSwitch = directions.length > 1;
    return `
    <article class="bus-card">
      <div class="bus-head">
        <div class="stop-title-wrap">
          <span class="rank">#${i+1} · ${fmtDistance(s.distanceMeters)}</span>
          <div class="stop-title-row">
            <h3>${esc(s.name)}</h3>
            ${canSwitch ? `<button class="direction-toggle" type="button" data-stop-id="${esc(s.id)}" aria-label="Changer la direction à ${esc(s.name)}">↔ Changer de direction</button>` : ''}
          </div>
          <div class="direction-label">Direction : <strong>${esc(direction.label)}</strong>${canSwitch ? ` <span>${selected+1}/${directions.length}</span>` : ''}</div>
        </div>
        <div class="walk">🚶 ${s.walkMinutes} min</div>
      </div>
      <div class="arrivals">
        ${rows.map(r=>{
          const first = r.passages[0];
          const next = r.passages.slice(1,3);
          return `
          <div class="arrival route-row">
            <div class="route" ${r.color ? `style="background:#${safeColor(r.color)}"` : ''}>${esc(r.route)}</div>
            <div class="route-main">
              <div class="headsign">${esc(r.headsign)}</div>
              <div class="times-line"><strong>dans ${first.minutes} min</strong>${next.length ? `<span>· puis ${next.map(p=>`${p.minutes} min`).join(' · ')}</span>` : ''}</div>
              <div class="sub ${r.realtime?'live':'scheduled'}">${r.realtime?'● temps réel':'horaire théorique'} · ${r.passages.map(p=>esc(p.time)).join(' · ')}</div>
            </div>
            <div class="leave"><span class="sub">Pars à</span><strong>${leaveClock(first,s.walkMinutes,buffer)}</strong></div>
          </div>`;
        }).join('')}
      </div>
    </article>`;
  }).join('') : '<div class="empty">Aucun arrêt avec passage prévu dans le rayon défini.</div>';
}

async function useAddress(){
  try{
    const address = currentAddressValue();
    if(!address) return;
    $('#saveAddress').disabled = true;
    $('#geocodeState').textContent = 'Recherche de l’adresse…';
    const result = await geocode(address);
    state.home = result;
    localStorage.setItem('homeAddress', address);
    localStorage.setItem('homePoint', JSON.stringify(result));
    $('#geocodeState').textContent = `Adresse reconnue : ${result.label}`;
    await loadMobility();
  }catch(e){ setStatus(e.message,true); $('#geocodeState').textContent=e.message; }
  finally{ $('#saveAddress').disabled=false; }
}

$('#saveAddress').addEventListener('click',useAddress);
$('#address').addEventListener('keydown',e=>{ if(e.key==='Enter') useAddress(); });
$('#refresh').addEventListener('click',()=>loadMobility().catch(e=>setStatus(e.message,true)));
$('#speed').addEventListener('change',()=>loadMobility().catch(e=>setStatus(e.message,true)));
$('#buffer').addEventListener('change',render);
$('#savePlace')?.addEventListener('click', saveCurrentPlace);
$('#useSavedPlace')?.addEventListener('click',()=>useSavedPlace().catch(e=>setStatus(e.message,true)));
$('#deleteSavedPlace')?.addEventListener('click',deleteSavedPlace);
$('#savedPlaces')?.addEventListener('change',()=>{
  const active = Boolean($('#savedPlaces').value);
  $('#useSavedPlace').disabled = !active;
  $('#deleteSavedPlace').disabled = !active;
});
$('#savePlaceType')?.addEventListener('change',()=>{
  const other = $('#savePlaceType').value === 'other';
  $('#savePlaceName').hidden = !other;
});
$('#buses').addEventListener('click', e => {
  const btn = e.target.closest('.direction-toggle');
  if (!btn) return;
  const stopId = btn.dataset.stopId;
  const stop = (state.data?.busStops || []).find(s => s.id === stopId);
  const directions = stop ? visibleDirections(stop) : [];
  if (!directions.length) return;
  const current = Number(state.stopDirections[stopId] ?? 0);
  state.stopDirections[stopId] = (current + 1) % directions.length;
  render();
});

(async function boot(){
  renderSavedPlaces();
  $('#savePlaceName').hidden = $('#savePlaceType')?.value !== 'other';
  const storedAddress = localStorage.getItem('homeAddress') || DEFAULT_ADDRESS;
  $('#address').value = storedAddress;
  try{
    const storedPoint = JSON.parse(localStorage.getItem('homePoint') || 'null');
    if(storedPoint?.lat && storedPoint?.lon && storedAddress === localStorage.getItem('homeAddress')){
      state.home = storedPoint;
      $('#geocodeState').textContent = `Adresse enregistrée : ${storedPoint.label}`;
      await loadMobility();
    } else await useAddress();
  }catch(e){ setStatus(e.message,true); }
  setInterval(()=>loadMobility().catch(()=>{}),30000);
})();

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstallPrompt = e;
  const btn = $('#installApp'); btn?.classList.remove('install-hidden'); btn?.classList.add('install-ready');
});
$('#installApp')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null;
  $('#installApp').classList.add('install-hidden'); $('#installApp').classList.remove('install-ready');
});
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; $('#installApp')?.classList.add('install-hidden'); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
