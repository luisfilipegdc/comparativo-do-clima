# Clima de Brasília — hoje × passado

Site de uma página que compara a temperatura de **hoje** em Brasília com o
**mesmo dia** há 1, 5, 10 e 20 anos, e mostra o que mudou no clima da cidade
desde 2000.

Feito para aula: HTML e JavaScript puros, sem framework e sem dependência
externa. Os gráficos são SVG gerado à mão.

## Fontes

| Dado | De onde vem |
|---|---|
| Série histórica (2000 → hoje) | INMET, estação automática **A001** (Brasília) |
| Dia de hoje | Open-Meteo (o INMET publica o ano corrente com semanas de atraso) |
| Dias sem leitura da A001 | Open-Meteo Archive, marcados como *dado de reserva* na tela |

## O que a série mostra (2001–2025)

| Indicador | Tendência por década |
|---|---|
| Máxima | **+0,52 °C** |
| Média | +0,24 °C |
| Mínima (noites) | −0,08 °C — sem aquecimento |
| Dias acima de 30 °C | **+21 dias** |
| Umidade média | −0,66 p.p. |

Os dias acima de 30 °C **dobraram**: de 29 por ano nos anos 2000 para 57 por
ano na última década.

Dia mais quente, noite parecida e ar mais seco é a assinatura de um clima que
aquece *e* resseca — aqui se somam o aquecimento global e a mudança no uso do
solo do Cerrado. Uma estação sozinha não prova o efeito estufa; ela mostra como
ele chega até Brasília. O site diz isso com essas palavras, de propósito.

## Estrutura

```
importar_inmet.py     baixa os ZIPs do INMET, agrega por dia, gera o CSV
carregar_supabase.py  sobe o CSV para o Supabase (upsert por data)
supabase/migrations/  o schema, em ordem
site/                 o site estático (é o que a Vercel publica)
```

## Rodar a importação

```bash
python importar_inmet.py 2025           # um ano
python importar_inmet.py 2000 2026      # a série inteira (~2,4 GB de download)
```

O resultado vai para `dados/clima_diario.csv`, que **não** é versionado.

Para subir ao banco, copie `.env.exemplo` para `.env`, preencha a
`SUPABASE_SERVICE_ROLE_KEY` e rode:

```bash
python carregar_supabase.py
```

## Banco

Os dados moram no schema `clima` (tabela `clima_diario` e view `resumo_anual`),
separados das tabelas do site principal, que dividem o mesmo projeto Supabase.
Duas views somente leitura em `public` servem de vitrine para a API REST.

RLS ligada: leitura pública, escrita apenas pelo *service role*. No front só
entra a *publishable key* — ela lê o que a RLS permitir e não grava nada.

## Atualizar a série

O INMET republica o ano corrente periodicamente. Para atualizar:

```bash
rm dados/2026.zip
python importar_inmet.py 2026 && python carregar_supabase.py
```

O upsert é por data, então rodar de novo não duplica nada.
