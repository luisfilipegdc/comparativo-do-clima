# -*- coding: utf-8 -*-
"""
Gera site/dados/normais.json a partir das Normais Climatologicas do INMET.

Por que isto existe: a serie automatica da A001 tem 25 anos e nao tem forca
estatistica para detectar mudanca na umidade (p = 0,31). As Normais do INMET
comparam DUAS janelas de 30 anos (1961-1990 e 1991-2020) na estacao
convencional 83377, a poucos quilometros dali - e ai a queda aparece.

Ausencia de prova nao e prova de ausencia: era so a nossa serie que era curta.

Entradas (baixadas do portal do INMET, em dados/):
  normal_chuva.csv     - precipitacao mensal, 1961-1990 x 1991-2020
  normal_umidade.csv   - umidade relativa mensal, as duas janelas
  Normal-Climatologica-{TMAX,UR,INSO,NEB,VENTIN}.xlsx  - normal 1991-2020

    python gerar_normais.py
"""

from __future__ import annotations

import csv
import io
import json
import os
import zipfile
from xml.etree import ElementTree as ET

RAIZ = os.path.dirname(os.path.abspath(__file__))
ENTRADA = os.path.join(RAIZ, "dados")
SAIDA = os.path.join(RAIZ, "site", "dados", "normais.json")

ESTACAO = "83377"          # BRASILIA/DF, convencional, em operacao desde 1961
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
         "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

# o CSV exportado do portal traz "Feveveiro" com erro de digitacao na origem
CORRIGE = {"feveveiro": "fevereiro"}


def numero(texto):
    texto = (texto or "").strip().replace(",", ".")
    if not texto or texto == "-":
        return None
    try:
        return float(texto)
    except ValueError:
        return None


def ler_comparativo(nome):
    """CSV com as duas janelas de 30 anos lado a lado, mes a mes."""
    caminho = os.path.join(ENTRADA, nome)
    with io.open(caminho, encoding="utf-8-sig", newline="") as arquivo:
        linhas = list(csv.reader(arquivo, delimiter=";"))

    saida = []
    for linha in linhas[1:]:
        if not linha or not linha[0]:
            continue
        mes = linha[0].strip().lower()
        mes = CORRIGE.get(mes, mes)
        if mes not in MESES:
            continue
        saida.append({
            "mes": MESES.index(mes) + 1,
            "antiga": numero(linha[2]),   # 1961-1990
            "nova": numero(linha[3]),     # 1991-2020
        })
    saida.sort(key=lambda x: x["mes"])
    return saida


def ler_planilha(nome):
    """Linha da estacao 83377 numa planilha de normal 1991-2020.

    Le o XLSX pelo XML interno: evita depender de openpyxl, que nao esta
    instalado e nao vale uma dependencia so para cinco arquivos.
    """
    caminho = os.path.join(ENTRADA, nome)
    if not os.path.exists(caminho):
        return None

    with zipfile.ZipFile(caminho) as z:
        textos = []
        if "xl/sharedStrings.xml" in z.namelist():
            raiz = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in raiz.findall(NS + "si"):
                textos.append("".join(n.text or "" for n in si.iter(NS + "t")))

        folha = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        titulo = None
        for linha in folha.iter(NS + "row"):
            celulas = []
            for c in linha.iter(NS + "c"):
                v = c.find(NS + "v")
                valor = None if v is None else v.text
                if c.get("t") == "s" and valor is not None:
                    valor = textos[int(valor)]
                celulas.append(valor)

            if titulo is None and celulas and celulas[0] and "Normal" not in celulas[0]:
                titulo = celulas[0]          # a 2a linha traz o nome da variavel
            if celulas and celulas[0] and celulas[0].strip() == ESTACAO:
                return {
                    "titulo": titulo,
                    "meses": [numero(x) for x in celulas[3:15]],
                    "ano": numero(celulas[15]) if len(celulas) > 15 else None,
                }
    return None


def main():
    chuva = ler_comparativo("normal_chuva.csv")
    umidade = ler_comparativo("normal_umidade.csv")

    def resumo(serie, somar):
        antiga = [m["antiga"] for m in serie if m["antiga"] is not None]
        nova = [m["nova"] for m in serie if m["nova"] is not None]
        agrega = sum if somar else (lambda v: sum(v) / len(v))
        caiu = sum(1 for m in serie
                   if m["antiga"] is not None and m["nova"] is not None
                   and m["nova"] < m["antiga"])
        return {
            "antiga": round(agrega(antiga), 1),
            "nova": round(agrega(nova), 1),
            "meses_em_queda": caiu,
            "meses": len(serie),
        }

    saida = {
        "fonte": "Normais Climatológicas do Brasil — INMET, estação 83377 (Brasília/DF, convencional)",
        "janelas": ["1961-1990", "1991-2020"],
        "chuva": {"mensal": chuva, "resumo": resumo(chuva, somar=True)},
        "umidade": {"mensal": umidade, "resumo": resumo(umidade, somar=False)},
        "normal_1991_2020": {},
    }

    for chave, arquivo in [
        ("temp_max", "Normal-Climatologica-TMAX.xlsx"),
        ("umidade", "Normal-Climatologica-UR.xlsx"),
        ("insolacao", "Normal-Climatologica-INSO.xlsx"),
        ("nebulosidade", "Normal-Climatologica-NEB.xlsx"),
        ("vento", "Normal-Climatologica-VENTIN.xlsx"),
    ]:
        dado = ler_planilha(arquivo)
        if dado:
            saida["normal_1991_2020"][chave] = dado

    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w", encoding="utf-8") as arquivo:
        json.dump(saida, arquivo, ensure_ascii=False, separators=(",", ":"))

    c, u = saida["chuva"]["resumo"], saida["umidade"]["resumo"]
    print(f"-> {SAIDA} ({os.path.getsize(SAIDA) / 1024:.0f} KB)")
    print(f"   chuva   {c['antiga']:.1f} -> {c['nova']:.1f} mm/ano "
          f"({c['nova'] - c['antiga']:+.1f}), queda em {c['meses_em_queda']}/12 meses")
    print(f"   umidade {u['antiga']:.1f} -> {u['nova']:.1f} % "
          f"({u['nova'] - u['antiga']:+.1f} p.p.), queda em {u['meses_em_queda']}/12 meses")
    print(f"   normal 1991-2020: {len(saida['normal_1991_2020'])} variáveis")


if __name__ == "__main__":
    main()
