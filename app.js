(() => {
  'use strict';

  const APP_VERSION = 'v1';
  const RADIUS = 500; // mètres
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];

  const $status = document.getElementById('status');
  const $panel = document.getElementById('panel');
  const $list = document.getElementById('list');
  const $btn = document.getElementById('btn-locate');
  document.getElementById('version').textContent = APP_VERSION;

  // ---------- Carte ----------
  const map = L.map('map', { zoomControl: true }).setView([46.6, 2.4], 6);

  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  const ignPlan = L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png' +
    '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { maxZoom: 19, attribution: '© <a href="https://geoservices.ign.fr">IGN</a> Plan IGN v2' }
  );
  L.control.layers({ 'OpenStreetMap': osm, 'IGN Plan V2': ignPlan }).addTo(map);
  osm.addTo(map);
  let currentBase = osm;

  function setBase(layer) {
    if (layer === currentBase) return;
    map.removeLayer(currentBase);
    layer.addTo(map);
    currentBase = layer;
  }
  map.on('baselayerchange', (e) => { currentBase = e.layer; });

  // Emprise approximative de la France (métropole + DROM)
  function isInFrance(lat, lon) {
    const boxes = [
      [41.2, 51.3, -5.5, 9.7],      // métropole + Corse
      [15.8, 16.6, -61.9, -60.9],   // Guadeloupe
      [14.3, 14.95, -61.3, -60.7],  // Martinique
      [2.0, 5.9, -54.7, -51.5],     // Guyane
      [-21.5, -20.8, 55.1, 55.9],   // La Réunion
      [-13.1, -12.6, 44.9, 45.4]    // Mayotte
    ];
    return boxes.some(([s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
  }

  // ---------- Couches dynamiques ----------
  let meMarker = null, circle = null;
  const dabLayer = L.layerGroup().addTo(map);

  // ---------- Utilitaires ----------
  function setStatus(msg, cls) {
    $status.textContent = msg;
    $status.className = cls || '';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function bankName(tags) {
    return tags.operator || tags.brand || tags.name || tags['name:fr'] || null;
  }
  function address(tags) {
    const num = tags['addr:housenumber'] || '';
    const street = tags['addr:street'] || '';
    const city = tags['addr:city'] || '';
    return [[num, street].filter(Boolean).join(' '), city].filter(Boolean).join(', ');
  }

  // ---------- Overpass ----------
  async function fetchAtms(lat, lon) {
    const q = `[out:json][timeout:25];
(
  nwr["amenity"="atm"](around:${RADIUS},${lat},${lon});
  nwr["amenity"="bank"]["atm"="yes"](around:${RADIUS},${lat},${lon});
);
out center tags;`;
    let lastErr;
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const json = await resp.json();
        return json.elements || [];
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Overpass indisponible');
  }

  function buildResults(elements, lat, lon) {
    const items = [];
    for (const el of elements) {
      const elat = el.lat ?? el.center?.lat;
      const elon = el.lon ?? el.center?.lon;
      if (elat == null || elon == null) continue;
      const dist = haversine(lat, lon, elat, elon);
      if (dist > RADIUS) continue;
      const tags = el.tags || {};
      items.push({ lat: elat, lon: elon, dist, bank: bankName(tags), addr: address(tags) });
    }
    items.sort((a, b) => a.dist - b.dist);
    // Fusion des doublons (distributeur + agence taguée atm=yes au même endroit, même banque)
    const out = [];
    for (const it of items) {
      const dup = out.find((o) =>
        haversine(o.lat, o.lon, it.lat, it.lon) < 25 &&
        (!o.bank || !it.bank || o.bank.toLowerCase() === it.bank.toLowerCase()));
      if (dup) {
        if (!dup.bank && it.bank) dup.bank = it.bank;
        if (!dup.addr && it.addr) dup.addr = it.addr;
      } else out.push(it);
    }
    return out;
  }

  // ---------- Affichage ----------
  function showResults(results) {
    dabLayer.clearLayers();
    $list.innerHTML = '';
    if (!results.length) {
      $panel.hidden = true;
      setStatus('Pas de distributeur dans un rayon de 500 m.', 'none');
      return;
    }
    setStatus(
      results.length === 1
        ? '1 distributeur trouvé dans un rayon de 500 m.'
        : results.length + ' distributeurs trouvés dans un rayon de 500 m.', 'ok');

    results.forEach((r, i) => {
      const n = i + 1;
      const bank = r.bank || 'Banque non renseignée';
      const icon = L.divIcon({
        className: 'dab-icon',
        html: `<div class="num">${n}</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14]
      });
      const marker = L.marker([r.lat, r.lon], { icon }).addTo(dabLayer);
      marker.bindPopup(
        `<strong>${n}. ${esc(bank)}</strong><br>` +
        `<small>à ${Math.round(r.dist)} m</small>` +
        (r.addr ? `<br><small>${esc(r.addr)}</small>` : ''));

      const li = document.createElement('li');
      li.innerHTML = `<span class="num">${n}</span><span class="info"><strong>${esc(bank)}</strong>` +
        `<small>à ${Math.round(r.dist)} m${r.addr ? ' · ' + esc(r.addr) : ''}</small></span>`;
      li.addEventListener('click', () => {
        map.setView([r.lat, r.lon], Math.max(map.getZoom(), 17));
        marker.openPopup();
      });
      $list.appendChild(li);
    });
    $panel.hidden = false;
    map.invalidateSize();
  }

  // ---------- Flux principal ----------
  async function onPosition(pos) {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;

    // Choix du fond : IGN Plan V2 en France, sinon OSM
    setBase(isInFrance(lat, lon) ? ignPlan : osm);

    if (meMarker) map.removeLayer(meMarker);
    if (circle) map.removeLayer(circle);
    meMarker = L.marker([lat, lon], {
      icon: L.divIcon({ className: 'me-icon', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 1000
    }).addTo(map).bindPopup(`Vous êtes ici<br><small>précision ± ${Math.round(accuracy)} m</small>`);
    circle = L.circle([lat, lon], {
      radius: RADIUS, color: '#1a73e8', weight: 1.5, fillOpacity: 0.05, interactive: false
    }).addTo(map);
    map.fitBounds(circle.getBounds(), { padding: [10, 10] });

    setStatus('Recherche des distributeurs…');
    try {
      const elements = await fetchAtms(lat, lon);
      showResults(buildResults(elements, lat, lon));
    } catch (e) {
      $panel.hidden = true;
      dabLayer.clearLayers();
      setStatus('Recherche impossible (service OpenStreetMap indisponible ou hors-ligne). Réessayez.', 'err');
    } finally {
      $btn.disabled = false;
    }
  }

  function onGeoError(err) {
    $btn.disabled = false;
    const msgs = {
      1: 'Localisation refusée : autorisez l’accès à la position dans votre navigateur.',
      2: 'Position indisponible. Vérifiez le GPS/réseau.',
      3: 'Délai dépassé pour obtenir la position.'
    };
    setStatus(msgs[err.code] || 'Erreur de localisation.', 'err');
  }

  function locate() {
    if (!navigator.geolocation) {
      setStatus('La géolocalisation n’est pas disponible sur cet appareil.', 'err');
      return;
    }
    $btn.disabled = true;
    setStatus('Localisation en cours…');
    navigator.geolocation.getCurrentPosition(onPosition, onGeoError, {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 10000
    });
  }

  $btn.addEventListener('click', locate);
  locate();

  // ---------- Service worker (brise-cache) ----------
  if ('serviceWorker' in navigator) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      // Nouvelle version activée : on recharge pour afficher les fichiers à jour
      if (document.visibilityState === 'visible' && sessionStorage.getItem('dab-sw-seen')) location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        sessionStorage.setItem('dab-sw-seen', '1');
        reg.update();
      }).catch(() => {});
    });
  }
})();
