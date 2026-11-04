# Contexto de produto

Registo do brainstorming de 4 de novembro de 2026. O utilizador quer continuar o desenvolvimento numa conversa limpa, preservando este contexto. Não existe ainda uma especificação fechada. As decisões posteriores, incluindo aplicação funcional, acesso de sala e publicação em produção, estão em `docs/decisoes.md`; esse registo prevalece nos pontos expressamente confirmados, sem transformar as restantes sugestões deste brainstorming em requisitos.

## Problema e propósito

Criar uma forma de propor, discutir e votar em assembleias populares, como alternativa à contagem de braços levantados. O contexto inicial são as acampadas em Lisboa e no Porto. A ferramenta deve apoiar a deliberação coletiva e a confiança nas decisões.

Definição de trabalho: uma assembleia popular é um espaço de participação coletiva em que pessoas de uma comunidade discutem assuntos comuns, apresentam propostas e tomam decisões segundo regras conhecidas e aceites por quem participa. A votação é uma parte desse processo.

## Pedidos e prioridades expressos pelo utilizador

- Submeter propostas.
- Explorar um mecanismo de ordenar propostas pelas mais apoiadas pelos participantes. O algoritmo e o formato ainda não estão definidos.
- Impedir que uma pessoa vote como se fossem duas, preservando a sua privacidade.
- Ter uma mesa ou pessoas da organização com capacidade para abrir e fechar votações por proposta.
- Participação inicialmente presencial. O utilizador sugeriu que a mesa possa alternar entre presença física obrigatória e participação à distância.
- Privacidade fundamental: não guardar localização ou informação que identifique participantes; não criar rastreamento das pessoas. Deve haver um aviso público claro que corresponda ao funcionamento real do sistema.
- O utilizador sugeriu localização do dispositivo para validar presença, mas não foi escolhido um mecanismo.

## Sugestões discutidas, ainda não aprovadas como regras definitivas

- Distinguir os momentos de propor, apoiar a discussão e decidir por votação.
- Modalidade de participação visível e anunciada antes das votações; não permitir mudanças com uma votação em curso; registar alterações das regras sem identificar participantes.
- Fixar a versão da proposta e as regras antes de abrir uma votação.
- Explorar credenciais anónimas distribuídas presencialmente pela mesa como alternativa à geolocalização.
- Estudar uma consulta de localização pontual, consentida e processada no dispositivo, sem enviar coordenadas ao servidor nem as guardar. Isto continua a significar acesso à localização no dispositivo e não oferece prova robusta de presença por si só.
- Considerar a presença válida por sessão ou exigir confirmação por votação. Nenhuma destas opções foi escolhida pelo utilizador.

## Privacidade e integridade: questões a resolver

A aplicação não deve construir uma relação entre uma pessoa, a sua presença e as suas escolhas. Mesmo um código sem nome pode permitir ligar votos entre si, se for reutilizado ou cruzado com horários e registos técnicos. Separar elegibilidade, prevenção de reutilização e conteúdo dos votos exige desenho e validação próprios.

Geolocalização do navegador pode ser simulada e não resolve a duplicação por vários dispositivos. Um QR code público ou partilhável também não demonstra, sozinho, presença ou unicidade. Credenciais anónimas não garantem automaticamente uma pessoa, um voto; é necessário definir emissão, utilização, perda, partilha e proteção contra correlação.

O requisito de privacidade abrange armazenamento, logs de acesso e de erros, cópias de segurança, fornecedores, recursos externos, rede e informação pública. Não prometer ausência absoluta de rastos na Internet. Explicar os limites e verificar quais garantias a implementação oferece.

Se o utilizador exigir que a localização nunca seja sequer processada pela aplicação, a geolocalização é incompatível com essa exigência. Ainda é necessário esclarecer esta fronteira antes de usar dados reais.

Propostas e comentários podem conter informação identificável escrita pelos próprios participantes; desenhar uma forma de minimizar esse risco sem alegar que texto livre pode ser tornado automaticamente anónimo.

## Referência: Acampada Pixel

- Site: https://acampadapixel.pt/
- Repositório público: https://github.com/rujopereiric/acampada
- Ligação ao domínio confirmada em: https://github.com/rujopereiric/acampada/blob/main/CNAME
- Documentação do servidor: https://github.com/rujopereiric/acampada/blob/main/servidor/README.md

Foi consultado o site e examinado código público do cliente e servidor. A referência tem identidade de cartaz e pixel art, uma praça multijogador, gestão pela organização e pequenas votações sobre personagens do jogo. Não foi encontrado um processo de propostas e deliberação para decisões reais no código examinado.

Não foi encontrada uma licença explícita no repositório consultado. Código público não significa automaticamente permissão de reutilização. Usar a referência como inspiração visual e de experiência, sem copiar recursos.

## Decisões em aberto

- Nome definitivo e identidade própria.
- Como comprovar presença e emitir uma única autorização por pessoa sem a identificar.
- Se será permitido processamento transitório de localização no dispositivo.
- Presença por sessão ou por votação; exceções quando a localização falha ou alguém não tem telemóvel.
- Critérios de participação à distância, caso essa modalidade seja ativada.
- Regras para ordenar propostas, evitando que só propostas antigas ou populares sejam vistas.
- Opções de voto, abstenção, quórum, maiorias, alterações de voto, publicação de resultados e conservação de dados de auditoria.
- Atribuições da mesa, controlo de poderes, registo de ações e proteção contra manipulação pela própria organização.
- Arquitetura, tecnologias, alojamento, retenção de dados e modelo de confiança.

## Primeiro marco proposto

Um protótipo local para experimentar o percurso completo: consultar e submeter propostas, apoiar propostas para discussão, simular validação de presença, abrir uma votação na vista da mesa, votar e consultar o resultado após o fecho.

Usar apenas dados fictícios. A modalidade de participação e a validação são simulações identificadas. Não recolher localização, criar identidades reais, adotar serviços de autenticação ou disponibilizar o protótipo para decisões reais sem resolver os requisitos de privacidade e integridade.
