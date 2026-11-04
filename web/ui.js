// Ajudantes de tela. Todo texto entra por textContent: nada digitado vira HTML (evita XSS).
// Nenhum atributo "style" é criado: a política de segurança da página (CSP) não permite estilo embutido.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) el.append(c instanceof Node ? c : document.createTextNode(String(c ?? '')));
  return el;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// Ícones próprios (traço simples, sem biblioteca de terceiros). Decorativos: o texto vem ao lado ou em aria-label.
const ICONS = {
  painel: 'M5 20V11M12 20V5M19 20v-7',
  registrar: 'M12 5v14M5 12h14',
  safras: 'M12 21v-9M12 12c0-4 3-7 8-7 0 4-3 7-8 7zM12 15c0-3-2-5-6-5 0 3 2 5 6 5z',
  cadastros: 'M4 7h16M4 12h16M4 17h10',
  estoque: 'M3 8l9-5 9 5v9l-9 5-9-5zM3 8l9 5 9-5M12 13v9',
  relatorio: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6',
  backup: 'M12 4v10M8 10l4 4 4-4M5 20h14',
  atividade: 'M5 5h14v14H5zM5 9h14M9 14l2 2 4-4',
  despesa: 'M7 17L17 7M9 7h8v8',
  entrada: 'M17 7L7 17M15 17H7V9',
  colheita: 'M12 21V9M12 9c-3 0-4-2-4-4 3 0 4 2 4 4zM12 9c3 0 4-2 4-4-3 0-4 2-4 4zM12 15c-3 0-4-2-4-4 3 0 4 2 4 4zM12 15c3 0 4-2 4-4-3 0-4 2-4 4z',
  venda: 'M3 12l9-9h8v8l-9 9zM16 8h.01',
  recebimento: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v10M9 10h4.5a1.5 1.5 0 010 3H10a1.5 1.5 0 000 3H15',
  propriedade: 'M3 11l9-7 9 7M5 10v10h14V10',
  unidade: 'M3 17L17 3l4 4L7 21zM8 12l2 2M11 9l2 2',
  fator: 'M7 7h12l-3-3M17 17H5l3 3',
  talhao: 'M4 4h16v16H4zM4 12h16M12 4v16',
  pessoa: 'M12 4a4 4 0 100 8 4 4 0 000-8zM4 20c0-4 3.5-6 8-6s8 2 8 6',
  trabalho: 'M12 4a4 4 0 100 8 4 4 0 000-8zM4 20c0-4 3.5-6 8-6s8 2 8 6M17 3l2 2 3-3',
  fechar: 'M6 6l12 12M18 6L6 18',
  escuro: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  claro: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  auto: 'M12 3a9 9 0 100 18V3z',
};
export function icon(name) {
  const s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: 'ico' });
  s.append(svg('path', { d: ICONS[name] ?? ICONS.painel }));
  return s;
}

// Símbolo animado da marca: o ponto luminoso corre pelo traço de pulso, no mesmo ritmo do brilho (3,2 s).
// Parado para quem pede menos movimento (CSS esconde .dot).
const PULSE = 'M 50 319 C 200 319 380 319 462 319 C 478 319 483 304 491 287 C 499 301 506 318 514 328 C 520 324 523 324 528 325 C 536 344 541 365 548 383 C 566 331 584 260 601 213 C 615 261 627 331 638 368 C 648 348 657 320 665 304 C 675 309 683 318 695 319 C 785 319 900 319 1030 319';
let markSeq = 0;
export function animatedMark() {
  const id = `glow-${++markSeq}`;
  const s = svg('svg', { class: 'mark', viewBox: '0 0 1080 546', role: 'img', 'aria-label': 'AgroPulso', focusable: 'false' });
  const filter = svg('filter', { id, x: '-300%', y: '-300%', width: '700%', height: '700%' });
  filter.append(svg('feGaussianBlur', { stdDeviation: 9, result: 'b' }));
  const merge = svg('feMerge');
  merge.append(svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' }));
  filter.append(merge);
  const defs = svg('defs');
  defs.append(filter);
  s.append(defs, svg('image', { href: 'icons/simbolo.webp', x: 0, y: 0, width: 1080, height: 546 }));
  for (const [r, fill, opacity] of [[11, '#35ff78', '.38'], [5.2, '#f6fff8', '1']]) {
    const dot = svg('circle', { class: 'dot', r, fill, opacity, filter: `url(#${id})` });
    dot.append(svg('animateMotion', { dur: '3.2s', repeatCount: 'indefinite', rotate: 0, path: PULSE }));
    s.append(dot);
  }
  return s;
}

// Anel de progresso. fraction entre 0 e 1, ou null quando não há base para calcular.
export function ring(fraction, big, small) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const f = fraction === null ? 0 : Math.min(Math.max(fraction, 0), 1);
  const s = svg('svg', { viewBox: '0 0 128 128', 'aria-hidden': 'true', focusable: 'false' });
  s.append(svg('circle', { class: 'ring-track', cx: 64, cy: 64, r: R }));
  s.append(svg('circle', { class: 'ring-bar', cx: 64, cy: 64, r: R, 'stroke-dasharray': `${(f * C).toFixed(1)} ${C.toFixed(1)}`, transform: 'rotate(-90 64 64)' }));
  return h('div', { class: 'ring' }, s, h('div', { class: 'ring-center' }, h('strong', {}, big), h('span', {}, small)));
}

// Linhas por mês: despesas e vendas. A linha se desenha uma vez ao aparecer (CSS, desligado para quem pede menos
// movimento). Os valores exatos ficam na tabela ao lado e no título de cada ponto, para leitores de tela.
export function lines(rows, formatMoney) {
  const data = rows.slice(-8);
  const max = Math.max(1, ...data.flatMap((r) => [r.expensesCents, r.salesCents]));
  const W = Math.max(480, 70 * data.length);
  const x = (i) => (data.length === 1 ? W / 2 : 22 + (i * (W - 44)) / (data.length - 1));
  const y = (v) => 92 - (v / max) * 78;
  const s = svg('svg', { viewBox: `0 0 ${W} 120`, role: 'img', 'aria-label': 'Despesas e vendas por mês, em linhas', class: 'lines' });
  s.append(svg('line', { class: 'axis', x1: 10, y1: 92, x2: W - 10, y2: 92 }));
  const path = (key) => data.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(r[key]).toFixed(1)}`).join(' ');
  if (data.length > 1) {
    s.append(svg('path', { class: 'area-sale', d: `${path('salesCents')} L${x(data.length - 1).toFixed(1)} 92 L${x(0).toFixed(1)} 92 Z` }));
    s.append(svg('path', { class: 'ln line-exp', d: path('expensesCents'), pathLength: 1 }));
    s.append(svg('path', { class: 'ln line-sale', d: path('salesCents'), pathLength: 1 }));
  }
  data.forEach((r, i) => {
    for (const [v, cls, nome] of [[r.expensesCents, 'dot-exp', 'Despesas'], [r.salesCents, 'dot-sale', 'Vendas']]) {
      const dot = svg('circle', { class: cls, cx: x(i).toFixed(1), cy: y(v).toFixed(1), r: 3.4 });
      const t = svg('title');
      t.textContent = `${r.month} - ${nome}: ${formatMoney(v)}`;
      dot.append(t);
      s.append(dot);
    }
    const lab = svg('text', { class: 'bar-label', x: x(i).toFixed(1), y: 112, 'text-anchor': 'middle' });
    lab.textContent = `${r.month.slice(5)}/${r.month.slice(2, 4)}`;
    s.append(lab);
  });
  return s;
}

// Gaveta: no celular sobe de baixo, no computador entra pela direita. <dialog> traz foco preso e tecla Esc.
export function openSheet(title, build) {
  const dlg = h('dialog', { class: 'sheet', 'aria-label': title });
  const close = () => { if (dlg.open) dlg.close(); dlg.remove(); }; // remove já aqui: não depende do evento "close" chegar
  dlg.append(
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: close }, icon('fechar'))),
    h('div', { class: 'sheet-body' }, build(close)),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

// Etiqueta de origem do número: o que a pessoa digitou, o que o app calculou, o que é estimativa e o que veio de fora.
const TAGS = {
  digitado: ['Digitado', 'Valor que você mesmo registrou'],
  calculado: ['Calculado', 'Conta feita pelo app a partir do que você registrou'],
  estimado: ['Estimado', 'Estimativa, não é medida nem dado registrado'],
  externo: ['Fonte externa', 'Dado de um serviço de fora, que pode errar'],
};
export function tag(kind) {
  const [label, hint] = TAGS[kind];
  return h('span', { class: `tag tag-${kind}`, title: hint }, label);
}

export function chip(label, active, onclick) {
  return h('button', { class: 'chip', type: 'button', 'aria-pressed': active ? 'true' : 'false', onclick }, label);
}

export function say(message, kind = 'ok') {
  const s = document.getElementById('status');
  s.textContent = message;
  s.className = kind;
}

// Mostra a mensagem em português dos erros do domínio; o resto vira uma frase genérica (o detalhe vai ao console).
export function fail(error) {
  if (error && (error.name === 'DomainError' || error.name === 'BackupError' || error.name === 'StorageError')) say(error.message, 'err');
  else {
    console.error(error);
    say('Algo deu errado e nada foi salvo. Tente de novo.', 'err');
  }
}

// fields: { name, label, type: text|date|select|textarea|checkbox|file, options: [[valor, rótulo]], hint }
export function form(fields, submitLabel, onSubmit) {
  const f = h('form', { novalidate: true });
  for (const fd of fields) {
    let input;
    if (fd.type === 'select') {
      input = h('select', { name: fd.name }, h('option', { value: '' }, fd.placeholder ?? 'Escolha…'), (fd.options ?? []).map(([v, l]) => h('option', { value: v }, l)));
    } else if (fd.type === 'textarea') input = h('textarea', { name: fd.name, rows: 3 });
    else input = h('input', { name: fd.name, type: fd.type ?? 'text', inputmode: fd.inputmode, autocomplete: 'off' });
    f.append(h('label', { class: fd.type === 'checkbox' ? 'check' : '' }, fd.type === 'checkbox' ? [input, fd.label] : [fd.label, fd.hint ? h('span', { class: 'muted' }, ` (${fd.hint})`) : '', input]));
  }
  f.append(h('button', { class: 'btn primary', type: 'submit' }, submitLabel));
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const values = {};
    for (const fd of fields) {
      const el = f.elements[fd.name];
      values[fd.name] = fd.type === 'checkbox' ? el.checked : fd.type === 'file' ? el.files?.[0] ?? null : el.value;
    }
    try {
      await onSubmit(values, f);
    } catch (e) {
      fail(e);
    }
  });
  return f;
}

export function table(headers, rows) {
  return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
}

export function download(name, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const STATUS = { RASCUNHO: 'Rascunho', PLANEJADA: 'Planejada', EM_ANDAMENTO: 'Em andamento', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };
