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
| Contexto longo (1940 →) | ERA5/Copernicus via Open-Meteo Archive — camada separada, nunca misturada dia a dia |

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

No mesmo período (2001–2025), o ERA5 mede **+0,27 °C/década** para a região no
entorno, contra **+0,52** da estação dentro da cidade: o termômetro urbano
aquece ~1,9× mais rápido. Os dois lados usam sempre os **mesmos anos** — medir
a cidade em 25 anos contra a região em 86 exageraria a diferença. Olhando bem
mais para trás, a máxima do ponto de Brasília subiu **+1,0 °C** de 1940–1969
para 2016–2025.

Dia mais quente, noite parecida e ar mais seco é a assinatura de um clima que
aquece *e* resseca — aqui se somam o aquecimento global e a mudança no uso do
solo do Cerrado. Uma estação sozinha não prova o efeito estufa; ela mostra como
ele chega até Brasília. O site diz isso com essas palavras, de propósito.

## Estrutura

```
importar_inmet.py     baixa os ZIPs do INMET, agrega por dia, gera o CSV
gerar_json.py         transforma o CSV em site/dados/serie.json (o que o site lê)
gerar_era5.py         baixa o ERA5 (1940 →) e gera site/dados/era5.json
carregar_supabase.py  opcional: sobe o CSV para o Supabase, se quiser uma API
supabase/migrations/  o schema, em ordem
site/                 o site estático (é o que a Vercel publica)
```

## Rodar a importação

```bash
python importar_inmet.py 2025           # um ano
python importar_inmet.py 2000 2026      # a série inteira (~2,4 GB de download)
```

O resultado vai para `dados/clima_diario.csv`, que **não** é versionado.

Depois, gere o arquivo que o site consome:

```bash
python gerar_json.py
```

## Por que arquivo estático e não banco

A série muda uma vez por ano e o site só lê. Servir isso de um banco custaria
uma chamada de rede a cada visita e uma dependência viva para um site de aula.
O `serie.json` tem 389 KB, viaja comprimido em ~97 KB, cai no CDN da Vercel e
chega em uma requisição. Só o dia de hoje é buscado ao vivo, na Open-Meteo.

## Banco (opcional)

O schema `clima` existe no Supabase (tabela `clima_diario`, view `resumo_anual`),
separado das tabelas do site principal, que dividem o mesmo projeto. Duas views
somente leitura em `public` servem de vitrine para a API REST. RLS ligada:
leitura pública, escrita apenas pelo *service role*.

Isso **não** é usado pelo site — fica de pé para quem quiser consultar a série
por API. Para popular, copie `.env.exemplo` para `.env`, preencha a
`SUPABASE_SERVICE_ROLE_KEY` e rode `python carregar_supabase.py`.

## Atualizar a série

O INMET republica o ano corrente periodicamente. Para atualizar:

```bash
rm dados/2026.zip
python importar_inmet.py 2000 2026 && python gerar_json.py && python gerar_era5.py
```

Depois é só commitar o `site/dados/serie.json` — a Vercel republica sozinha.
