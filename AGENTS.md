# Orientações do projeto

- Communicate, write developer comments and name tests/CI checks in English. Keep the product interface in Portuguese (Portugal), with only that locale shipped.
- Ler `docs/brief.md` antes de alterar o produto. Distinguir requisitos do utilizador, sugestões de brainstorming e decisões ainda em aberto.
- O nome `assembleias` é provisório. Não gastar o arranque em branding definitivo.
- A privacidade dos participantes é um requisito central: não introduzir recolha de nome, e-mail, telefone, documentos, biometria, coordenadas guardadas, perfis persistentes ou históricos individuais de participação.
- Não adicionar analytics, session replay, fingerprinting, publicidade ou rastreadores. Examinar dependências, recursos externos, logs e serviços de alojamento antes de afirmar garantias de privacidade.
- Não utilizar IP, impressão digital do dispositivo, cookies ou identificadores persistentes como prova de uma pessoa, um voto. Um identificador pseudónimo pode permitir correlação.
- Geolocalização é uma hipótese em estudo, não uma decisão: não pedir permissões nem recolher coordenadas no protótipo. Demonstrar a presença com dados fictícios. Um resultado calculado apenas no cliente não constitui prova fiável para o servidor.
- Distinguir apoiar a discussão de uma proposta de votar a sua aprovação.
- Não apresentar deduplicação local de uma demonstração como prevenção real de fraude. Distinguir uma pessoa, uma credencial, um navegador e um dispositivo.
- O protótipo inicial deve indicar que é uma demonstração com dados fictícios. Não prometer anonimato absoluto ou segurança eleitoral sem evidência.
- Usar o Acampada Pixel como inspiração; não copiar código, imagens, áudio ou outros recursos sem verificar a licença ou obter autorização.
- Escolher uma implementação simples e justificar as escolhas. Aplicar as skills relevantes da sessão. Não criar serviços externos nem publicar a aplicação como parte do primeiro protótipo local.
- Verificar os fluxos essenciais e a acessibilidade: submissão, apoios, abertura/fecho, bloqueio de votos fora do período e leitura dos resultados. Não criar testes que apenas espelhem código trivial.

- Leave every pull request open for the user to review. Never merge automatically or release to production without a later explicit instruction from the user.
- Add screenshots to PR descriptions whenever possible, using fictitious local data and no production credentials or room codes.
