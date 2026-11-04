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
- Lista em ordem de chegada, com alternativa de mais recentes. Apoios positivos à discussão mantidos como funcionalidade existente, sem determinar agenda nem aprovação e sem alegar unicidade.
- Estado temporário aleatório por proposta em localStorage, até ao fecho observado/24 h, sem escolha; resumo consumido transacionalmente no servidor e eliminado logicamente no fecho. Nunca reutilizar entre propostas.
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

Publicação final READY: `dpl_EDUXwjx21eEqLmVUWCN1zQLCiZQw`. GET anónimo à API devolveu 200, execução `dub1` confirmada nos cabeçalhos e resultados mantidos no Turso após republicação. Sete testes de dados/API passaram, incluindo mais de 30 entradas corretas na sala sem limitar a assembleia por contagens de tentativas erradas. Código-fonte local, ainda sem commits/remote GitHub; envio direto de ficheiros para Vercel.

## Fonte, CI e proteção de main

O utilizador autorizou GitHub como fonte canónica, Vercel ligado ao mesmo repositório e alterações por PR com CI obrigatório. Após a API GitHub recusar proteção no repositório privado no plano atual, o utilizador escolheu explicitamente torná-lo público: https://github.com/SilvaChico/assembleias . A publicação foi revista para excluir valores reais de credenciais, `.env`, bases de dados, logs e artefactos de navegador.

`main` exige PR, branch atualizada e os checks `Static checks`, `Data and API` e `Browser flow`. A proteção aplica-se a administradores, proíbe force push e eliminação, e não exige aprovação humana. Um push de um commit vazio pelo proprietário foi realmente rejeitado com GH006, exigindo PR e os três checks; não continha código da aplicação.

O CI usa Node 22.23.4, Actions fixadas por SHA e Playwright de desenvolvimento fixado em 1.64.1. Corre com bases locais e dados fictícios, sem segredos de produção. Só capturas fictícias de falhas são artefactos. As credenciais Turso foram retiradas do âmbito preview, preservando produção; sem um ambiente de dados isolado adicional, previews servem para rever a interface e a API falha fechada. O fluxo completo é testado no servidor isolado do CI. Não foi criado outro projeto Vercel ou outra base.
