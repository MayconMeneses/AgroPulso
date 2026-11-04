// Guarda os arquivos do app para abrir sem internet (RF-AG-015). Só arquivos do próprio app;
// os dados do produtor ficam no IndexedDB e nunca passam pelo cache (RNF-AG-007).
const CACHE = 'agropulso-__BUILD__'; // trocado pelo build a cada geração
const APP_FILES = []; // preenchido pelo build com TODOS os arquivos de dist (menos este)
const SHELL = ['./', ...APP_FILES];

self.addEventListener('install', (e) => {
  // cache: 'reload' ignora o cache HTTP da hospedagem, para a versão nova vir inteira e não misturada com a velha.
  // Sem skipWaiting aqui: a versão nova espera a pessoa aceitar a atualização (aviso no app), para não trocar o código no meio de um registro.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          return res;
        }),
    ),
  );
});
