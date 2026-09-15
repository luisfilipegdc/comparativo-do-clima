# -*- coding: utf-8 -*-
"""
Gera site/dados/serie.json a partir de dados/clima_diario.csv.

A serie historica muda uma vez por ano, entao ela viaja como arquivo estatico
publicado junto com o site - nao como consulta a banco. Sao ~390 KB que o
servidor entrega comprimidos em ~97 KB, numa requisicao so.

    python gerar_json.py
"""

from __future__ import annotations

import csv
import json
import os
from collections import defaultdict

RAIZ = os.path.dirname(os.path.abspath(__file__))
ENTRADA = os.path.join(RAIZ, "dados", "clima_diario.csv")
SAIDA = os.path.join(RAIZ, "site", "dados", "serie.json")

# a ordem aqui e a ordem dos arrays no JSON; o front remonta os objetos
CAMPOS = ["data", "temp_max", "temp_min", "temp_media", "chuva_mm",
          "umidade_media", "umidade_min", "horas_validas"]

MIN_HORAS = 20   # dia com menos leituras que isso nao entra nas medias anuais


def numero(texto):
    """Devolve int quando o valor e redondo, para o arquivo nao carregar '.0'."""
    if texto in (None, ""):
        return None
    valor = float(texto)
    return int(valor) if valor == int(valor) else round(valor, 1)


def resumir(linhas):
    """Estatisticas por ano - o que os graficos de tendencia consomem."""
    anos = defaultdict(list)
    for linha in linhas:
        if int(linha["horas_validas"]) >= MIN_HORAS:
            anos[int(linha["data"][:4])].append(linha)

    resumo = []
    for ano in sorted(anos):
        dias = anos[ano]
        col = lambda c: [float(d[c]) for d in dias if d[c]]
        media = lambda c, casas=2: round(sum(col(c)) / len(col(c)), casas)
        resumo.append({
            "ano": ano,
            "dias": len(dias),
            "temp_max_media": media("temp_max"),
            "temp_min_media": media("temp_min"),
            "temp_media": media("temp_media"),
            "umidade_media": media("umidade_media", 1),
            "dias_acima_30": sum(1 for d in dias if d["temp_max"] and float(d["temp_max"]) > 30),
            "noites_quentes": sum(1 for d in dias if d["temp_min"] and float(d["temp_min"]) >= 18),
            "chuva_total": round(sum(col("chuva_mm")), 1),
        })
    return resumo


def main():
    with open(ENTRADA, encoding="utf-8", newline="") as arquivo:
        linhas = list(csv.DictReader(arquivo))
    if not linhas:
        raise SystemExit(f"{ENTRADA} esta vazio - rode importar_inmet.py antes")

    saida = {
        "fonte": "INMET, estacao automatica A001 (Brasilia)",
        "campos": CAMPOS,
        # arrays em vez de objetos: sem repetir o nome do campo em cada dia
        "dias": [[numero(l[c]) if c != "data" else l["data"] for c in CAMPOS] for l in linhas],
        "resumo": resumir(linhas),
    }

    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w", encoding="utf-8") as arquivo:
        json.dump(saida, arquivo, separators=(",", ":"))

    tamanho = os.path.getsize(SAIDA) / 1024
    print(f"{len(saida['dias'])} dias e {len(saida['resumo'])} anos "
          f"-> {SAIDA} ({tamanho:.0f} KB)")


if __name__ == "__main__":
    main()
