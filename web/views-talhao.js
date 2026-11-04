import { areaHectares, fromPct, gridFor, toPct } from './app/domain/geo.js';
import { setPlotOutline } from './app/domain/plots.js';
import { mapTiles } from './app/domain/online.js';
import { fail, h, openSheet, say, svg, tag } from './ui.js';

const ha = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

// Mapa em 3 x 3 quadros com o ponto da propriedade e, por cima, os contornos dos talhões (em % da grade).
// Os quadros vêm do OpenStreetMap: só chamar com internet e depois de a pessoa ter permitido o uso do local.
export function buildMap(loc, zoom, name, outlines = []) {
  const m = mapTiles(loc, zoom);
  const grid = gridFor(loc, zoom);
  const el = h('div', { class: 'map', role: 'img', 'aria-label': `Mapa em volta de ${name}` }, m.tiles.map((t) => h('img', { src: t.url, alt: '', width: 256, height: 256, draggable: 'false' })));
  const over = svg('svg', { class: 'map-over', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const pin = h('span', { class: 'map-pin' });
  pin.style.setProperty('--x', `${m.markerX}%`); // pela API de estilo (CSSOM): a política de segurança só barra o atributo "style"
  pin.style.setProperty('--y', `${m.markerY}%`);
  el.append(over, pin);
  const paint = (list, draft = []) => {
    over.replaceChildren();
    for (const pts of list) {
      if (pts.length >= 3) over.append(svg('polygon', { points: pts.map((p) => { const q = toPct(grid, p); return `${q.x.toFixed(2)},${q.y.toFixed(2)}`; }).join(' ') }));
    }
    if (draft.length >= 3) over.append(svg('polygon', { points: draft.map((p) => { const q = toPct(grid, p); return `${q.x.toFixed(2)},${q.y.toFixed(2)}`; }).join(' ') }));
    for (const p of draft) { const q = toPct(grid, p); over.append(svg('circle', { cx: q.x.toFixed(2), cy: q.y.toFixed(2), r: 1.1 })); }
  };
  paint(outlines);
  return { el, grid, paint };
}

// Desenhar o contorno de um talhão tocando nos cantos, em ordem. A área do desenho é só uma estimativa mostrada na tela;
// a área declarada e a medida do talhão não mudam (RN-AG-015).
export function desenharTalhao(db, loc, farmName, plot, rerender) {
  openSheet(`Contorno: ${plot.name}`, (close) => {
    const pts = [];
    const { el, grid, paint } = buildMap(loc, 17, farmName, []);
    el.classList.add('draw');
    const info = h('p', { class: 'muted small' });
    const refresh = () => {
      paint([], pts);
      info.replaceChildren(pts.length < 3 ? `Toque nos cantos do talhão, em ordem. Pontos: ${pts.length} (mínimo 3).` : `Pontos: ${pts.length}. Área do desenho: ${ha.format(areaHectares(pts))} ha `, pts.length >= 3 ? tag('estimado') : '');
    };
    el.addEventListener('click', (e) => {
      const r = el.getBoundingClientRect();
      if (pts.length >= 60) { say('O contorno aceita até 60 pontos.', 'err'); return; }
      pts.push(fromPct(grid, ((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100));
      refresh();
    });
    refresh();
    const btn = (label, cls, run) => h('button', { class: `btn ${cls}`.trim(), type: 'button', onclick: run }, label);
    return h('div', {},
      h('p', { class: 'muted small' }, `Mapa aproximado em volta de ${farmName}. O desenho fica só neste aparelho.`), el, info,
      h('div', { class: 'row' },
        btn('Desfazer', '', () => { pts.pop(); refresh(); }),
        btn('Limpar', 'ghost', () => { pts.length = 0; refresh(); }),
        btn('Salvar contorno', 'primary', async () => {
          try { await setPlotOutline(db, plot.id, pts); close(); say('Contorno salvo.'); await rerender(); } catch (e) { fail(e); }
        }),
        plot.outline ? btn('Apagar o contorno salvo', 'danger', async () => { try { await setPlotOutline(db, plot.id, null); close(); say('Contorno apagado.'); await rerender(); } catch (e) { fail(e); } }) : ''));
  });
}
