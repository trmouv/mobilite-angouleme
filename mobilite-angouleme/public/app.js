const $ = s => document.querySelector(s);
const state = { home: null, data: null, stopDirections: {} };
const DEFAULT_ADDRESS = '165 avenue Gambetta 16000 Angoulême';

function fmtDistance(m){ return m < 1000 ? `${m} m` : `${(m/1000).toFixed(1)} km`; }
function nowClock(){ return new Date(); }
function leaveClock(arrival, walkMin, bufferMin){
  const d = new Date();
  if (arrival.epoch) d.setTime(arrival.epoch * 1000);
  else d.setTime(Date.now() + arrival.minutes * 60000);
  d.setMinutes(d.getMinutes() - walkMin - bufferMin);
  return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}
function setStatus(t, error=false){ $('#status').textContent=t; $('#status').classList.toggle('error',error); }

async function geocode(address){
  const r = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
  const j = await r.json();
  if(!r.ok || !j.results?.length) throw new Error(j.error || 'Adresse introuvable');
  return j.results[0];
}

async function loadMobility(){
  if(!state.home) return;
  setStatus('Actualisation des bus et vélos…');
  const speed = $('#speed').value;
  const url = `/api/mobility?lat=${state.home.lat}&lon=${state.home.lon}&speedKmh=${speed}&maxWalkMin=10&bikeLimit=4`;
  const r = await fetch(url);
  const j = await r.json();
  if(!r.ok) throw new Error(j.error || 'Données indisponibles');
  state.data = j;
  render();
  const t = new Date(j.generatedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  setStatus(`Mis à jour à ${t} · ${state.home.label}`);
}

function render(){
  const buffer = Number($('#buffer').value);
  const bikes = state.data?.bikes || [];
  $('#bikes').innerHTML = bikes.length ? bikes.map((b,i)=>`
    <article class="card">
      <span class="rank">#${i+1} · ${b.walkMinutes} min à pied · ${fmtDistance(b.distanceMeters)}</span>
      <h3>${esc(b.name)}</h3>
      <div class="bike-numbers">
        <div class="metric"><b>${b.bikesAvailable}</b><span>vélo${b.bikesAvailable>1?'s':''} disponible${b.bikesAvailable>1?'s':''}</span></div>
        <div class="metric"><b>${b.docksAvailable}</b><span>place${b.docksAvailable>1?'s':''} libre${b.docksAvailable>1?'s':''}</span></div>
      </div>
    </article>`).join('') : '<div class="empty">Aucune station vélo trouvée dans le rayon de 10 minutes à pied.</div>';

  const buses = state.data?.busStops || [];
  $('#busCount').textContent = `${buses.length} arrêt${buses.length>1?'s':''} · ≤ 10 min`;
  $('#buses').innerHTML = buses.length ? buses.map((s,i)=>{
    const directions = s.directions?.length ? s.directions : [{ id: `${s.id}:default`, label: 'Direction', routeDirections: s.routeDirections || [] }];
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
        ${rows.length ? rows.map(r=>{
          const first = r.passages[0];
          const next = r.passages.slice(1,3);
          return `
          <div class="arrival route-row">
            <div class="route" ${r.color ? `style="background:#${safeColor(r.color)}"` : ''}>${esc(r.route)}</div>
            <div class="route-main">
              <div class="headsign">${esc(r.headsign)}</div>
              <div class="times-line">
                <strong>dans ${first.minutes} min</strong>
                ${next.length ? `<span>· puis ${next.map(p=>`${p.minutes} min`).join(' · ')}</span>` : ''}
              </div>
              <div class="sub ${r.realtime?'live':'scheduled'}">${r.realtime?'● temps réel':'horaire théorique'} · ${r.passages.map(p=>esc(p.time)).join(' · ')}</div>
            </div>
            <div class="leave"><span class="sub">Pars à</span><strong>${leaveClock(first,s.walkMinutes,buffer)}</strong></div>
          </div>`;
        }).join('') : '<div class="empty">Aucun passage dans les 3 prochaines heures pour cette direction.</div>'}
      </div>
    </article>`;
  }).join('') : '<div class="empty">Aucun arrêt de bus trouvé dans le rayon de 10 minutes à pied.</div>';
}

function esc(v=''){ return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function safeColor(v=''){ return /^[0-9A-Fa-f]{6}$/.test(v) ? v : '111827'; }

async function useAddress(){
  try{
    const address = $('#address').value.trim();
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
$('#buses').addEventListener('click', e => {
  const btn = e.target.closest('.direction-toggle');
  if (!btn) return;
  const stopId = btn.dataset.stopId;
  const stop = state.data?.busStops?.find(s => s.id === stopId);
  if (!stop?.directions?.length) return;
  const current = Number(state.stopDirections[stopId] ?? 0);
  state.stopDirections[stopId] = (current + 1) % stop.directions.length;
  render();
});

(async function boot(){
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

// Installation PWA (Chrome/Edge/Android). Sur iPhone/iPad : Partager > Sur l’écran d’accueil.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = $('#installApp');
  btn.classList.remove('install-hidden');
  btn.classList.add('install-ready');
});
$('#installApp')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('#installApp').classList.add('install-hidden');
  $('#installApp').classList.remove('install-ready');
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  $('#installApp')?.classList.add('install-hidden');
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
