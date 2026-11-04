# Segurança

## Como avisar de uma falha

Use o aviso privado do GitHub: aba **Security**, depois **Report a vulnerability**. Não abra uma issue pública com os detalhes. Responderei assim que possível e o aviso fica registrado junto com a correção.

## O que o app protege e o que não protege

- Os dados (propriedades, custos, vendas, fotos) ficam só no aparelho de quem usa, no banco do navegador. Não existe servidor do AgroPulso e nada é enviado a ele.
- Os únicos pedidos para fora são os do tempo (api.open-meteo.com) e do mapa (tile.openstreetmap.org), e só quando a pessoa deixa ligado. Há uma chave para desligar os dois.
- O banco do navegador não é cifrado: quem tem acesso ao aparelho desbloqueado tem acesso aos dados. Use a tela bloqueada do celular.
- A cópia de segurança pode ser protegida por senha (AES-256-GCM, chave derivada com PBKDF2-SHA256, 600.000 iterações). Sem senha, o arquivo é texto legível.
- A página é servida pelo GitHub Pages, que não deixa definir cabeçalhos HTTP. A política de conteúdo (CSP) vai em uma tag `<meta>`, e a proteção contra ser aberto dentro de outro site é feita por script.

## Versões

Só a versão publicada na `main` recebe correções.
