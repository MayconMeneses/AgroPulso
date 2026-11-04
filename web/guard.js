// Proteção contra "clickjacking": a hospedagem do site não deixa enviar o cabeçalho X-Frame-Options e a política de conteúdo
// em <meta> ignora frame-ancestors. Por isso a página nasce escondida (styles.css) e só é mostrada se NÃO estiver dentro de
// uma moldura de outro site. Se estiver, continua invisível e tenta sair da moldura. Roda no <head>, antes do corpo aparecer.
(function () {
  var framed = true;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (!framed) { document.documentElement.className += ' live'; return; }
  try { window.top.location = window.self.location.href; } catch (e) { /* moldura com sandbox: segue escondida */ }
})();
