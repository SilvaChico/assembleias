# Assembleias para a Acampada

Código-fonte: [SilvaChico/assembleias](https://github.com/SilvaChico/assembleias). Processo de branches, CI obrigatório e publicações: [docs/development.md](docs/development.md).

Aplicação para propostas, apoios à discussão e votação presencial com duas vias: digital e contagem pública de cartões introduzida pela mesa. Lisboa e Porto têm dados, votações e acessos da mesa independentes. Ainda não está validada para decisões reais.

## Abrir localmente

Requer Node.js 22.22 ou posterior. A única dependência direta de produção é `@libsql/client@0.18.0`, com versões fixadas em `package-lock.json`.

```sh
npm ci
npm run setup
npm run dev
```

Abrir `http://127.0.0.1:4173`. O acesso da mesa fica em `http://127.0.0.1:4173/mesa`, sem ligação na interface dos participantes. O comando `setup` cria `.env` com palavras-passe e códigos aleatórios diferentes para as duas assembleias, sem os escrever nos logs. Não substitui um `.env` existente. Consultar esse ficheiro localmente para obter as credenciais; o nome de utilizador da mesa é `mesa`. Em alternativa, copiar `.env.example` para `.env` e preencher os valores. Não partilhar nem publicar `.env`.

O modo normal começa sem propostas. Para experimentar com exemplos fictícios:

```sh
npm run demo
```

O modo de teste usa uma base separada e está identificado na interface. Também aceita propostas e contagens introduzidas durante os testes. Recarregar a página ou reiniciar o servidor preserva os dados; não existe uma reposição automática.

## Experimentar o percurso

1. Escolher Lisboa ou Porto. Introduzir o código anunciado na sala para abrir a interface de propostas e votação. O código é partilhado e não prova presença nem unicidade; a API de consulta continua pública.
2. Submeter uma proposta. Aparece imediatamente para todos os dispositivos ligados à mesma instância, sem aprovação da mesa. A lista usa a ordem de chegada. Não há categorias na criação nem na apresentação; categorias históricas são conservadas na base. Apoiar a discussão não é votar a favor nem impõe prioridade na agenda.
3. Noutro separador ou dispositivo, abrir `/mesa` e entrar com a palavra-passe dessa assembleia. Escolher a proposta e abrir a votação. Só pode existir uma votação aberta por assembleia; Lisboa e Porto podem votar em simultâneo.
4. Nos participantes, surge a proposta ativa e A favor, Contra e Abstenção. O voto é confirmado pelo servidor. Os totais por opção não são enviados à vista dos participantes enquanto a votação está aberta.
5. Na mesa, introduzir e guardar os três totais presenciais. Nesta implementação local, a contagem é guardada antes de fechar/publicar; essa sequência operacional ainda pode ser ajustada após a clarificação do utilizador. Reenviar substitui os valores, não os soma. Uma versão de contagem evita sobrepor alterações feitas noutra vista da mesa.
6. Fechar e publicar. Os resultados apresentam cada opção com o subtotal digital, presencial e combinado. A aplicação mostra totais; cabe à mesa interpretar e anunciar o resultado. Não calcula aprovação, rejeição, quórum ou maioria.

As vistas consultam o servidor a cada dois segundos. É sincronização real entre páginas ligadas ao mesmo servidor, não uma simulação de partilha. A página avisa quando perde a ligação; não reenvia votos automaticamente.

## Outros dispositivos na rede local

Por omissão o servidor só aceita ligações deste computador. Para testar numa rede privada, configurar no `.env`, substituindo o endereço pelo IP deste computador:

```dotenv
APP_HOST=0.0.0.0
APP_ORIGIN=http://192.168.1.10:4173
```

Abrir exatamente esse endereço em todos os dispositivos e reiniciar o servidor após alterar a configuração. O código não usa o IP para identificar participantes; este endereço apenas permite chegar ao servidor. HTTP não protege credenciais em trânsito: esta configuração serve para uma rede local de teste. Não expor o servidor diretamente à Internet.

## Dados, privacidade e restrição de repetição

- SQLite persiste propostas e contagens agregadas em `.data/assembleias.sqlite` ou `.data/demo.sqlite`. A pasta e `.env` estão ignorados pelo Git. O servidor cria a pasta com permissões restritas e a base com modo `0600`.
- O código de sala cria um cookie de sessão **igual para toda a sala**. Não é um identificador individual. Funciona entre separadores do mesmo navegador; o restauro de sessões do navegador pode prolongar cookies de sessão. O código não prova presença e pode ser partilhado.
- Ao votar, o navegador guarda em `localStorage` um valor aleatório **só para a proposta ativa**, validade máxima de 24 horas e confirmação de envio, sem a opção escolhida. Não é reutilizado entre propostas. O servidor consome um resumo desse valor, separado da contagem, na mesma transação do incremento do voto. Repetir o pedido com o mesmo valor não acrescenta votos, mesmo após uma falha de confirmação.
- Web Locks coordenam os separadores quando disponíveis; `storage` propaga a confirmação. Em HTTP na rede local pode não existir Web Locks: a coordenação entre separadores é então de melhor esforço. A API continua a rejeitar repetições do mesmo valor.
- Os recibos temporários do servidor são removidos logicamente no fecho. O navegador elimina o seu estado quando observa o fecho, quando visita de novo essa assembleia ou quando deteta a expiração. Não executa tarefas em segundo plano depois de ser fechado. Apagar uma linha de SQLite não garante apagamento forense de páginas, WAL ou cópias de segurança.
- Outros navegadores, janelas privadas, apagar dados, expiração ou alteração deliberada do cliente contornam a restrição. Também não se impede votar nas duas vias. Este limite foi aceite pelo utilizador; **não é uma garantia de uma pessoa, um voto nem prevenção real de fraude**.
- A mesa usa um cookie próprio HttpOnly e SameSite=Strict, separado por assembleia, até oito horas. As sessões administrativas são guardadas na base partilhada, com apenas um resumo do token, assembleia, validade e vínculo à configuração da palavra-passe. Terminar sessão ou alterar a palavra-passe/segredo do servidor invalida-as; com o mesmo segredo, sobrevivem a reinícios e instâncias diferentes. As palavras-passe são verificadas no servidor com scrypt e não são entregues ao cliente.
- Não existem contas de participantes, recolha de nomes/contactos, geolocalização, analytics, fingerprinting, session replay, publicidade, fontes remotas ou ícones de terceiros. O servidor da aplicação não escreve logs de acesso, IP ou corpos dos pedidos. Isto não é uma promessa de anonimato absoluto nem cobre o funcionamento do navegador, da rede ou de um futuro fornecedor de alojamento.
- Propostas são texto livre público e podem conter dados pessoais introduzidos por quem escreve. A interface pede que não os incluam; não alega anonimizar texto automaticamente. Os apoios à discussão ainda podem ser repetidos e não representam pessoas únicas.

## Implementação e verificações

HTML, CSS e módulos JavaScript no cliente; Node HTTP e o cliente libSQL no servidor. Não há framework nem compilação da interface. Localmente usa um ficheiro SQLite; na Vercel usa SQL sobre HTTPS para a base Turso, sem ficheiro efémero ou cópia local a fingir persistência. A base de dados impõe uma votação ativa por assembleia; as escritas são transacionais. Os resultados abertos são filtrados pelo servidor, e não apenas escondidos com CSS.

As mensagens da interface e os erros de API estão centralizados em `public/locales/pt-PT.js`, usando `public/i18n.js`. Só existe português de Portugal; dados livres das propostas não são traduções. A tenda original escolhida pelo utilizador (opção D, sem pixelização) em `public/favicon.svg` é usada no logo e no favicon. As alternativas estão em `design/tent-options/`; não foram copiados recursos do Acampada Pixel. A interface já não carrega a antiga coleção de ícones.

```sh
npm test
```

Sete testes de dados/API verificam transições, separação entre assembleias, contagens inválidas, substituição e conflitos de versão, persistência, recibos temporários, proteção da mesa, código de sala, origem dos pedidos, ocultação dos resultados, expiração de sessões e vinte pedidos concorrentes com o mesmo recibo, além de entrada de mais de 30 participantes com código correto sem aplicar o limite reservado a códigos errados. Foram executados com sucesso. Apenas a inspeção de ficheiro num teste usa `node:sqlite`, que pode emitir um aviso experimental em Node 22; o runtime da aplicação usa libSQL.

`tests/browser.mjs` verifica o percurso completo com Playwright: mesa e participante em contextos separados, submissão e erro acessível, apoio distinto, sincronização, voto simultâneo em separadores, recarregamento, perda da resposta após o registo seguida de refresh/reenvio idempotente, retoma após fecho, contagem presencial reenviada, resultados consistentes, limpeza do estado temporário, isolamento Lisboa/Porto e ausência de pedidos externos do cliente e alvos/tamanhos móveis (320, 375 e 667 px). Foi executado com Chromium disponível neste ambiente, tanto localmente como no endereço de produção com Turso e contextos sem sessão Vercel. Não há ainda auditoria com leitor de ecrã ou avaliação de segurança eleitoral.

O teste de navegador é obrigatório no CI e usa Playwright fixado no lockfile. Localmente, instalar Chromium com `npx --no-install playwright install chromium`. `PLAYWRIGHT_MODULE` pode apontar para o módulo instalado e `PLAYWRIGHT_CHROMIUM_EXECUTABLE` para um Chromium existente; depois executar `npm run test:browser`. Não são credenciais da aplicação. As capturas ficam na pasta ignorada `test-results/`.

## Produção Vercel e Turso

Endereço permanente: https://assembleias-silvachicos-projects.vercel.app

O projeto existente foi renomeado para `assembleias`, preservando o ID `prj_QT8QqRRgm6K92mhJcdxosO2FEsXI`. O utilizador autorizou expressamente a publicação em produção. Turso Starter foi ligado pelo Marketplace da Vercel: cotação de `$0/month`, sem cartão, confirmada em 4 de novembro de 2026. A base e as funções estão na região Irlanda (`dub1`). Não foi criado nenhum recurso Supabase.

O endereço permanente permite acesso sem conta Vercel. A proteção Vercel permanece nos endereços de deployments e nas previews, através de Standard Protection. A entrada na sala e o acesso da mesa são verificados separadamente pela aplicação. Não se usam links temporários ou tokens de bypass como ligação dos participantes.

Segredos apenas no ambiente do servidor: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SESSION_SECRET`, `LISBOA_ADMIN_PASSWORD`, `PORTO_ADMIN_PASSWORD`, `LISBOA_ROOM_CODE` e `PORTO_ROOM_CODE`. Não estão nos ficheiros estáticos, código-fonte ou pacote enviado para deploy. As palavras-passe/códigos desta instalação foram gerados localmente e estão no `.env` privado desta pasta, além dos settings da Vercel. Não colocar esses valores em logs, argumentos de comandos ou mensagens públicas.

`REVIEW_DATA=1` mantém esta instalação com exemplos identificados como dados fictícios para revisão. Os testes ao vivo acrescentaram propostas fictícias e resultados de teste. O alvo de alojamento ser produção não significa segurança eleitoral, prevenção real de fraude ou validação para decisões reais.

O acesso à base, operações transacionais, sessões da mesa e limite agregado de tentativas são partilhados entre instâncias. O código comum da sala é derivado de configuração estável, sem criar uma identidade por participante. A base local continua independente da base alojada.

A aplicação não inclui analytics, rastreadores, session replay ou recursos de terceiros no cliente; os pedidos de rede do navegador foram verificados. Vercel e Turso podem processar IP e registos técnicos na infraestrutura. Não se garante anonimato absoluto, ausência de logs nos fornecedores, apagamento forense ou eliminação de backups. A aplicação regista apenas categorias técnicas de falhas inesperadas, sem SQL, credenciais, IP ou corpos dos pedidos. A retenção/observabilidade dos fornecedores exige revisão própria antes de uso real.

A publicação parte do repositório Git ligado ao projeto existente. `.env`, `.data`, bases locais e capturas estão excluídos do Git; apenas `public` é saída estática e a API é empacotada no servidor. O comando `npm ci` e o lockfile reproduzem as dependências; `vercel.json` configura região, API e cabeçalhos. O cliente fala só com a sua própria origem; a ligação Turso ocorre no servidor.

A última publicação anterior a este redesenho foi verificada como READY a partir do commit `451d9fd` de `main` (`dpl_7mnhQrbiTSdp5hnaEhfuL1oXH2dM`). A verificação final sem autenticação recebeu HTTP 200, confirmou a execução em Dublin pelos cabeçalhos e encontrou os resultados Turso conservados depois da nova publicação. O código-fonte passou a ser gerido no repositório público `SilvaChico/assembleias`, por branches `codex/`, pull requests e três checks obrigatórios no GitHub Actions. A publicação inicial por envio de ficheiros foi substituída por releases a partir do Git.

O contexto original de brainstorming continua em `docs/brief.md`; as decisões posteriores estão em `docs/decisoes.md`.
