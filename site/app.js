/* Clima Brasilia - hoje x passado.
   HTML + JS puro. Le o historico do Supabase (schema clima, so leitura) e o
   dia de hoje da Open-Meteo. Nenhuma chave secreta aqui: a publishable key
   so enxerga o que a RLS libera. */

const CONFIG = {
  // A serie historica muda uma vez por ano: e um arquivo, nao uma consulta.
  // Publicado junto com o site, cai no CDN e chega em uma requisicao so.
  serie: "dados/serie.json",
  era5: "dados/era5.json",     // contexto longo: 1940 em diante
  lat: -15.78,
  lon: -47.93,
  fuso: "America/Sao_Paulo",
  anoInicial: 2000,
  // Do maior contraste para o menor: um ano de diferenca e ruido do tempo e
  // sempre parece "igual"; vinte anos e onde a mudanca aparece. Abrir pelo
  // cartao de 1 ano fazia a pagina comecar provando que nada mudou.
  anosAtras: [20, 10, 5, 1],
  janelaMedia: 5,              // media movel para suavizar ano atipico
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

/** Baixa a serie inteira (uma vez) e devolve os dias como objetos. */
async function buscarSerie() {
  const resposta = await fetch(CONFIG.serie, { cache: "default" });
  if (!resposta.ok) throw new Error(`Série histórica ${resposta.status}`);
  const bruto = await resposta.json();
  // as linhas vem como arrays para o arquivo nao repetir o nome do campo
  // 9.558 vezes; aqui voltam a ser objetos, que e o que o resto do codigo usa.
  const dias = bruto.dias.map((linha) => {
    const d = {};
    bruto.campos.forEach((campo, i) => { d[campo] = linha[i]; });
    d.fonte = "inmet_a001";
    return d;
  });
  return { dias, resumo: bruto.resumo };
}

/** Os dias da serie na janela em torno deste dia do ano, em todos os anos. */
function mesmoDia(dias, hoje) {
  const [, mes, dia] = hoje.split("-").map(Number);
  const anoAtual = Number(hoje.slice(0, 4));
  const alvos = new Set();
  for (let ano = CONFIG.anoInicial; ano <= anoAtual; ano++) {
    // conta a partir do dia 1 do mes: um 29/02 em ano comum vira 01/03
    // em vez de virar uma data que nao existe na serie.
    const alvo = somarDias(iso(ano, mes, 1), dia - 1);
    for (let desvio = -CONFIG.janela; desvio <= CONFIG.janela; desvio++) {
      alvos.add(somarDias(alvo, desvio));
    }
  }
  return dias.filter((d) => alvos.has(d.data));
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

function cartaoPassado(anosAtras, achado, hoje, serieCarregada) {
  if (!achado) {
    // "sem dado" faz o aluno concluir que o site quebrou, e essa e a impressao
    // que fica. O estado vazio precisa dizer o que de fato esta acontecendo.
    const explicacao = serieCarregada
      ? "A estação não mediu neste dia"
      : "Série histórica ainda sendo carregada no banco";
    return `<article class="cartao">
      <p class="quando">${anosAtras} ${anosAtras === 1 ? "ano" : "anos"} atrás</p>
      <p class="temp">—</p>
      <p class="data-cheia">${explicacao}</p>
    </article>`;
  }

  const l = achado.linha;
  const difMax = num(l.temp_max) !== null && hoje.temp_max !== null
    ? hoje.temp_max - num(l.temp_max) : null;
  const difUmid = num(l.umidade_media) !== null && hoje.umidade_media !== null
    ? hoje.umidade_media - num(l.umidade_media) : null;

  const classe = difMax === null ? "igual" : difMax > 0.05 ? "sobe" : difMax < -0.05 ? "desce" : "igual";
  // a palavra "quente"/"frio" ja diz a direcao; o sinal so aparecia num dos
  // lados e parecia erro de digitacao
  const texto = difMax === null ? ""
    : difMax > 0.05 ? `hoje está ${br(difMax)} °C mais quente`
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

/** Media de um campo nos primeiros e nos ultimos anos completos da serie. */
function extremos(resumo, campo) {
  const completos = resumo.filter((d) => d.dias >= 300);
  if (completos.length < 6) return null;
  const n = Math.min(10, Math.floor(completos.length / 2));
  const med = (lista) => lista.reduce((s, d) => s + Number(d[campo]), 0) / lista.length;
  const antes = completos.slice(0, n), depois = completos.slice(-n);
  return {
    antes: med(antes), depois: med(depois),
    anoIni: antes[0].ano, anoFimIni: antes[n - 1].ano,
    anoFin: depois[0].ano, anoFimFin: depois[n - 1].ano,
  };
}

/** "p.p. por decada" nao chega no corpo de ninguem. A traducao vem primeiro. */
function blocoTendencias(resumo) {
  const dias = extremos(resumo, "dias_acima_30");
  // "1,0 para 1,9 meses" e numero quebrado numa frase que pede arredondamento.
  // Se os dois lados arredondarem igual, o mes perde a graca e voltamos a dias.
  const m1 = dias ? Math.round(dias.antes / 30) : 0;
  const m2 = dias ? Math.round(dias.depois / 30) : 0;
  const emMeses = dias && m1 !== m2 && m1 >= 1;

  const itens = [
    {
      campo: "dias_acima_30", unidade: " dias", casas: 0, nome: "por década",
      traducao: !dias ? "Dias acima de 30 °C"
        : emMeses
          ? `De ${m1} para ${m2} ${m2 === 1 ? "mês" : "meses"} de calor por ano`
          : `De ${br(dias.antes, 0)} para ${br(dias.depois, 0)} dias de calor por ano`,
    },
    {
      campo: "temp_max_media", unidade: " °C", casas: 2, nome: "na máxima, por década",
      traducao: "Os dias esquentaram",
    },
    {
      campo: "temp_min_media", unidade: " °C", casas: 2, nome: "na mínima, por década",
      traducao: "As noites quase não mudaram",
    },
    {
      campo: "umidade_media", unidade: " p.p.", casas: 2, nome: "de umidade, por década",
      traducao: "O ar ficou mais seco",
    },
  ];

  return itens.map((it) => {
    const v = tendenciaPorDecada(resumo, it.campo);
    const classe = v === null ? "parado" : v > 0.1 ? "sobe" : v < -0.1 ? "desce" : "parado";
    // a frase das noites so vale enquanto o dado disser isso
    const traducao = it.campo === "temp_min_media" && v !== null && Math.abs(v) >= 0.15
      ? (v > 0 ? "As noites também esquentaram" : "As noites esfriaram um pouco")
      : it.traducao;
    return `<div class="tend ${classe}">
      <span class="traducao">${traducao}</span>
      <span class="valor">${comSinal(v, it.casas)}${it.unidade}</span>
      <span class="nome">${it.nome}</span>
    </div>`;
  }).join("");
}

/** A manchete: o achado que da sentido a pagina inteira, antes de tudo. */
function montarManchete(resumo) {
  const d = extremos(resumo, "dias_acima_30");
  if (!d || d.depois <= d.antes) return false;
  $("#manchete-frase").innerHTML =
    `Brasília tinha <b>${br(d.antes, 0)} dias de calor</b> por ano. Hoje tem <b>${br(d.depois, 0)}</b>.`;
  $("#manchete-fonte").textContent =
    `Dias acima de 30 °C: média de ${d.anoIni}–${d.anoFimIni} contra ${d.anoFin}–${d.anoFimFin}, estação A001 do INMET.`;
  $("#manchete").hidden = false;
  return true;
}

/** Media movel de janelaMedia anos em torno de um ano - um ano so e ruidoso. */
function mediaEmTorno(resumo, ano, campo) {
  const metade = Math.floor(CONFIG.janelaMedia / 2);
  const perto = resumo.filter((d) => d.dias >= 300
    && d.ano >= ano - metade && d.ano <= ano + metade);
  if (!perto.length) return null;
  return perto.reduce((s, d) => s + Number(d[campo]), 0) / perto.length;
}

/** O aluno escolhe o proprio ano: o que ele gera, ele lembra. */
function ligarGeracao(resumo) {
  const completos = resumo.filter((d) => d.dias >= 300);
  if (completos.length < 6) return;

  const primeiro = completos[0].ano, ultimo = completos[completos.length - 1].ano;
  const campo = $("#ano-nascimento"), resposta = $("#geracao-resposta");
  campo.min = primeiro;
  campo.max = ultimo;
  $("#geracao").hidden = false;

  function responder() {
    const ano = Number(campo.value);
    resposta.hidden = false;

    if (!ano || ano < primeiro || ano > ultimo) {
      resposta.innerHTML = `A série da estação A001 vai de <strong>${primeiro}</strong> a
        <strong>${ultimo}</strong>. Digite um ano desse intervalo.`;
      return;
    }

    const entao = mediaEmTorno(resumo, ano, "dias_acima_30");
    // "agora" sao os ultimos anos fechados, nao uma janela centrada no ultimo
    // (que so teria metade dos anos e nao bateria com o rotulo do texto).
    const recentes = completos.slice(-CONFIG.janelaMedia);
    const agora = recentes.reduce((s, d) => s + Number(d.dias_acima_30), 0) / recentes.length;
    if (entao === null) { resposta.hidden = true; return; }

    // As duas pontas usam a mesma janela de anos, e o texto diz qual e. Sem
    // isso a pagina parece se contradizer: a manchete compara decadas e daria
    // um "hoje" diferente do daqui.
    // arredonda antes de subtrair: senao a conta exibida (35 -> 63) nao fecha
    // com a diferenca exibida, e e a primeira coisa que um aluno confere.
    const metade = Math.floor(CONFIG.janelaMedia / 2);
    const de = Math.round(entao), para = Math.round(agora);
    const dif = para - de;
    const verbo = dif >= 0 ? "ganhou" : "perdeu";
    resposta.innerHTML = `Desde ${ano}, Brasília ${verbo}
      <strong>${Math.abs(dif)} dias de calor por ano</strong>.
      Por volta de ${ano} eram ${de} dias acima de 30 °C por ano; agora são ${para}.
      <span class="miudo">Comparação entre ${ano - metade}–${ano + metade} e
      ${recentes[0].ano}–${recentes[recentes.length - 1].ano}, para um ano atípico
      não distorcer a conta.</span>`;
  }

  $("#geracao-botao").addEventListener("click", responder);
  campo.addEventListener("keydown", (e) => { if (e.key === "Enter") responder(); });
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

/* ------------------------------------------------- quase um seculo (ERA5) */

/** Linha da maxima anual desde 1940, com media movel e reta de tendencia. */
function graficoSeculo(anos) {
  const largura = Math.max(320, anos.length * 4.2), alturaUtil = 130;
  const margemEsq = 30, margemBaixo = 24, altura = alturaUtil + margemBaixo + 14;

  const valores = anos.map((a) => a.temp_max_media);
  const minimo = Math.floor(Math.min(...valores) * 2) / 2 - 0.3;
  const maximo = Math.ceil(Math.max(...valores) * 2) / 2 + 0.3;
  const x = (i) => margemEsq + (i / (anos.length - 1)) * (largura - margemEsq - 6);
  const y = (v) => alturaUtil - ((v - minimo) / (maximo - minimo)) * alturaUtil + 10;

  const pontos = anos.map((a, i) => `${x(i).toFixed(1)},${y(a.temp_max_media).toFixed(1)}`);
  const linha = `<polyline class="g-linha-seculo" points="${pontos.join(" ")}"></polyline>`;
  const area = `<polygon class="g-area-seculo" points="${x(0)},${y(minimo)} ${pontos.join(" ")} ${x(anos.length - 1)},${y(minimo)}"></polygon>`;

  // reta de tendencia sobre a serie inteira
  const xs = anos.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = valores.reduce((a, b) => a + b, 0) / valores.length;
  const inclin = xs.reduce((s, v, i) => s + (v - mx) * (valores[i] - my), 0)
    / xs.reduce((s, v) => s + (v - mx) ** 2, 0);
  const tend = `<line class="g-tendencia" x1="${x(0)}" y1="${y(my + inclin * (0 - mx))}"
     x2="${x(anos.length - 1)}" y2="${y(my + inclin * (anos.length - 1 - mx))}"></line>`;

  const grade = [minimo, (minimo + maximo) / 2, maximo].map((v) =>
    `<line class="g-eixo" x1="${margemEsq}" y1="${y(v)}" x2="${largura}" y2="${y(v)}"></line>
     <text class="g-rotulo" x="0" y="${y(v) + 3}">${br(v, 1)}°</text>`).join("");

  const marcos = anos.map((a, i) => (a.ano % 20 === 0
    ? `<text class="g-rotulo" x="${x(i)}" y="${alturaUtil + 24}" text-anchor="middle">${a.ano}</text>`
    : "")).join("");

  return `<svg viewBox="0 0 ${largura} ${altura}" role="img"
     aria-label="Temperatura máxima média de cada ano em Brasília, de ${anos[0].ano} a ${anos[anos.length - 1].ano}">
     ${grade}${area}${linha}${tend}${marcos}</svg>`;
}

/** A faixa longa: contexto de 1940 e a diferenca entre a cidade e a regiao. */
function montarSeculo(era5, resumoInmet) {
  const anos = (era5?.resumo || []).filter((a) => a.dias >= 350);
  if (anos.length < 30) return;

  const n = 30;
  const med = (lista) => lista.reduce((s, a) => s + a.temp_max_media, 0) / lista.length;
  const antes = anos.slice(0, n), depois = anos.slice(-10);
  const salto = med(depois) - med(antes);

  $("#seculo-numero").innerHTML =
    `No ponto de Brasília, a máxima média subiu <strong>${comSinal(salto, 1)} °C</strong>
     entre ${antes[0].ano}–${antes[n - 1].ano} e ${depois[0].ano}–${depois[depois.length - 1].ano}.`;

  $("#grafico-seculo").innerHTML = graficoSeculo(anos);

  // A comparacao que da a aula. Os dois lados PRECISAM cobrir os mesmos anos:
  // medir a cidade em 25 anos contra a regiao em 86 exagera a diferenca,
  // porque a serie longa dilui a aceleracao recente.
  const inmetCompletos = resumoInmet.filter((d) => d.dias >= 300);
  const de = inmetCompletos[0].ano, ate = inmetCompletos[inmetCompletos.length - 1].ano;

  const regiaoMesmoPeriodo = anos
    .filter((a) => a.ano >= de && a.ano <= ate)
    .map((a) => ({ ...a, dias: 365 }));

  const tendRegiao = tendenciaPorDecada(regiaoMesmoPeriodo, "temp_max_media");
  const tendCidade = tendenciaPorDecada(resumoInmet, "temp_max_media");
  const vezes = tendRegiao > 0.01 ? tendCidade / tendRegiao : null;

  const comparacao = `
    <div class="comparacao">
      <div class="cidade">
        <span class="rotulo-linha">Estação na cidade</span>
        <b>${comSinal(tendCidade, 2)} °C/década</b>
      </div>
      <div>
        <span class="rotulo-linha">Região no entorno</span>
        <b>${comSinal(tendRegiao, 2)} °C/década</b>
      </div>
      <div>
        <span class="rotulo-linha">Período comparado</span>
        <b>${de}–${ate}</b>
      </div>
    </div>`;

  const quantas = vezes && vezes > 1.5
    ? `<p>O termômetro da cidade aquece <strong>${br(vezes, 1)} vezes mais rápido</strong>
       que a região em volta. A diferença não é erro: é <strong>Brasília crescendo em cima do
       termômetro</strong> — asfalto, concreto e menos vegetação seguram calor. O aquecimento
       global entra nas duas linhas; a cidade soma o dela por cima.</p>`
    : "";

  $("#seculo-leitura").innerHTML = comparacao + quantas + `
    <p class="miudo">O ERA5 é um modelo numa grade de ~30 km, não um termômetro no Plano
    Piloto. Nos ${br(era5.comparacao_inmet?.dias || 0, 0)} dias em que as duas fontes coexistem,
    ele marca a máxima ${br(Math.abs(era5.comparacao_inmet?.vies_temp_max || 0), 2)} °C mais baixa
    que a estação. Por isso as duas séries nunca se misturam dia a dia — cada número desta
    página diz de qual delas veio.</p>`;

  $("#seculo").hidden = false;
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
    const [agora, serie] = await Promise.all([buscarHoje(), buscarSerie()]);
    hoje = agora;
    linhas = mesmoDia(serie.dias, hojeISO);
    resumo = serie.resumo;
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

  const serieCarregada = resumo.filter((d) => d.dias >= 300).length >= 6;

  let houveAproximacao = false;
  $("#cartoes-passado").innerHTML = CONFIG.anosAtras.map((n) => {
    const achado = escolherDia(linhas, iso(anoAtual - n, mes, dia));
    if (achado && achado.desvio !== 0) houveAproximacao = true;
    return cartaoPassado(n, achado, hoje, serieCarregada);
  }).join("");

  if (houveAproximacao) {
    const nota = $("#nota-aproximacao");
    nota.hidden = false;
    nota.textContent = "Em algum dos anos a estação não registrou este dia exato. "
      + "Nesse caso usei o dia válido mais próximo, dentro de três dias, e avisei no cartão.";
  }

  // a manchete e o campo do ano so aparecem quando ha serie que os sustente
  montarManchete(resumo);
  ligarGeracao(resumo);

  // graficos e tendencias
  $("#grafico-serie").innerHTML = graficoSerie(pontos, hoje);
  $("#tendencias").innerHTML = blocoTendencias(resumo);
  $("#grafico-quentes").innerHTML =
    graficoAnual(resumo, "dias_acima_30", "Dias acima de 30 graus por ano", 60);
  $("#grafico-umidade").innerHTML =
    graficoAnual(resumo, "umidade_media", "Umidade média do ar por ano", null);
  $("#leitura-honesta").innerHTML = leituraHonesta(resumo);

  // a faixa longa e complementar: se ela falhar, o resto da pagina segue de pe
  try {
    const resposta = await fetch(CONFIG.era5);
    if (resposta.ok) montarSeculo(await resposta.json(), resumo);
  } catch (erro) {
    console.warn("faixa ERA5 indisponível:", erro.message);
  }
}

main();
