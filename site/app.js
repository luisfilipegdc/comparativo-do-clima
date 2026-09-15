/* Clima Brasilia - hoje x passado.
   HTML + JS puro. Le o historico do Supabase (schema clima, so leitura) e o
   dia de hoje da Open-Meteo. Nenhuma chave secreta aqui: a publishable key
   so enxerga o que a RLS libera. */

const CONFIG = {
  supabaseUrl: "https://frsidsdrexolvcfxzroe.supabase.co",
  supabaseKey: "sb_publishable_xgr6ki59dLrTcdjDlmEtZA_LAF6m1BC",
  lat: -15.78,
  lon: -47.93,
  fuso: "America/Sao_Paulo",
  anoInicial: 2000,
  anosAtras: [1, 5, 10, 20],   // os cartoes de comparacao
  janela: 3,                   // dias de tolerancia quando falta o dia exato
};

/* ---------------------------------------------------------------- utilidades */

const $ = (sel) => document.querySelector(sel);

const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Data de hoje no fuso de Brasilia, e nao no fuso do aparelho do visitante. */
function hojeLocal() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.fuso, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return partes; // "2026-09-15"
}

function iso(ano, mes, dia) {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Soma dias a uma data ISO sem cair em armadilha de fuso. */
function somarDias(data, n) {
  const d = new Date(data + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function porExtenso(data) {
  const [a, m, d] = data.split("-").map(Number);
  return `${d} de ${NOMES_MES[m - 1]} de ${a}`;
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Numero no padrao brasileiro: 23.4 -> "23,4". */
function br(valor, casas = 1) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas, maximumFractionDigits: casas,
  });
}

/** Diferenca com sinal explicito: +3,2 / −1,4 (menos tipografico, nao hifen). */
function comSinal(valor, casas = 1) {
  if (valor === null || Number.isNaN(valor)) return "—";
  const s = br(Math.abs(valor), casas);
  if (Math.abs(valor) < 0.05) return "igual";
  return (valor > 0 ? "+" : "−") + s;
}

/* ------------------------------------------------------------------- dados */

async function doSupabase(recurso, parametros) {
  const url = `${CONFIG.supabaseUrl}/rest/v1/${recurso}?${parametros}`;
  const resposta = await fetch(url, {
    headers: {
      apikey: CONFIG.supabaseKey,
      Authorization: `Bearer ${CONFIG.supabaseKey}`,
    },
  });
  if (!resposta.ok) {
    const texto = await resposta.text();
    throw new Error(`Supabase ${resposta.status}: ${texto}`);
  }
  return resposta.json();
}

/** Todos os dias da serie que caem na janela em torno deste dia do ano. */
async function buscarMesmoDia(hoje) {
  const [, mes, dia] = hoje.split("-").map(Number);
  const anoAtual = Number(hoje.slice(0, 4));
  const datas = [];
  for (let ano = CONFIG.anoInicial; ano <= anoAtual; ano++) {
    // conta a partir do dia 1 do mes: um 29/02 em ano comum vira 01/03
    // em vez de virar uma data invalida que o banco ignoraria.
    const alvo = somarDias(iso(ano, mes, 1), dia - 1);
    for (let desvio = -CONFIG.janela; desvio <= CONFIG.janela; desvio++) {
      datas.push(somarDias(alvo, desvio));
    }
  }
  const lista = [...new Set(datas)].join(",");
  return doSupabase("clima_diario", `select=*&data=in.(${lista})&order=data.asc`);
}

async function buscarResumoAnual() {
  return doSupabase("resumo_anual", "select=*&order=ano.asc");
}

/** Hoje vem da Open-Meteo: o INMET publica o ano corrente com semanas de atraso. */
async function buscarHoje() {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}`
    + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
    + "&hourly=relative_humidity_2m"
    + "&current=temperature_2m,relative_humidity_2m"
    + `&timezone=${encodeURIComponent(CONFIG.fuso)}&forecast_days=1`;
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Open-Meteo ${resposta.status}`);
  const dados = await resposta.json();

  const umidades = (dados.hourly?.relative_humidity_2m || []).filter((v) => v !== null);
  const umidadeMedia = umidades.length
    ? umidades.reduce((a, b) => a + b, 0) / umidades.length : null;

  return {
    data: dados.daily.time[0],
    temp_max: dados.daily.temperature_2m_max[0],
    temp_min: dados.daily.temperature_2m_min[0],
    chuva_mm: dados.daily.precipitation_sum[0],
    umidade_media: umidadeMedia,
    umidade_min: umidades.length ? Math.min(...umidades) : null,
    agora: dados.current?.temperature_2m ?? null,
    umidade_agora: dados.current?.relative_humidity_2m ?? null,
    fonte: "open_meteo",
  };
}

/** O dia pedido, ou o valido mais proximo dentro da janela. */
function escolherDia(linhas, alvo) {
  const exato = linhas.find((l) => l.data === alvo && num(l.temp_max) !== null);
  if (exato) return { linha: exato, desvio: 0 };

  for (let d = 1; d <= CONFIG.janela; d++) {
    for (const lado of [-d, d]) {
      const candidato = linhas.find(
        (l) => l.data === somarDias(alvo, lado) && num(l.temp_max) !== null);
      if (candidato) return { linha: candidato, desvio: lado };
    }
  }
  return null;
}

/* ----------------------------------------------------------------- desenho */

function cartaoHoje(hoje) {
  const agora = hoje.agora !== null
    ? `<p class="quando">Agora: ${br(hoje.agora)} °C · ${br(hoje.umidade_agora, 0)}% de umidade</p>`
    : "";
  return `
    ${agora}
    <p class="temp-grande">${br(hoje.temp_max)}<span class="unidade"> °C</span></p>
    <p class="data-cheia">máxima prevista para ${porExtenso(hoje.data)}</p>
    <ul class="linhas">
      <li><span class="chave">Mínima</span><span>${br(hoje.temp_min)} °C</span></li>
      <li><span class="chave">Umidade média</span><span>${br(hoje.umidade_media, 0)}%</span></li>
      <li><span class="chave">Chuva</span><span>${br(hoje.chuva_mm)} mm</span></li>
    </ul>
    <p class="nota">Hoje vem da Open-Meteo. O INMET publica os dados da A001 com semanas de atraso.</p>`;
}

function cartaoPassado(anosAtras, achado, hoje) {
  if (!achado) {
    return `<article class="cartao">
      <p class="quando">${anosAtras} ${anosAtras === 1 ? "ano" : "anos"} atrás</p>
      <p class="temp">—</p>
      <p class="data-cheia">sem dado na série para esta data</p>
    </article>`;
  }

  const l = achado.linha;
  const difMax = num(l.temp_max) !== null && hoje.temp_max !== null
    ? hoje.temp_max - num(l.temp_max) : null;
  const difUmid = num(l.umidade_media) !== null && hoje.umidade_media !== null
    ? hoje.umidade_media - num(l.umidade_media) : null;

  const classe = difMax === null ? "igual" : difMax > 0.05 ? "sobe" : difMax < -0.05 ? "desce" : "igual";
  const texto = difMax === null ? ""
    : difMax > 0.05 ? `hoje está ${comSinal(difMax)} °C mais quente`
    : difMax < -0.05 ? `hoje está ${br(Math.abs(difMax))} °C mais frio`
    : "praticamente igual a hoje";

  const aviso = achado.desvio !== 0
    ? `<p class="data-cheia">sem dado no dia exato; usando ${Math.abs(achado.desvio)} dia${Math.abs(achado.desvio) > 1 ? "s" : ""} ${achado.desvio < 0 ? "antes" : "depois"}</p>`
    : "";

  const seloFonte = l.fonte === "open_meteo"
    ? '<span class="selo selo-fonte">dado de reserva</span>' : "";

  return `<article class="cartao">
    <p class="quando">${anosAtras} ${anosAtras === 1 ? "ano" : "anos"} atrás</p>
    ${seloFonte}
    <p class="temp">${br(num(l.temp_max))}<span class="unidade"> °C</span></p>
    <p class="data-cheia">${porExtenso(l.data)}</p>
    ${aviso}
    <p class="dif ${classe}">${texto}</p>
    <ul class="linhas">
      <li><span class="chave">Mínima</span><span>${br(num(l.temp_min))} °C</span></li>
      <li><span class="chave">Umidade</span><span>${br(num(l.umidade_media), 0)}%${
        difUmid !== null ? ` <small>(${comSinal(difUmid, 0)} p.p.)</small>` : ""}</span></li>
      <li><span class="chave">Chuva</span><span>${br(num(l.chuva_mm))} mm</span></li>
    </ul>
  </article>`;
}

/** Barras da maxima deste dia em todos os anos, com hoje destacado. */
function graficoSerie(pontos, hoje) {
  if (!pontos.length) return "<p class='carregando'>Sem série para este dia.</p>";

  const larguraBarra = 18, espaco = 4, alturaUtil = 150, margemBaixo = 26, margemEsq = 30;
  const largura = margemEsq + pontos.length * (larguraBarra + espaco) + 8;
  const altura = alturaUtil + margemBaixo + 12;

  const valores = pontos.map((p) => p.valor).concat(hoje.temp_max ?? []);
  const minimo = Math.floor(Math.min(...valores) - 1);
  const maximo = Math.ceil(Math.max(...valores) + 1);
  const escala = (v) => alturaUtil - ((v - minimo) / (maximo - minimo)) * alturaUtil + 10;

  const barras = pontos.map((p, i) => {
    const x = margemEsq + i * (larguraBarra + espaco);
    const y = escala(p.valor);
    const classe = p.ehHoje ? "g-barra-hoje" : p.valor > 30 ? "g-barra-quente" : "g-barra";
    const rotulo = (p.ano % 5 === 0 || p.ehHoje)
      ? `<text class="g-rotulo" x="${x + larguraBarra / 2}" y="${alturaUtil + 24}" text-anchor="middle">${p.ehHoje ? "hoje" : p.ano}</text>`
      : "";
    return `<rect class="${classe}" x="${x}" y="${y}" width="${larguraBarra}" height="${alturaUtil + 10 - y}" rx="2">
        <title>${p.ano}: ${br(p.valor)} °C</title></rect>${rotulo}`;
  }).join("");

  const grade = [minimo, Math.round((minimo + maximo) / 2), maximo].map((v) =>
    `<line class="g-eixo" x1="${margemEsq}" y1="${escala(v)}" x2="${largura}" y2="${escala(v)}"></line>
     <text class="g-rotulo" x="0" y="${escala(v) + 3}">${v}°</text>`).join("");

  return `<svg viewBox="0 0 ${largura} ${altura}" role="img"
     aria-label="Máxima deste dia do ano em cada ano desde ${pontos[0].ano}">
     ${grade}${barras}</svg>`;
}

/** Barras de contagem por ano (dias acima de 30 graus) com reta de tendencia. */
function graficoAnual(dados, campo, rotuloAria, destacarAcima) {
  const pontos = dados.filter((d) => d.dias >= 300);
  if (!pontos.length) return "<p class='carregando'>Sem dados suficientes.</p>";

  const larguraBarra = 16, espaco = 4, alturaUtil = 140, margemBaixo = 26, margemEsq = 30;
  const largura = margemEsq + pontos.length * (larguraBarra + espaco) + 8;
  const altura = alturaUtil + margemBaixo + 12;

  const valores = pontos.map((p) => Number(p[campo]));
  const minimo = Math.min(0, Math.floor(Math.min(...valores)));
  const maximo = Math.ceil(Math.max(...valores) * 1.05);
  const escala = (v) => alturaUtil - ((v - minimo) / (maximo - minimo)) * alturaUtil + 10;

  const barras = pontos.map((p, i) => {
    const v = Number(p[campo]);
    const x = margemEsq + i * (larguraBarra + espaco);
    const y = escala(v);
    const classe = destacarAcima && v > destacarAcima ? "g-barra-quente" : "g-barra";
    const rotulo = p.ano % 5 === 0
      ? `<text class="g-rotulo" x="${x + larguraBarra / 2}" y="${alturaUtil + 24}" text-anchor="middle">${p.ano}</text>`
      : "";
    return `<rect class="${classe}" x="${x}" y="${y}" width="${larguraBarra}" height="${alturaUtil + 10 - y}" rx="2">
        <title>${p.ano}: ${br(v, campo === "umidade_media" ? 1 : 0)}</title></rect>${rotulo}`;
  }).join("");

  // reta de tendencia (minimos quadrados) sobre os anos completos.
  // Com menos de tres anos nao ha tendencia: a divisao daria NaN e o SVG quebra.
  const linha = pontos.length < 3 ? "" : retaTendencia(pontos, valores, {
    margemEsq, larguraBarra, espaco, escala,
  });

  const grade = [minimo, maximo].map((v) =>
    `<line class="g-eixo" x1="${margemEsq}" y1="${escala(v)}" x2="${largura}" y2="${escala(v)}"></line>
     <text class="g-rotulo" x="0" y="${escala(v) + 3}">${br(v, 0)}</text>`).join("");

  return `<svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="${rotuloAria}">
     ${grade}${barras}${linha}</svg>`;
}

function retaTendencia(pontos, valores, g) {
  const xs = pontos.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = valores.reduce((a, b) => a + b, 0) / valores.length;
  const inclin = xs.reduce((s, x, i) => s + (x - mx) * (valores[i] - my), 0)
    / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const y0 = my + inclin * (0 - mx), y1 = my + inclin * (xs.length - 1 - mx);
  return `<line class="g-tendencia"
     x1="${g.margemEsq + g.larguraBarra / 2}" y1="${g.escala(y0)}"
     x2="${g.margemEsq + (xs.length - 1) * (g.larguraBarra + g.espaco) + g.larguraBarra / 2}" y2="${g.escala(y1)}"></line>`;
}

/** Inclinacao por decada de uma serie anual. */
function tendenciaPorDecada(dados, campo) {
  const pontos = dados.filter((d) => d.dias >= 300);
  if (pontos.length < 5) return null;
  const xs = pontos.map((p) => p.ano);
  const ys = pontos.map((p) => Number(p[campo]));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const inclin = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
    / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return inclin * 10;
}

function blocoTendencias(resumo) {
  const itens = [
    { campo: "temp_max_media", nome: "máxima", unidade: " °C", casas: 2 },
    { campo: "temp_min_media", nome: "mínima (noites)", unidade: " °C", casas: 2 },
    { campo: "dias_acima_30", nome: "dias acima de 30 °C", unidade: " dias", casas: 0 },
    { campo: "umidade_media", nome: "umidade do ar", unidade: " p.p.", casas: 2 },
  ];
  return itens.map((it) => {
    const v = tendenciaPorDecada(resumo, it.campo);
    const classe = v === null ? "parado" : v > 0.1 ? "sobe" : v < -0.1 ? "desce" : "parado";
    return `<div class="tend ${classe}">
      <span class="valor">${comSinal(v, it.casas)}${it.unidade}</span>
      <span class="nome">${it.nome}, por década</span>
    </div>`;
  }).join("");
}

/** O texto de leitura muda conforme o dado - nao e uma conclusao fixa no HTML. */
function leituraHonesta(resumo) {
  const completos = resumo.filter((d) => d.dias >= 300);
  if (completos.length < 10) return "";

  const metade = Math.floor(completos.length / 2);
  const antes = completos.slice(0, metade);
  const depois = completos.slice(-metade);
  const med = (lista, campo) => lista.reduce((s, d) => s + Number(d[campo]), 0) / lista.length;

  const q1 = med(antes, "dias_acima_30"), q2 = med(depois, "dias_acima_30");
  const tMax = tendenciaPorDecada(resumo, "temp_max_media");
  const tMin = tendenciaPorDecada(resumo, "temp_min_media");
  const tUmi = tendenciaPorDecada(resumo, "umidade_media");

  const noites = Math.abs(tMin) < 0.15
    ? "As noites, porém, quase não mudaram."
    : tMin > 0 ? "As noites também esquentaram." : "As noites, curiosamente, esfriaram um pouco.";

  return `
    <p>Entre ${antes[0].ano}–${antes[antes.length - 1].ano} e ${depois[0].ano}–${depois[depois.length - 1].ano},
    os dias acima de 30 °C em Brasília passaram de <strong>${br(q1, 0)} por ano</strong>
    para <strong>${br(q2, 0)} por ano</strong>.</p>
    <p>A máxima subiu <strong>${comSinal(tMax, 2)} °C por década</strong>. ${noites}
    E o ar ficou mais seco: <strong>${comSinal(tUmi, 2)} ponto percentual de umidade por década</strong>.</p>
    <p>Dia mais quente, noite parecida e ar mais seco é a marca de um clima que aquece
    <em>e</em> resseca ao mesmo tempo — aqui se misturam o aquecimento global e a mudança
    no uso do solo do Cerrado. Uma estação sozinha não prova o efeito estufa; ela mostra
    como ele chega até aqui. O planeta, medido por milhares de estações, aqueceu cerca de
    1,3 °C desde o século XIX.</p>`;
}

/* -------------------------------------------------------------------- selos */

function selosDeRecorde(hoje, serieDoDia) {
  const selos = [];
  const maximas = serieDoDia.filter((p) => !p.ehHoje).map((p) => p.valor);
  if (maximas.length >= 10 && hoje.temp_max !== null) {
    if (hoje.temp_max > Math.max(...maximas)) {
      selos.push('<span class="selo selo-quente">recorde de calor para este dia</span>');
    } else if (hoje.temp_max < Math.min(...maximas)) {
      selos.push('<span class="selo selo-frio">dia mais ameno da série</span>');
    }
  }
  return selos.join(" ");
}

/* ------------------------------------------------------------------ montagem */

async function main() {
  const hojeISO = hojeLocal();
  $("#subtitulo").textContent = `Hoje é ${porExtenso(hojeISO)} em Brasília.`;

  let hoje, linhas, resumo;
  try {
    [hoje, linhas, resumo] = await Promise.all([
      buscarHoje(), buscarMesmoDia(hojeISO), buscarResumoAnual(),
    ]);
  } catch (erro) {
    $("#cartao-hoje").innerHTML =
      `<div class="erro"><strong>Não consegui carregar os dados.</strong><br>${erro.message}</div>`;
    return;
  }

  // serie do mesmo dia, ano a ano
  const anoAtual = Number(hojeISO.slice(0, 4));
  const [, mes, dia] = hojeISO.split("-").map(Number);
  const pontos = [];
  for (let ano = CONFIG.anoInicial; ano < anoAtual; ano++) {
    const achado = escolherDia(linhas, iso(ano, mes, dia));
    if (achado) pontos.push({ ano, valor: num(achado.linha.temp_max), ehHoje: false });
  }
  if (hoje.temp_max !== null) pontos.push({ ano: anoAtual, valor: hoje.temp_max, ehHoje: true });

  // cartoes
  $("#cartao-hoje").innerHTML = selosDeRecorde(hoje, pontos) + cartaoHoje(hoje);

  let houveAproximacao = false;
  $("#cartoes-passado").innerHTML = CONFIG.anosAtras.map((n) => {
    const achado = escolherDia(linhas, iso(anoAtual - n, mes, dia));
    if (achado && achado.desvio !== 0) houveAproximacao = true;
    return cartaoPassado(n, achado, hoje);
  }).join("");

  if (houveAproximacao) {
    const nota = $("#nota-aproximacao");
    nota.hidden = false;
    nota.textContent = "Em algum dos anos a estação não registrou este dia exato. "
      + "Nesse caso usei o dia válido mais próximo, dentro de três dias, e avisei no cartão.";
  }

  // graficos e tendencias
  $("#grafico-serie").innerHTML = graficoSerie(pontos, hoje);
  $("#tendencias").innerHTML = blocoTendencias(resumo);
  $("#grafico-quentes").innerHTML =
    graficoAnual(resumo, "dias_acima_30", "Dias acima de 30 graus por ano", 60);
  $("#grafico-umidade").innerHTML =
    graficoAnual(resumo, "umidade_media", "Umidade média do ar por ano", null);
  $("#leitura-honesta").innerHTML = leituraHonesta(resumo);
}

main();
