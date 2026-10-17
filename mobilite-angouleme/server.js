import express from 'express';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const app = express();
const PORT = process.env.PORT || 3000;

const GTFS_STATIC_URL = 'https://www.data.gouv.fr/api/1/datasets/r/021fd4a3-ba9a-4d78-aa65-71d4d289f389';
const GTFS_RT_URL = 'https://proxy.transport.data.gouv.fr/resource/mobius-angouleme';
const BIKE_INFO_URL = 'https://gbfs.partners.fifteen.eu/gbfs/2.2/angouleme/en/station_information.json';
const BIKE_STATUS_URL = 'https://gbfs.partners.fifteen.eu/gbfs/2.2/angouleme/en/station_status.json';
const GEOCODE_URL = 'https://data.geopf.fr/geocodage/search/';

let gtfsCache = null;
let gtfsLoadedAt = 0;
const STATIC_TTL = 12 * 60 * 60 * 1000;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function walkMinutes(distanceMeters, speedKmh = 4.8) {
  return (distanceMeters / 1000) / speedKmh * 60;
}

function parisParts(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const o = Object.fromEntries(p.map(x => [x.type, x.value]));
  return {
    ymd: `${o.year}${o.month}${o.day}`,
    weekday: o.weekday.toLowerCase().slice(0, 3),
    seconds: Number(o.hour) * 3600 + Number(o.minute) * 60 + Number(o.second)
  };
}

function gtfsTimeToSeconds(s) {
  if (!s) return null;
  const [h, m, sec] = s.split(':').map(Number);
  return h * 3600 + m * 60 + sec;
}

function formatGtfsClock(s) {
  const sec = gtfsTimeToSeconds(s);
  if (sec == null) return '';
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function fetchOk(url, options = {}) {
  const r = await fetch(url, { ...options, headers: { 'User-Agent': 'MobiliteAngouleme/1.0', ...(options.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} pour ${url}`);
  return r;
}

function zipCsv(zip, name) {
  const entry = zip.getEntry(name);
  if (!entry) return [];
  return parse(entry.getData().toString('utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
}

async function loadGtfs() {
  if (gtfsCache && Date.now() - gtfsLoadedAt < STATIC_TTL) return gtfsCache;
  const r = await fetchOk(GTFS_STATIC_URL, { redirect: 'follow' });
  const zip = new AdmZip(Buffer.from(await r.arrayBuffer()));
  const stops = zipCsv(zip, 'stops.txt');
  const routes = zipCsv(zip, 'routes.txt');
  const trips = zipCsv(zip, 'trips.txt');
  const stopTimes = zipCsv(zip, 'stop_times.txt');
  const calendar = zipCsv(zip, 'calendar.txt');
  const calendarDates = zipCsv(zip, 'calendar_dates.txt');

  const routeById = new Map(routes.map(r => [r.route_id, r]));
  const tripById = new Map(trips.map(t => [t.trip_id, t]));
  const stopTimesByStop = new Map();
  for (const st of stopTimes) {
    if (!stopTimesByStop.has(st.stop_id)) stopTimesByStop.set(st.stop_id, []);
    stopTimesByStop.get(st.stop_id).push(st);
  }
  for (const arr of stopTimesByStop.values()) arr.sort((a, b) => gtfsTimeToSeconds(a.departure_time) - gtfsTimeToSeconds(b.departure_time));

  const calendarByService = new Map(calendar.map(c => [c.service_id, c]));
  const exceptions = new Map();
  for (const x of calendarDates) exceptions.set(`${x.date}:${x.service_id}`, x.exception_type);

  gtfsCache = { stops, routeById, tripById, stopTimesByStop, calendarByService, exceptions };
  gtfsLoadedAt = Date.now();
  return gtfsCache;
}

function activeServices(gtfs, now = new Date()) {
  const { ymd, weekday } = parisParts(now);
  const weekdayMap = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };
  const active = new Set();
  const serviceIds = new Set([...gtfs.calendarByService.keys()]);
  for (const k of gtfs.exceptions.keys()) serviceIds.add(k.split(':')[1]);

  for (const id of serviceIds) {
    const cal = gtfs.calendarByService.get(id);
    let on = !!(cal && ymd >= cal.start_date && ymd <= cal.end_date && cal[weekdayMap[weekday]] === '1');
    const ex = gtfs.exceptions.get(`${ymd}:${id}`);
    if (ex === '1') on = true;
    if (ex === '2') on = false;
    if (on) active.add(id);
  }
  return active;
}

function routeMeta(gtfs, tripId) {
  const t = gtfs.tripById.get(tripId);
  if (!t) return { route: '?', headsign: '', color: '' };
  const r = gtfs.routeById.get(t.route_id) || {};
  return {
    route: r.route_short_name || r.route_long_name || t.route_id,
    headsign: t.trip_headsign || '',
    color: r.route_color || ''
  };
}

async function realtimeByStop(gtfs, wantedStops) {
  const out = new Map([...wantedStops].map(id => [id, []]));
  try {
    const r = await fetchOk(GTFS_RT_URL);
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await r.arrayBuffer()));
    const now = Math.floor(Date.now() / 1000);
    for (const entity of feed.entity || []) {
      const tu = entity.tripUpdate;
      if (!tu?.trip) continue;
      const meta = routeMeta(gtfs, tu.trip.tripId);
      for (const stu of tu.stopTimeUpdate || []) {
        if (!wantedStops.has(stu.stopId)) continue;
        const epoch = Number(stu.departure?.time || stu.arrival?.time || 0);
        if (!epoch || epoch < now - 90 || epoch > now + 3 * 3600) continue;
        out.get(stu.stopId).push({
          ...meta,
          tripId: tu.trip.tripId,
          epoch,
          time: new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(epoch * 1000)),
          minutes: Math.max(0, Math.round((epoch - now) / 60)),
          realtime: true
        });
      }
    }
    for (const v of out.values()) v.sort((a, b) => a.epoch - b.epoch);
  } catch (e) {
    console.warn('GTFS-RT indisponible:', e.message);
  }
  return out;
}

function scheduledForStop(gtfs, stopId, max = 5) {
  const { seconds } = parisParts();
  const active = activeServices(gtfs);
  const list = [];
  for (const st of gtfs.stopTimesByStop.get(stopId) || []) {
    const depSec = gtfsTimeToSeconds(st.departure_time || st.arrival_time);
    if (depSec == null || depSec < seconds - 60 || depSec > seconds + 3 * 3600) continue;
    const trip = gtfs.tripById.get(st.trip_id);
    if (!trip || !active.has(trip.service_id)) continue;
    const meta = routeMeta(gtfs, st.trip_id);
    list.push({ ...meta, tripId: st.trip_id, time: formatGtfsClock(st.departure_time || st.arrival_time), minutes: Math.max(0, Math.round((depSec - seconds) / 60)), realtime: false });
  }
  list.sort((a, b) => a.minutes - b.minutes);
  return list.slice(0, max);
}

async function getBikes(lat, lon, speedKmh, maxWalkMin, limit) {
  const [infoR, statusR] = await Promise.all([fetchOk(BIKE_INFO_URL), fetchOk(BIKE_STATUS_URL)]);
  const [info, status] = await Promise.all([infoR.json(), statusR.json()]);
  const statusById = new Map((status.data?.stations || []).map(s => [s.station_id, s]));
  return (info.data?.stations || [])
    .map(s => {
      const distance = haversineMeters(lat, lon, Number(s.lat), Number(s.lon));
      const walkMin = walkMinutes(distance, speedKmh);
      const st = statusById.get(s.station_id) || {};
      return {
        id: s.station_id, name: s.name, lat: Number(s.lat), lon: Number(s.lon),
        distanceMeters: Math.round(distance), walkMinutes: Math.ceil(walkMin),
        bikesAvailable: Number(st.num_bikes_available ?? 0), docksAvailable: Number(st.num_docks_available ?? 0),
        isInstalled: st.is_installed !== 0, isRenting: st.is_renting !== 0, isReturning: st.is_returning !== 0
      };
    })
    .filter(x => x.walkMinutes <= maxWalkMin)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

app.use(express.static('public'));

app.get('/api/geocode', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Adresse manquante' });
    const url = new URL(GEOCODE_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '5');
    const r = await fetchOk(url);
    const data = await r.json();
    const results = (data.features || []).map(f => ({
      label: f.properties?.label || q,
      score: f.properties?.score,
      lon: f.geometry?.coordinates?.[0],
      lat: f.geometry?.coordinates?.[1]
    }));
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: `Géocodage indisponible : ${e.message}` });
  }
});

app.get('/api/mobility', async (req, res) => {
  try {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    const speedKmh = Math.min(8, Math.max(2.5, Number(req.query.speedKmh || 4.8)));
    const maxWalkMin = Math.min(30, Math.max(1, Number(req.query.maxWalkMin || 10)));
    const bikeLimit = Math.min(10, Math.max(1, Number(req.query.bikeLimit || 4)));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'Coordonnées invalides' });

    const gtfs = await loadGtfs();
    // Regroupe les deux quais/sens d'un même arrêt physique sous une seule carte.
    // Le nom GTFS est la clé principale ; on conserve tous les stop_id membres pour agréger les passages.
    const nearbyPlatforms = gtfs.stops
      .filter(s => !s.location_type || s.location_type === '0')
      .map(s => {
        const distance = haversineMeters(lat, lon, Number(s.stop_lat), Number(s.stop_lon));
        return {
          id: s.stop_id, name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon),
          distanceMeters: Math.round(distance), walkMinutes: Math.ceil(walkMinutes(distance, speedKmh))
        };
      })
      .filter(s => s.walkMinutes <= maxWalkMin)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    const normalizeStopName = name => String(name || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    const grouped = new Map();
    for (const platform of nearbyPlatforms) {
      const key = normalizeStopName(platform.name);
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: `group:${key}`,
          name: platform.name,
          lat: platform.lat,
          lon: platform.lon,
          distanceMeters: platform.distanceMeters,
          walkMinutes: platform.walkMinutes,
          stopIds: [],
          platforms: []
        });
      }
      const g = grouped.get(key);
      g.stopIds.push(platform.id);
      g.platforms.push({ id: platform.id, lat: platform.lat, lon: platform.lon });
      if (platform.distanceMeters < g.distanceMeters) {
        g.distanceMeters = platform.distanceMeters;
        g.walkMinutes = platform.walkMinutes;
        g.lat = platform.lat;
        g.lon = platform.lon;
      }
    }
    const busStops = [...grouped.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);

    const allStopIds = new Set(busStops.flatMap(s => s.stopIds));
    const rt = await realtimeByStop(gtfs, allStopIds);

    for (const stop of busStops) {
      const live = stop.stopIds.flatMap(id => (rt.get(id) || []).map(a => ({ ...a, stopId: id })));
      let arrivals = live;
      if (!live.length) arrivals = stop.stopIds.flatMap(id => scheduledForStop(gtfs, id, 12).map(a => ({ ...a, stopId: id })));

      // Déduplique puis classe les passages. Les directions restent distinctes dans la même carte.
      const seen = new Set();
      arrivals = arrivals
        .sort((a, b) => (a.epoch || a.minutes) - (b.epoch || b.minutes))
        .filter(a => {
          const k = `${a.tripId}|${a.epoch || a.time}|${a.route}|${a.headsign}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

      const byRouteDirection = new Map();
      for (const a of arrivals) {
        const key = `${a.route}||${a.headsign || ''}`;
        if (!byRouteDirection.has(key)) byRouteDirection.set(key, {
          route: a.route,
          headsign: a.headsign || 'Direction non indiquée',
          color: a.color || '',
          realtime: false,
          passages: []
        });
        const row = byRouteDirection.get(key);
        if (row.passages.length < 3) {
          row.passages.push({ time: a.time, minutes: a.minutes, epoch: a.epoch, realtime: a.realtime });
          row.realtime = row.realtime || a.realtime;
        }
      }
      stop.routeDirections = [...byRouteDirection.values()]
        .filter(r => r.passages.length)
        .sort((a, b) => a.passages[0].minutes - b.passages[0].minutes);

      // Une direction correspond à un quai/sens GTFS. On renvoie ces groupes séparément
      // pour permettre à l'interface d'en afficher un seul à la fois.
      stop.directions = stop.platforms.map((platform, index) => {
        const platformArrivals = arrivals.filter(a => a.stopId === platform.id);
        const groups = new Map();
        for (const a of platformArrivals) {
          const key = `${a.route}||${a.headsign || ''}`;
          if (!groups.has(key)) groups.set(key, {
            route: a.route,
            headsign: a.headsign || 'Direction non indiquée',
            color: a.color || '',
            realtime: false,
            passages: []
          });
          const row = groups.get(key);
          if (row.passages.length < 3) {
            row.passages.push({ time: a.time, minutes: a.minutes, epoch: a.epoch, realtime: a.realtime });
            row.realtime = row.realtime || a.realtime;
          }
        }
        const routeDirections = [...groups.values()]
          .filter(r => r.passages.length)
          .sort((a, b) => a.passages[0].minutes - b.passages[0].minutes);
        const labels = [...new Set(routeDirections.map(r => r.headsign).filter(Boolean))];
        return {
          id: platform.id,
          label: labels.length ? labels.slice(0, 2).join(' / ') : `Direction ${index + 1}`,
          routeDirections
        };
      }).filter(d => d.routeDirections.length);

      // Certains réseaux peuvent exposer plusieurs stop_id pour le même sens.
      // Si aucune direction exploitable n'est trouvée, on garde le format historique.
      if (!stop.directions.length && stop.routeDirections.length) {
        stop.directions = [{ id: `${stop.id}:default`, label: 'Direction', routeDirections: stop.routeDirections }];
      }
      delete stop.stopIds;
      delete stop.platforms;
    }

    let bikes = [];
    try { bikes = await getBikes(lat, lon, speedKmh, maxWalkMin, bikeLimit); }
    catch (e) { console.warn('GBFS indisponible:', e.message); }

    res.json({
      generatedAt: new Date().toISOString(), speedKmh, maxWalkMin,
      busRealtimeSource: GTFS_RT_URL, bikes, busStops
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: `Données mobilité indisponibles : ${e.message}` });
  }
});

app.listen(PORT, () => console.log(`Mobilité Angoulême : http://localhost:${PORT}`));
