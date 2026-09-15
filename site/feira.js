/* Apresentacao de feira de ciencias.
   Seis telas, uma por aluno. O visitante chuta antes de ver o numero - o que
   a pessoa erra sozinha ela lembra; o que ela so le, esquece na banca seguinte.
   Le os mesmos arquivos do site: nenhuma fonte nova, nenhum numero digitado
   a mao aqui dentro. */

const FONTES = { serie: "dados/serie.json", era5: "dados/era5.json" };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const br = (v, casas = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—"
  : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));

/* ----------------------------------------------------------- navegacao */

let atual = 0;
const telas = $$(".tela");

function mostrar(i) {
  atual = Math.max(0, Math.min(telas.length - 1, i));
  telas.forEach((t, n) => t.classList.toggle("ativa", n === atual));
  $("#atual").textContent = atual + 1;
  $("#anterior").disabled = atual === 0;
  $("#proximo").disabled = atual === telas.length - 1;
  // a barra enche conforme a apresentacao anda: o visitante ve quanto falta
  $("#progresso-barra").style.width = `${((atual + 1) / telas.length) * 100}%`;
}

function ligarNavegacao() {
  $("#total").textContent = telas.length;
  $("#proximo").addEventListener("click", () => mostrar(atual + 1));
  $("#anterior").addEventListener("click", () => mostrar(atual - 1));
  $("#tela-cheia").addEventListener("click", alternarTelaCheia);

  document.addEventListener("keydown", (e) => {
    // nao sequestra as setas enquanto o visitante digita o palpite
    if (e.target.tagName === "INPUT" && e.key !== "Escape") return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); mostrar(atual + 1); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); mostrar(atual - 1); }
    if (e.key === "Home") mostrar(0);
    if (e.key === "End") mostrar(telas.length - 1);
    if (e.key.toLowerCase() === "f") alternarTelaCheia();
  });

  mostrar(0);
}

function alternarTelaCheia() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

/* -------------------------------------------------------------- dados */

async function carregar() {
  const [serie, era5] = await Promise.all([
    fetch(FONTES.serie).then((r) => r.json()),
    fetch(FONTES.era5).then((r) => r.json()).catch(() => null),
  ]);
  const dias = serie.dias.map((l) => {
    const d = {};
    serie.campos.forEach((c, i) => { d[c] = l[i]; });
    return d;
  });
  return { dias, resumo: serie.resumo, era5 };
}

/** Hoje vem ao vivo; se a rede falhar na hora da apresentacao, usa o ultimo
    valor guardado no aparelho em vez de deixar a tela vazia na frente do juri. */
async function buscarHoje() {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=-15.78&longitude=-47.93"
    + "&daily=temperature_2m_max,temperature_2m_min&timezone=America%2FSao_Paulo&forecast_days=1";
  try {
    const d = await (await fetch(url)).json();
    const hoje = {
      data: d.daily.time[0],
      temp_max: d.daily.temperature_2m_max[0],
      temp_min: d.daily.temperature_2m_min[0],
    };
    try { localStorage.setItem("feira_hoje", JSON.stringify(hoje)); } catch (e) { /* modo privado */ }
    return hoje;
  } catch (e) {
    try {
      const guardado = JSON.parse(localStorage.getItem("feira_hoje") || "null");
      if (guardado) return { ...guardado, antigo: true };
    } catch (e2) { /* sem nada guardado */ }
    return null;
  }
}

/** Numero que sobe contando ate o valor. Segura a atencao no momento da
    revelacao - e da tempo do visitante perceber que errou o proprio chute. */
function contarAte(elemento, alvo, duracao = 900) {
  if (!elemento) return;
  const inicio = performance.now();
  function passo(agora) {
    const t = Math.min(1, (agora - inicio) / duracao);
    const suave = 1 - Math.pow(1 - t, 3);             // desacelera no fim
    elemento.textContent = Math.round(alvo * suave);
    if (t < 1) requestAnimationFrame(passo);
  }
  requestAnimationFrame(passo);
}

/* ------------------------------------------------------------- medias */

function extremos(resumo, campo, n = 10) {
  const completos = resumo.filter((d) => d.dias >= 300);
  const med = (l) => l.reduce((s, d) => s + Number(d[campo]), 0) / l.length;
  const antes = completos.slice(0, n), depois = completos.slice(-n);
  return {
    antes: med(antes), depois: med(depois),
    anoIni: antes[0].ano, anoFimIni: antes[n - 1].ano,
    anoFin: depois[0].ano, anoFimFin: depois[depois.length - 1].ano,
  };
}

function tendencia(pontos, campo) {
  const xs = pontos.map((p) => p.ano), ys = pontos.map((p) => Number(p[campo]));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
    / xs.reduce((s, x) => s + (x - mx) ** 2, 0) * 10;
}

/* -------------------------------------------------------------- telas */

function tela1e2(dados) {
  const total = br(dados.dias.length, 0);
  $("#total-dias").textContent = total;
  $("#f-dias").textContent = total;
  const anos = dados.resumo.length;
  $("#f-anos").textContent = anos;
}

function tela3(dados, hoje) {
  const alvo = hoje?.data || dados.dias[dados.dias.length - 1].data;
  const [ano, mes, dia] = alvo.split("-").map(Number);

  const porData = new Map(dados.dias.map((d) => [d.data, d]));

  // monta primeiro os valores para poder escalar as barras entre si
  const itens = [];
  for (const atras of [20, 10, 5]) {
    const alvoAno = `${ano - atras}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const d = porData.get(alvoAno);
    if (d && d.temp_max !== null) {
      itens.push({ rotulo: `${atras} anos atrás`, valor: d.temp_max, ano: ano - atras });
    }
  }
  if (hoje) {
    itens.push({ rotulo: "Hoje", valor: hoje.temp_max, ano, hoje: true, antigo: hoje.antigo });
  }
  if (!itens.length) {
    $("#f-comparativo").innerHTML = '<p class="carregando">Sem dado para esta data.</p>';
    return;
  }

  // O cartao era um retangulo alto com o numero boiando no meio. A barra
  // preenche essa altura E faz a comparacao virar visual: da para ver qual
  // ano foi mais quente sem ler numero nenhum.
  const valores = itens.map((i) => i.valor);
  const piso = Math.floor(Math.min(...valores) - 4);
  const teto = Math.ceil(Math.max(...valores) + 1);
  const altura = (v) => Math.round(((v - piso) / (teto - piso)) * 100);

  $("#f-comparativo").innerHTML = itens.map((i) => `
    <div class="col-ano${i.hoje ? " hoje" : ""}">
      <span class="quando">${i.rotulo}</span>
      <span class="valor">${br(i.valor)}°</span>
      <span class="barra-termo"><span class="barra-termo-cheio" style="height:${altura(i.valor)}%"></span></span>
      <span class="ano">${i.ano}${i.antigo ? " · sem rede" : ""}</span>
    </div>`).join("");

  // Esta data, em TODOS os anos da serie: e o numero que desarma a objecao
  // "mas hoje esta mais frio que ha 5 anos" antes de ela ser feita.
  const mesmoDia = [];
  for (let a = 2000; a < ano; a++) {
    const d = porData.get(`${a}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`);
    if (d && d.temp_max !== null) mesmoDia.push(d.temp_max);
  }

  // O texto se adapta ao dado do dia. Se hoje for mais frio que algum ano
  // anterior, a tela ASSUME isso e transforma em pergunta - em vez de deixar
  // o visitante notar sozinho e achar que o argumento caiu.
  const maisQuentes = hoje ? itens.filter((i) => !i.hoje && i.valor > hoje.temp_max).length : 0;

  if (maisQuentes > 0 && hoje) {
    $("#f-data-hoje").innerHTML =
      `Hoje está <span class="realce">mais frio</span> que
       ${maisQuentes === 1 ? "em um desses anos" : `em ${maisQuentes} desses anos`}.`;
    $("#f-texto-dia").innerHTML =
      `Então não esquentou? <b>Calma.</b> Neste mesmo dia, ao longo de
       ${mesmoDia.length} anos, a máxima já foi de <b>${br(Math.min(...mesmoDia))} °C</b>
       a <b>${br(Math.max(...mesmoDia))} °C</b>. Um dia é sorte. <b>Vira a tela.</b>`;
  } else {
    $("#f-data-hoje").innerHTML =
      `Hoje é <span class="realce">${dia} de ${NOMES_MES[mes - 1]}</span>.<br>E nos outros anos?`;
    $("#f-texto-dia").innerHTML = mesmoDia.length
      ? `Neste mesmo dia, ao longo de ${mesmoDia.length} anos, a máxima já foi de
         <b>${br(Math.min(...mesmoDia))} °C</b> a <b>${br(Math.max(...mesmoDia))} °C</b>.
         Um dia sozinho não prova nada — por isso olhamos todos.`
      : "Um dia sozinho não prova nada — por isso olhamos todos.";
  }
}

/** O ano inteiro como quadradinhos: 1 quadrado = 1 dia, vermelho = passou de
    30 °C. Uma crianca de 10 anos nao le uma reta de tendencia, mas conta
    bolinha vermelha na hora - e ve o vermelho dobrar de um ano para o outro. */
function gradeAno(dias, ano, rotulo) {
  const doAno = dias.filter((d) => d.data.startsWith(String(ano)));
  if (!doAno.length) return "";

  // 10 linhas em vez de 7: a faixa de 53 colunas ficava comprida e baixa
  // demais, e sobrava altura na coluna. Mais quadrado, o bloco cresce e o
  // vermelho fica maior na tela da TV.
  const lado = 13, vao = 2.4, linhas = 10;
  const colunas = Math.ceil(doAno.length / linhas);
  const largura = colunas * (lado + vao);
  const altura = linhas * (lado + vao) + 26;

  const quentes = doAno.filter((d) => d.temp_max !== null && d.temp_max > 30).length;

  const celulas = doAno.map((d, i) => {
    const col = Math.floor(i / linhas), lin = i % linhas;
    // tres niveis: o vermelho escuro marca os dias de calor extremo, e da
    // textura a grade sem precisar de legenda extra
    const classe = d.temp_max === null ? "gr-vazio"
      : d.temp_max > 33 ? "gr-muito-quente"
      : d.temp_max > 30 ? "gr-quente"
      : "gr-ameno";
    return `<rect class="${classe}" x="${col * (lado + vao)}" y="${lin * (lado + vao) + 22}"
      width="${lado}" height="${lado}" rx="2.5"
      style="animation-delay:${(i * 1.6).toFixed(0)}ms"><title>${d.data}${
        d.temp_max !== null ? `: ${br(d.temp_max)} °C` : ""}</title></rect>`;
  }).join("");

  return `<figure class="grade-ano">
    <svg viewBox="0 0 ${largura} ${altura}" role="img"
      aria-label="Os dias de ${ano}: ${quentes} passaram de 30 graus">
      <text class="gr-titulo" x="0" y="13">${rotulo} · <tspan class="gr-destaque">${quentes} dias quentes</tspan></text>
      ${celulas}
    </svg></figure>`;
}

/** Barras dos dias quentes por ano - so aparece depois do chute. */
function graficoJogo(resumo) {
  const anos = resumo.filter((d) => d.dias >= 300);
  const largura = 900, alturaUtil = 150, margemBaixo = 22;
  const passo = largura / anos.length;
  const maximo = Math.max(...anos.map((a) => a.dias_acima_30)) * 1.08;

  const barras = anos.map((a, i) => {
    const h = (a.dias_acima_30 / maximo) * alturaUtil;
    const x = i * passo + passo * 0.12;
    const classe = a.dias_acima_30 > 60 ? "gf-barra-quente" : "gf-barra";
    const rot = a.ano % 5 === 0
      ? `<text class="gf-rotulo" x="${x + passo * 0.38}" y="${alturaUtil + 16}" text-anchor="middle">${a.ano}</text>`
      : "";
    return `<rect class="${classe}" x="${x}" y="${alturaUtil - h}" width="${passo * 0.76}"
      height="${h}" rx="2"><title>${a.ano}: ${a.dias_acima_30} dias</title></rect>${rot}`;
  }).join("");

  return `<svg viewBox="0 0 ${largura} ${alturaUtil + margemBaixo}" role="img"
    aria-label="Dias acima de 30 graus em cada ano">${barras}</svg>`;
}

function tela4(dados) {
  const d = extremos(dados.resumo, "dias_acima_30");
  const antes = Math.round(d.antes), depois = Math.round(d.depois);

  $("#jogo-antes").textContent = antes;
  $("#jogo-antes2").textContent = antes;
  $("#jogo-depois").textContent = depois;

  const meses = (v) => Math.round(v / 30);
  $(".jogo-traducao").innerHTML =
    `De <b>${meses(antes)} ${meses(antes) === 1 ? "mês" : "meses"}</b> de calor por ano
     para <b>${meses(depois)} ${meses(depois) === 1 ? "mês" : "meses"}</b>.`;

  function revelar() {
    const antes = Math.round(d.antes), depois = Math.round(d.depois);
    const palpite = Number($("#jogo-palpite").value);
    const erro = palpite ? Math.abs(palpite - depois) : null;

    let veredito;
    if (!palpite) veredito = "A resposta é:";
    else if (erro <= 5) veredito = `Você chutou ${palpite}. Acertou quase na mosca!`;
    else if (palpite < depois) veredito = `Você chutou ${palpite}. É mais que isso:`;
    else veredito = `Você chutou ${palpite}. É menos — mas ainda assim muito:`;

    $("#jogo-veredito").textContent = veredito;

    // Dois anos lado a lado, dia por dia: e aqui que a crianca "ve" o dobro.
    // Escolhe o ano MAIS PROXIMO de cada media em vez de um ano qualquer -
    // senao a grade mostra 20 e 67 enquanto o texto acima diz 29 e 57, e a
    // primeira coisa que perguntam e por que os numeros nao batem.
    const cheios = dados.resumo.filter((r) => r.dias >= 360);
    const maisPerto = (lista, alvo) => lista.reduce((a, b) =>
      Math.abs(b.dias_acima_30 - alvo) < Math.abs(a.dias_acima_30 - alvo) ? b : a).ano;
    const anoAntigo = maisPerto(cheios.slice(0, 10), antes);
    const anoRecente = maisPerto(cheios.slice(-10), depois);
    $("#jogo-grafico").innerHTML =
      gradeAno(dados.dias, anoAntigo, `Um ano inteiro em ${anoAntigo}`)
      + gradeAno(dados.dias, anoRecente, `Um ano inteiro em ${anoRecente}`)
      + `<p class="grade-legenda"><span class="amostra gr-ameno"></span> dia normal
         &nbsp;&nbsp;<span class="amostra gr-quente"></span> passou de 30 °C
         &nbsp;&nbsp;<span class="amostra gr-muito-quente"></span> passou de 33 °C
         &nbsp;&nbsp;<em>cada quadradinho é um dia do ano</em></p>`;

    $("#jogo-pergunta").hidden = true;
    $("#jogo-resposta").hidden = false;
    // vira o slide de uma coluna centrada para duas: as grades ganham a
    // metade direita, que antes da revelacao nao tinha o que mostrar
    $("#tela-jogo").classList.add("revelado");
    contarAte($("#jogo-depois"), depois);
  }

  $("#jogo-botao").addEventListener("click", revelar);
  $("#jogo-palpite").addEventListener("keydown", (e) => { if (e.key === "Enter") revelar(); });
}

function tela5(dados) {
  const inmet = dados.resumo.filter((d) => d.dias >= 300);
  if (!dados.era5 || inmet.length < 6) {
    $("#f-duelo").innerHTML = '<p class="carregando">Sem a série longa.</p>';
    return;
  }
  const de = inmet[0].ano, ate = inmet[inmet.length - 1].ano;
  const regiao = dados.era5.resumo.filter((a) => a.dias >= 350 && a.ano >= de && a.ano <= ate);

  const tCidade = tendencia(inmet, "temp_max_media");
  const tRegiao = tendencia(regiao, "temp_max_media");
  const vezes = tRegiao > 0.01 ? tCidade / tRegiao : null;

  // barra proporcional dentro de cada lado: o retangulo deixa de ser so
  // numero solto e a diferenca fica visivel antes de ser lida
  const maior = Math.max(tCidade, tRegiao);
  const barra = (v) => `<span class="duelo-barra"><span style="width:${Math.round((v / maior) * 100)}%"></span></span>`;

  $("#f-duelo").innerHTML = `
    <div class="duelo-lado cidade">
      <span class="titulo">A estação dentro da cidade</span>
      <span class="valor">+${br(tCidade, 2)} °C</span>
      ${barra(tCidade)}
      <span class="nota">a cada 10 anos</span>
    </div>
    <div class="duelo-lado">
      <span class="titulo">A região em volta</span>
      <span class="valor">+${br(tRegiao, 2)} °C</span>
      ${barra(tRegiao)}
      <span class="nota">a cada 10 anos</span>
    </div>`;

  $("#f-duelo-nota").innerHTML = vezes
    ? `A cidade esquenta <b>${br(vezes, 1)} vezes mais rápido</b> que a região — asfalto e
       prédio seguram calor. Mas a região também esquenta: <b>isso é o planeta</b>.
       Comparamos os mesmos anos (${de}–${ate}) dos dois lados.`
    : "";
}

/* ------------------------------------------------------------ montagem */

async function main() {
  ligarNavegacao();
  try {
    const dados = await carregar();
    const hoje = await buscarHoje();
    tela1e2(dados);
    tela3(dados, hoje);
    tela4(dados);
    tela5(dados);
  } catch (erro) {
    console.error(erro);
    $("#f-comparativo").innerHTML =
      `<p class="carregando">Não consegui carregar os dados: ${erro.message}</p>`;
  }
}

main();
