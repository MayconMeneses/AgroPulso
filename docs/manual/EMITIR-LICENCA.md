# Como gerar chaves e licenças do AgroPulso (guia do dono)

Este guia é só para você. Tudo roda no seu computador, na pasta do projeto, com o comando `node scripts/licenca.mjs`.
Nada do que está aqui vai para o app nem para o GitHub, exceto a **chave pública**, que é feita para ser pública.

## Palavras que aparecem

- **Chave privada:** o "carimbo" que só você tem. Quem a tiver consegue criar licenças falsas. Nunca compartilhe.
- **Chave pública:** a "lupa" que o app usa para conferir se o carimbo é seu. Pode ficar no app.
- **Licença (ou chave de licença):** o texto que você manda ao cliente. O app confere sozinho, sem internet.

## Parte 1: uma vez só, para começar

1. Abra o terminal na pasta do projeto.
2. Crie o par de chaves:
   ```
   node scripts/licenca.mjs gerar-chaves
   ```
   Ele cria a pasta `AgroPulso-licencas` na sua pasta de usuário (fora do projeto) com dois arquivos: `chave-privada.pem` e `chave-publica.json`.
3. **Faça uma cópia da `chave-privada.pem` agora**, em lugar seguro (gerenciador de senhas ou um pen drive guardado). Se você perder, não consegue emitir novas licenças. Se alguém pegar, consegue emitir licenças falsas.
4. Coloque a chave pública no app:
   ```
   node scripts/licenca.mjs aplicar-chave-publica
   ```
5. Peça ao Claude para rodar os testes e enviar ao GitHub. Só depois disso o app novo passa a reconhecer as suas licenças.

## Parte 2: ativar a sua própria licença (antes de cobrar de qualquer pessoa)

1. Emita a licença interna (não vence):
   ```
   node scripts/licenca.mjs emitir --nome "Maycon" --plano interna
   ```
2. Ele mostra uma **mensagem pronta** com um link. Abra o link **no seu iPhone** e **no seu computador**. O app diz "Licença ativada" e o link some do endereço.
3. Confira em **Cadastros > Licença** que aparece "Licenciado para Maycon".
4. Só quando todos os seus aparelhos estiverem ativados, peça ao Claude para ligar a cobrança. **Se ligar antes, os seus dados ficam em somente leitura.**

## Parte 3: emitir para um cliente

Depois do pagamento confirmado:

```
node scripts/licenca.mjs emitir --nome "Maria" --plano anual --whatsapp 5581999999999
```

- `--plano` pode ser `anual` (vale 365 dias) ou `mensal` (vale 30 dias mais 7 de tolerância).
- `--nome` é o nome que o cliente quer ver no app (até 40 letras).
- `--whatsapp` é opcional: com ele, o comando também mostra um link `wa.me` que abre o WhatsApp do cliente já com a mensagem pronta. Você só toca em enviar.
- `--aparelhos 3` é o padrão; `--ate 2027-12-31` troca a data de validade.

O comando mostra a mensagem completa (link de ativação e a chave por escrito, caso o link não abra) e anota a licença na lista `licencas-emitidas.jsonl`, na pasta `AgroPulso-licencas`. Essa lista tem WhatsApp de cliente: **fica fora do projeto e do GitHub**, e deve entrar na política de privacidade.

## Se algo der errado

- **"Já existe uma chave privada":** o comando recusa para não apagar a sua. Não use `--forcar` sem ter a cópia da chave antiga: as licenças já entregues deixariam de funcionar.
- **"A pasta está dentro do projeto":** use uma pasta fora dele.
- **Cliente diz que a chave não funciona:** peça para colar a chave inteira em Cadastros > Licença. Se aparecer "incompleta", faltou um pedaço da cópia. Emita de novo (cada emissão é uma licença nova).
- **Cliente trocou de celular:** a licença não vai na cópia de segurança. Ele cola a mesma chave de novo (vale para 3 aparelhos).
