import { formatCoordinate, getFarmLocation, parseCoordinate, setFarmLocation } from './app/domain/location.js';
import { mapTiles, parseForecast, weatherUrl } from './app/domain/online.js';
import { chip, form, h, icon, openSheet, say } from './ui.js';

let selected = '';
const AVISO = 'Usa a internet. Para isso, o local aproximado da propriedade é enviado ao serviço (Open-Meteo para o tempo, OpenStreetMap para o mapa). Só acontece quando você toca no botão.';
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const dayName = (iso) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

// Recursos que dependem de internet. O app continua inteiro sem eles: sem conexão, só estes botões avisam que não dá.
export async function localBlock(db, farms, rerender) {
  if (farms.length === 0) return h('section', { class: 'panel' }, h('div', { class: 'cad-head' }, icon('propriedade'), h('h2', {}, 'Local, tempo e mapa')), h('p', { class: 'muted small' }, 'Cadastre uma propriedade primeiro.'));
  if (!farms.some((f) => f.id === selected)) selected = farms[0].id;
  const farm = farms.find((f) => f.id === selected);
  const loc = await getFarmLocation(db, farm.id);
  const needNet = () => { if (!navigator.onLine) { say('Sem internet agora. Tente de novo quando conectar.', 'err'); return true; } return false; };

  const definir = () => openSheet('Local da propriedade', (close) => {
    const f = form([
      { name: 'lat', label: 'Latitude', hint: 'ex.: -8,047562', inputmode: 'decimal' },
      { name: 'lon', label: 'Longitude', hint: 'ex.: -34,877000', inputmode: 'decimal' },
    ], 'Salvar local', async (v) => {
      await setFarmLocation(db, farm.id, { latMicro: parseCoordinate(v.lat, 'lat'), lonMicro: parseCoordinate(v.lon, 'lon') });
      close(); say('Local salvo neste aparelho.'); await rerender();
    });
    const gps = h('button', { class: 'btn', type: 'button', onclick: () => {
      if (!navigator.geolocation) { say('Este aparelho não informa a localização. Digite as coordenadas.', 'err'); return; }
      navigator.geolocation.getCurrentPosition((p) => {
        f.elements.lat.value = formatCoordinate(Math.round(p.coords.latitude * 1e6));
        f.elements.lon.value = formatCoordinate(Math.round(p.coords.longitude * 1e6));
      }, () => say('Não foi possível ler a localização. Digite as coordenadas.', 'err'), { timeout: 15000 });
    } }, 'Usar a localização deste aparelho');
    const box = h('div', {}, h('p', { class: 'muted small' }, 'O local fica só neste aparelho. Dá para usar a localização do aparelho (o navegador pede sua permissão) ou digitar.'), gps, f);
    if (loc) {
      f.elements.lat.value = formatCoordinate(loc.latMicro);
      f.elements.lon.value = formatCoordinate(loc.lonMicro);
      box.append(h('button', { class: 'btn danger', type: 'button', onclick: async () => { await setFarmLocation(db, farm.id, null); close(); say('Local removido.'); await rerender(); } }, 'Remover o local'));
    }
    return box;
  });

  const previsao = () => openSheet(`Tempo: ${farm.name}`, () => {
    const box = h('div', {}, h('p', { class: 'muted small' }, 'Buscando a previsão…'));
    if (needNet()) { box.replaceChildren(h('p', { class: 'callout' }, 'Sem internet agora. Tente de novo quando conectar.')); return box; }
    fetch(weatherUrl(loc, farm.timezone), { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((json) => {
        const days = parseForecast(json);
        box.replaceChildren(
          h('ul', { class: 'timeline' }, days.map((d) => h('li', {}, h('strong', {}, dayName(d.date)), ` · ${nf.format(d.minC)}° a ${nf.format(d.maxC)}° · chuva ${nf.format(d.rainMm)} mm`, d.rainChance === null ? '' : ` (${d.rainChance}%)`))),
          h('p', { class: 'muted small' }, 'Previsão de Open-Meteo.com. É uma estimativa, não uma garantia.'));
      })
      .catch(() => box.replaceChildren(h('p', { class: 'callout' }, 'Não foi possível buscar a previsão agora. Nada foi alterado no seu caderno. Tente de novo mais tarde.')));
    return box;
  });

  const mapa = () => openSheet(`Mapa: ${farm.name}`, () => {
    if (needNet()) return h('p', { class: 'callout' }, 'Sem internet agora. Tente de novo quando conectar.');
    const m = mapTiles(loc, 15);
    const grid = h('div', { class: 'map', role: 'img', 'aria-label': `Mapa em volta de ${farm.name}` }, m.tiles.map((t) => h('img', { src: t.url, alt: '', width: 256, height: 256, draggable: 'false' }))); // sem "no-referrer": a política de uso do OpenStreetMap pede que o pedido diga de qual site vem (só o endereço do site, nunca dados seus)
    const pin = h('span', { class: 'map-pin' });
    pin.style.setProperty('--x', `${m.markerX}%`); // pela API de estilo (CSSOM): a política de segurança só barra o atributo "style"
    pin.style.setProperty('--y', `${m.markerY}%`);
    grid.append(pin);
    return h('div', {}, grid, h('p', { class: 'muted small' }, '© ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }, 'Colaboradores do OpenStreetMap'), '. O ponto mostra o local que você informou.'));
  });

  return h('section', { class: 'panel' },
    h('div', { class: 'cad-head' }, icon('propriedade'), h('h2', {}, 'Local, tempo e mapa')),
    farms.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Propriedade' }, farms.map((f) => chip(f.name, f.id === selected, () => { selected = f.id; rerender(); }))) : '',
    h('p', { class: loc ? '' : 'muted' }, loc ? `Local: ${formatCoordinate(loc.latMicro)}, ${formatCoordinate(loc.lonMicro)}` : 'Local ainda não informado.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: definir }, loc ? 'Mudar o local' : 'Informar o local'),
      loc ? h('button', { class: 'btn', type: 'button', onclick: previsao }, 'Ver o tempo') : '',
      loc ? h('button', { class: 'btn', type: 'button', onclick: mapa }, 'Ver o mapa') : ''),
    h('p', { class: 'muted small' }, AVISO));
}
