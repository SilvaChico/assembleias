# Decisões e estado — 4 de novembro de 2026

Este registo complementa o brainstorming de `brief.md`, sem o reescrever como uma especificação aprovada.

## Confirmado pelo utilizador depois do brief

- Evoluir para uma aplicação funcional, com estado partilhado e persistente. Não assumir que uma única página sincroniza telemóveis.
- Suportar Lisboa e Porto em simultâneo, com dados separados, seleção por dropdown e palavras-passe de mesa distintas em variáveis de ambiente. O nome de utilizador fixo é `mesa`; não há contas pessoais de participantes.
- A participação digital destina-se a pessoas fisicamente presentes. Entram com um código de sala partilhado, introduzido uma vez por sessão. Não usar geolocalização, IP ou fingerprinting como comprovação.
- Aceitar por agora a restrição de repetição **no mesmo navegador normal**. Outros navegadores e janelas privadas contornam-na; o requisito anterior de impedir esse contorno foi expressamente relaxado. Não implementar distribuição de credenciais individuais, perfis ou histórico individual.
- Todas as propostas submetidas são imediatamente visíveis. A mesa escolhe o que vai a votação. Não foi escolhido um algoritmo de ranking, up/downvote, limiar de apoios ou gate de aprovação da publicação.
- A favor, Contra e Abstenção. Uma votação de cada vez por assembleia. A mesa abre e fecha.
- Votos presenciais públicos, por cartões levantados, geridos **fora da aplicação**. A mesa introduz três totais, separados dos digitais e somados no resultado.
- Os participantes só veem resultados depois do fecho. Mostrar os totais; a mesa interpreta o resultado. Não declarar aprovação/rejeição automaticamente.
- Interface em português de Portugal; preparar i18n com apenas esse catálogo. Conversas e relatos de implementação em inglês.
- Inspiração comunitária no Acampada Pixel, sem aparência de cópia. Ícones originais e sem reutilização de recursos externos.
- OpenSlides foi considerado e depois rejeitado por excesso de complexidade. Continuar a aplicação pequena; não houve instalação, migração ou cópia de código/recursos.
- Autorizar primeiro uma preview e depois, expressamente, **produção Vercel**, renomeando o projeto existente para `assembleias`. O endereço permanente deve funcionar para participantes sem conta Vercel. Preservar a proteção das previews. Manter dados fictícios para revisão e não confundir alojamento em produção com segurança eleitoral.
- Rejeitar Supabase. Usar SQLite alojado em Turso, pelo Marketplace Vercel. O utilizador ligou Starter, com cotação `$0/month`, e escolheu Irlanda (`dub1`). Não selecionar planos pagos sem decisão explícita.
- O fecho/publicação é final nesta versão: votos e contagens presenciais ficam imutáveis. Não reabrir, corrigir depois de publicar ou criar votações de substituição por iniciativa própria.

## Escolhas técnicas reversíveis da base local

- HTML/CSS/JavaScript sem framework e Node HTTP com libSQL. SQLite em ficheiro local ou Turso alojado na Vercel, sem disco efémero como persistência. Texto de propostas e contagens agregadas são conservados; recibos da votação ativa e sessões administrativas têm conservação própria, descrita no README.
- Inicialmente, lista em ordem de chegada com alternativa de mais recentes; o redesenho simplificado posterior conserva só a ordem de chegada. Apoios positivos à discussão mantidos como funcionalidade existente, sem determinar agenda nem aprovação e sem alegar unicidade.
- Estado temporário aleatório por proposta em localStorage, até ao fecho observado (o limite original de 24 h foi substituído pelo percurso por proposta abaixo), sem escolha; resumo consumido transacionalmente no servidor e eliminado logicamente no fecho. Nunca reutilizar entre propostas.
- Código comum de sala em cookie de sessão HttpOnly, distinto do cookie administrativo. O cookie comum é igual para todos os participantes da sala e não constitui prova de pessoa/presença.
- Atualizações por polling de dois segundos. Sessões administrativas até oito horas guardadas na base partilhada; logout ou alteração das credenciais/segredo invalida o acesso. Códigos de sala configurados por ambiente; mudar o código exige nova entrada. O segredo estável mantém sessões e entrada na sala entre instâncias/reinícios.
- Resultados digitais ocultos também na mesa enquanto abertos: não foi confirmada a necessidade de os ver em direto.
- Sem alteração de voto ou edição de uma proposta já em votação nesta implementação. A imutabilidade após fecho é uma decisão confirmada do utilizador.

## Por esclarecer ou validar

- Sequência operacional: contagem física antes de fechar/publicar, ou fecho digital primeiro e introdução/publicação posterior. A implementação local atual usa a primeira sequência; não está registada como decisão do utilizador.
- Duração/rotação e gestão operacional do código de sala ao longo de assembleias/sessões. A sessão de entrada no navegador não cria ainda uma entidade de sessão de assembleia no produto.
- Eventual alteração de voto/proposta antes de fechar, se vier a ser pedida. Depois do fecho, a imutabilidade está confirmada.
- Abuso de propostas/apoios, conservação de texto livre, correções e poderes da mesa. Não introduzir moderação oculta nem regras de ranking por iniciativa própria.
- Retenção, cópias de segurança e logs dos fornecedores antes de uso real. Restrição de navegador e código partilhado não impedem uma pessoa de votar nas duas vias.
- A retenção/lifecycle das reuniões ainda não tem gestão própria: propostas e resultados conservam-se por cidade. Não foi criado um sistema de sessões de assembleia, reinícios automáticos ou rotação automática de códigos.

## Verificado nesta base

Sete testes de dados/API e um percurso Chromium com contextos de participante e mesa separados, executado localmente e em produção com Turso. O percurso confirmou submissão, apoio, sincronização, abertura, voto repetido entre separadores/recarregamento, contagem presencial por substituição, fecho/resultados e separação entre cidades. Também foi simulada perda da confirmação depois de a base registar um voto: refresh/reenvio reutilizou o recibo e manteve um único voto. Outro separador retomou a ligação depois do fecho sem voltar a oferecer voto. Foram verificadas larguras de 320 e 375 px e orientação horizontal a 667 px, alvos interativos e pedidos de rede apenas à própria origem. Isto não substitui teste com leitores de ecrã, carga real ou análise de segurança eleitoral.

## Publicação verificada

Endereço permanente: https://assembleias-silvachicos-projects.vercel.app . Projeto `assembleias`, base e funções em Irlanda. O teste em contexto sem sessão Vercel confirmou consulta, código de sala, submissão e controlo da mesa por palavras-passe diferentes por cidade; não foi preciso um link temporário para participantes. Resultados digitais abertos não saem na API pública. A publicação usa `REVIEW_DATA=1`, com exemplos e resultados fictícios identificados. O fecho não produz uma classificação automática de aprovação/rejeição.

Publicação anterior à integração Git READY: `dpl_EDUXwjx21eEqLmVUWCN1zQLCiZQw`. GET anónimo à API devolveu 200, execução `dub1` confirmada nos cabeçalhos e resultados mantidos no Turso após republicação. Sete testes de dados/API passaram, incluindo mais de 30 entradas corretas na sala sem limitar a assembleia por contagens de tentativas erradas. Nessa fase o código-fonte era local, sem commits/remote GitHub, e a publicação usava envio direto de ficheiros; a integração Git posterior está descrita abaixo.

## Fonte, CI e proteção de main

O utilizador autorizou GitHub como fonte canónica, Vercel ligado ao mesmo repositório e alterações por PR com CI obrigatório. Após a API GitHub recusar proteção no repositório privado no plano atual, o utilizador escolheu explicitamente torná-lo público: https://github.com/SilvaChico/assembleias . A publicação foi revista para excluir valores reais de credenciais, `.env`, bases de dados, logs e artefactos de navegador.

`main` exige PR, branch atualizada e os checks `Static checks`, `Data and API` e `Browser flow`. A proteção aplica-se a administradores, proíbe force push e eliminação, e não exige aprovação humana. Um push de um commit vazio pelo proprietário foi realmente rejeitado com GH006, exigindo PR e os três checks; não continha código da aplicação.

O CI usa Node 22.23.4, Actions fixadas por SHA e Playwright de desenvolvimento fixado em 1.64.1. Corre com bases locais e dados fictícios, sem segredos de produção. Só capturas fictícias de falhas são artefactos. As credenciais Turso foram retiradas do âmbito preview, preservando produção; sem um ambiente de dados isolado adicional, previews servem para rever a interface e a API falha fechada. O fluxo completo é testado no servidor isolado do CI. Não foi criado outro projeto Vercel ou outra base.

O PR inicial #1 passou os três checks obrigatórios no commit final `581a64c` e foi integrado normalmente, sem bypass de administrador, no commit `7c53477` de `main`. O painel Vercel confirmou a ligação de `SilvaChico/assembleias` ao projeto existente `prj_QT8QqRRgm6K92mhJcdxosO2FEsXI`. Publicações seguintes devem partir da integração Git, preservando o endereço permanente, a base, os segredos e a região de produção.

## Simpler campsite interface — confirmed redesign

The user rejected the warm-paper dashboard and requested a much smaller, informal interface. The working title is **Assembleias para a Acampada**. Entry contains only restrained branding, the city dropdown, room code and enter action, with a small demonstration/privacy footer. Proposals and voting appear after room entry; this navigation gate does not make the public read API private. The mesa has a dedicated `/mesa` route and no participant navigation link. Its existing per-city password authentication remains server-verified.

Proposal creation asks for title and description only. The server accepts a missing category, stores an empty value for new category-free proposals, and keeps historical categories and compatibility with older clients. There is no destructive schema migration. The active proposal appears once, above the other proposals; closure and results remain final.

The user viewed three original pixel tent marks, rejected pixelation, then viewed smooth original SVG options D/E/F and explicitly chose **D — Tenda clássica**. That mark is used for both logo and favicon. No artwork, fonts, code or other resources were copied from Acampada Pixel. The layout uses a limited green palette, flat rows, system typography and text actions, with no new dependencies. Portuguese copy addresses people informally as *tu*.


## Room-code-only participation — supersedes the city entry flow

The user confirmed that participants and proposal authors enter only a shared **room code**, without choosing Lisboa or Porto or using another login. After admission, show the room context. `/mesa` still selects the city and verifies its existing city password, then selects an existing room or creates and opens a new one and shares its code. The classic smooth tent D and small informal Portuguese interface remain.

Cities remain the mesa authentication boundary. A small persistent `rooms` table owns proposals through `proposals.room`; globally unique, case-insensitive codes resolve to exactly one room. Creating a room opens participation immediately, without scheduling or a room-closing lifecycle. One proposal vote can be active **per room**, with independent rooms/cities. Submission, discussion support, three vote choices, manual raised-card totals, final closure and digital/physical/combined results keep their existing semantics. Cards remain outside the application.

The additive write-transaction migration maps every existing proposal to its city's legacy room and preserves all other columns, categories, results, active receipts and mesa sessions. Existing non-conflicting configured codes are imported once; missing, invalid or ambiguous legacy codes get distinct generated codes visible to the mesa. Saved room codes remain stable across restarts/environment changes. Participants must re-enter after upgrading the old city-cookie flow. No stored proposal/result or password is reset; password lifecycle work is explicitly outside this task.

The participant API now requires the common room cookie for reads as well as writes, scopes every proposal action to that room, and does not disclose other room codes. The former public city read endpoint is retired. Shared codes and the browser repeat restriction still prove neither presence nor one-person-one-vote. No accounts, participant identity/history, geolocation or new external service were added.

The user also asked for shorter privacy wording. Entry says “Não precisas de conta nem de indicar quem és.” and retains the details link. A separate read-only audit of main `d53b748` found no automatic application reading/storage/logging of participant IPs or forwarding of browser headers to Turso. The copy states that the application does not record participant IPs or send them to the database; Vercel receives the browser connection IP, and only the server contacts Turso. Provider log/retention guarantees and absolute anonymity remain unverified and are not promised.

### Review workflow — latest user instruction

Leave PRs **open and unmerged** for the user to inspect. Never merge automatically or publish this task to production. Add screenshots to PR descriptions whenever possible, showing fictitious local data and no production codes or credentials. A later explicit instruction is needed to merge/release. This supersedes the earlier authorization for automatic protected merging/deployment.

## Mesa-managed passwords — supersedes environment-only verification

The user requested a temporary starting credential, required first replacement, database persistence and changes by the mesa. Each city's existing server environment password is imported only when its credential is absent. The mesa must choose a different password before accessing rooms or voting controls; subsequent verification uses only the stored salted scrypt hash. Normal changes require the current password and replacement confirmation and atomically revoke that city's old sessions. No participant identities, recovery email, managed auth or new service are introduced. Controlled operator recovery sets a new temporary credential and revokes sessions; it never silently reactivates the old environment password. See `mesa-passwords.md` for migration, recovery and concurrency details.

Room-flow PR #4 has been merged upstream, so the password PR targets current `main`, rather than the former stacked room branch. This does not change the user's instruction: leave the password PR open and unmerged, include sanitized screenshots in its initial description, and do not deploy production.


## Per-proposal formal voting and mesa-only authoring — latest user decisions

Participants enter each proposal's formal vote with exactly four letters, without selecting a city or organisational room. Codes are server-generated, case-insensitive and globally unique across rooms/cities. A code keeps identifying the same proposal after closure and is never reassigned. The participant remains focused on that proposal, including through refresh/reconnection; after closure show its final count with an explicit back-to-start button. Browser navigation and tab closing remain normal.

The user then explicitly confirmed that **only the mesa adds proposals**. This supersedes earlier participant submission and the temporary implementation assumption of a separate submission page; neither page nor link ships. The simple title/description form stays inside authenticated `/mesa`, scoped to its selected city/room. Anonymous, legacy room-only and vote-only admission cannot create proposals. Existing records, historical supports, categories and results remain; no new public agenda/support flow is introduced.

Shared vote admission is distinct from a browser's per-proposal receipt. Re-entry and extra tabs reuse the receipt, with no new allowance from an admission cookie. The old 24-hour client expiry is removed: receipts last until that proposal's closure is observed, and may remain on an abandoned device. Server deduplication hashes are removed at closure; there is no claim about forensic erasure or provider backups. Short entry privacy copy and Vercel's connection-IP limitation remain. See `vote-codes.md` for the additive migration, authorization, finite code namespace and verification details. No new service/dependency, participant identity, merge or production release is authorized by this feature.


## Participant privacy copy — latest user instruction

The user explicitly rejected naming the hosting provider or explaining hosting/connection processing in participant-facing copy. Keep entry and the privacy dialog short, informal and in Portuguese (Portugal), with no hosting-provider names or provider-log disclaimer. This supersedes the earlier named-provider notice, including the preceding vote-code section's wording recommendation. Operational documentation may retain infrastructure details for maintainers.

Entry continues to say “Não precisas de conta nem de indicar quem és.” The dialog says “A aplicação não guarda o teu IP.” A focused recheck of the current vote-code source found no application reading, logging or storage of participant IP addresses, and no forwarding of participant headers to the server-only database client. This is an application-level statement, not a claim that network infrastructure processes no connection data. Do not replace the removed paragraph with an absolute anonymity, no-traces or security guarantee. Existing receipt-retention, shared-code, repeat-vote and demonstration limits remain visible.


## Proposal concept — latest user correction

The user removed rooms from the product concept: each shared code refers directly to one proposal. The mesa creates the title and description in one step and receives a random four-character code immediately. Participants entering it see that proposal even before voting opens; supporting discussion remains separate from voting. The mesa selects proposals by code/title across its city, with no room creation or room selector. Only the mesa creates proposals, as previously confirmed.

The implementation retains the existing four random ASCII-letter generator and global unique `vote_codes` mapping. Creation and allocation are atomic; opening keeps the code. Historical waiting and closed proposals gain codes without rewriting their text, counts, active receipts, password credentials or sessions. The old `rooms` table is retained solely as a compatibility scope; new proposal scopes have no room code. Historical groups retain their original active-vote constraint. No external service, new dependency, merge or production release is authorized by this change.
