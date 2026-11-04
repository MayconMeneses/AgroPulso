import { formatCoordinate, getFarmLocation, parseCoordinate, setFarmLocation } from './app/domain/location.js';
import { parseForecast, weatherUrl } from './app/domain/online.js';
import { listPlots } from './app/domain/plots.js';
import { chip, form, h, icon, openSheet, say, tag } from './ui.js';
import { buildMap, desenharTalhao } from './views-talhao.js';

let selected = '';
const asked = new Set(); // propriedades para as quais já pedimos a localização nesta sessão (não pedir de novo a cada tela)
const forecasts = new Map(); // farmId -> { at, days }: evita buscar a previsão a cada vez que a tela é desenhada
const FRESH_MS = 30 * 60 * 1000;
const AVISO = 'Ao permitir a localização, o tempo e o mapa aparecem sozinhos sempre que você abre esta tela com internet. Para isso, o local aproximado da propriedade é enviado a Open-Meteo (tempo) e OpenStreetMap (mapa). Sem internet, o app segue normal. Para parar, remova o local.';
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const dayName = (iso) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

// Lê a localização do aparelho. O navegador pede a permissão da pessoa; sem ela, nada é guardado nem enviado.
function readPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('indisponivel')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latMicro: Math.round(p.coords.latitude * 1e6), lonMicro: Math.round(p.coords.longitude * 1e6) }),
      (e) => reject(e),
      { timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

async function denied() {
  try { return (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'denied'; } catch { return false; }
}

function mapView(loc, name, outlines) {
  const { el } = buildMap(loc, 15, name, outlines);
  return h('div', {}, el, h('p', { class: 'muted small' }, '© ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }, 'Colaboradores do OpenStreetMap'), '. O ponto é o local da propriedade.'));
}

function forecastView(days) {
  return h('div', {}, h('ul', { class: 'timeline' }, days.map((d) => h('li', {}, h('strong', {}, dayName(d.date)), ` · ${nf.format(d.minC)}° a ${nf.format(d.maxC)}° · chuva ${nf.format(d.rainMm)} mm`, d.rainChance === null ? '' : ` (${d.rainChance}%)`))),
    h('p', { class: 'muted small' }, 'Previsão de Open-Meteo.com. É uma estimativa, não uma garantia.', tag('externo')));
}

// Local, tempo e mapa. Com o local salvo e internet, a previsão e o mapa aparecem sozinhos. Sem local, o app pede a
// localização do aparelho (uma vez por sessão e por propriedade) e, se a pessoa permitir, guarda e mostra tudo.
export async function localBlock(db, farms, rerender) {
  if (farms.length === 0) return h('section', { class: 'panel' }, h('div', { class: 'cad-head' }, icon('propriedade'), h('h2', {}, 'Local, tempo e mapa')), h('p', { class: 'muted small' }, 'Cadastre uma propriedade primeiro.'));
  if (!farms.some((f) => f.id === selected)) selected = farms[0].id;
  const farm = farms.find((f) => f.id === selected);
  const loc = await getFarmLocation(db, farm.id);
  const plots = await listPlots(db, farm.id);
  const body = h('div', { class: 'local-body' });
  const info = h('p', { class: 'muted small' });

  const definir = () => openSheet('Local da propriedade', (close) => {
    const f = form([
      { name: 'lat', label: 'Latitude', hint: 'ex.: -8,047562', inputmode: 'decimal' },
      { name: 'lon', label: 'Longitude', hint: 'ex.: -34,877000', inputmode: 'decimal' },
    ], 'Salvar local', async (v) => {
      await setFarmLocation(db, farm.id, { latMicro: parseCoordinate(v.lat, 'lat'), lonMicro: parseCoordinate(v.lon, 'lon') });
      forecasts.delete(farm.id); close(); say('Local salvo neste aparelho.'); await rerender();
    });
    const gps = h('button', { class: 'btn', type: 'button', onclick: async () => {
      try {
        const p = await readPosition();
        f.elements.lat.value = formatCoordinate(p.latMicro);
        f.elements.lon.value = formatCoordinate(p.lonMicro);
      } catch { say('Não foi possível ler a localização. Digite as coordenadas.', 'err'); }
    } }, 'Usar a localização deste aparelho');
    const box = h('div', {}, h('p', { class: 'muted small' }, 'O local fica só neste aparelho. Dá para usar a localização do aparelho (o navegador pede sua permissão) ou digitar.'), gps, f);
    if (loc) {
      f.elements.lat.value = formatCoordinate(loc.latMicro);
      f.elements.lon.value = formatCoordinate(loc.lonMicro);
      box.append(h('button', { class: 'btn danger', type: 'button', onclick: async () => { await setFarmLocation(db, farm.id, null); forecasts.delete(farm.id); asked.add(farm.id); close(); say('Local removido. O tempo e o mapa param de aparecer.'); await rerender(); } }, 'Remover o local'));
    }
    return box;
  });

  async function showForecast() {
    const hit = forecasts.get(farm.id);
    if (hit && Date.now() - hit.at < FRESH_MS) { body.append(forecastView(hit.days)); return; }
    const wait = h('p', { class: 'muted small' }, 'Buscando a previsão…');
    body.append(wait);
    try {
      const r = await fetch(weatherUrl(loc, farm.timezone), { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(String(r.status));
      const days = parseForecast(await r.json());
      forecasts.set(farm.id, { at: Date.now(), days });
      wait.replaceWith(forecastView(days));
    } catch {
      wait.replaceWith(h('p', { class: 'callout' }, 'Não foi possível buscar a previsão agora. Seu caderno não foi alterado. Abra esta tela de novo mais tarde.'));
    }
  }

  async function autoLocate() {
    if (asked.has(farm.id) || !navigator.geolocation || (await denied())) { info.textContent = 'Local não informado. Toque em "Informar o local" para ver o tempo e o mapa.'; return; }
    asked.add(farm.id);
    info.textContent = 'Pedindo a localização do aparelho…';
    try {
      await setFarmLocation(db, farm.id, await readPosition());
      await rerender();
    } catch {
      info.textContent = 'A localização não foi permitida. Toque em "Informar o local" para digitar ou tentar de novo.';
    }
  }

  if (loc) {
    info.textContent = `Local: ${formatCoordinate(loc.latMicro)}, ${formatCoordinate(loc.lonMicro)}`;
    if (navigator.onLine) { body.append(mapView(loc, farm.name, plots.filter((p) => p.outline).map((p) => p.outline))); showForecast(); } // sem await: a tela não espera a internet
    else body.append(h('p', { class: 'callout' }, 'Sem internet agora: o tempo e o mapa voltam quando conectar.'));
  } else if (navigator.onLine) autoLocate();
  else info.textContent = 'Local não informado. Quando houver internet, o app pede a localização do aparelho.';

  return h('section', { class: 'panel' },
    h('div', { class: 'cad-head' }, icon('propriedade'), h('h2', {}, `Tempo e mapa · ${farm.name}`)),
    farms.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Propriedade' }, farms.map((f) => chip(f.name, f.id === selected, () => { selected = f.id; rerender(); }))) : '',
    info, body,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: definir }, loc ? 'Mudar o local' : 'Informar o local'),
      loc && navigator.onLine ? plots.map((p) => h('button', { class: 'btn', type: 'button', onclick: () => desenharTalhao(db, loc, farm.name, p, rerender) }, `Contorno: ${p.name}`)) : ''),
    h('p', { class: 'muted small' }, AVISO));
}
