# -*- coding: utf-8 -*-
"""
Gera site/dados/era5.json - a camada de contexto longo do painel.

A estacao A001 so existe desde 2000. O ERA5, reanalise climatica servida pela
Open-Meteo, cobre o mesmo ponto desde 1940 - de graca e sem chave. Serve para
mostrar quase um seculo de clima e, principalmente, para comparar a tendencia
da cidade com a tendencia da regiao em volta.

ERA5 e modelo numa grade de ~30 km, nao um termometro no Plano Piloto: ele
achata o dia (esfria a maxima, esquenta a minima) em relacao a estacao. Por
isso as duas series NUNCA se misturam dia a dia - so convivem como camadas
rotuladas. O vies medido no periodo em comum fica gravado no proprio arquivo.

    python gerar_era5.py
"""

from __future__ import annotations

import csv
import json
import os
import urllib.request
from collections import defaultdict

RAIZ = os.path.dirname(os.path.abspath(__file__))
BRUTO = os.path.join(RAIZ, "dados", "era5.json")
INMET = os.path.join(RAIZ, "dados", "clima_diario.csv")
SAIDA = os.path.join(RAIZ, "site", "dados", "era5.json")

URL = ("https://archive-api.open-meteo.com/v1/archive"
       "?latitude=-15.78&longitude=-47.93"
       "&start_date=1940-01-01&end_date={fim}"
       "&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,"
       "precipitation_sum,relative_humidity_2m_mean"
       "&timezone=America%2FSao_Paulo")

MIN_DIAS = 350   # ano com menos dias que isso nao entra nas medias


def baixar(fim):
    """Baixa a serie diaria do ERA5. Reaproveita o arquivo local se existir."""
    if os.path.exists(BRUTO) and os.path.getsize(BRUTO) > 0:
        print(f"ERA5 ja baixado ({os.path.getsize(BRUTO) / 1e6:.1f} MB)")
        return json.load(open(BRUTO, encoding="utf-8"))

    os.makedirs(os.path.dirname(BRUTO), exist_ok=True)
    print(f"baixando ERA5 1940-{fim[:4]}...")
    with urllib.request.urlopen(URL.format(fim=fim), timeout=300) as resposta:
        dados = json.load(resposta)
    json.dump(dados, open(BRUTO, "w", encoding="utf-8"))
    return dados


def resumir(diario):
    """Media anual e contagem de dias quentes, ano a ano."""
    anos = defaultdict(list)
    for i, data in enumerate(diario["time"]):
        tmax = diario["temperature_2m_max"][i]
        if tmax is None:
            continue
        anos[int(data[:4])].append((tmax, diario["temperature_2m_min"][i],
                                    diario["relative_humidity_2m_mean"][i]))

    resumo = []
    for ano in sorted(anos):
        v = anos[ano]
        if len(v) < MIN_DIAS:
            continue          # 1940 incompleto ou o ano corrente pela metade
        media = lambda i: round(sum(x[i] for x in v if x[i] is not None)
                                / max(1, sum(1 for x in v if x[i] is not None)), 2)
        resumo.append({
            "ano": ano,
            "dias": len(v),
            "temp_max_media": media(0),
            "temp_min_media": media(1),
            "dias_acima_30": sum(1 for x in v if x[0] > 30),
        })
    return resumo


def comparar_com_inmet(diario):
    """Vies do ERA5 contra a estacao no periodo em que os dois existem.

    E o numero que autoriza (ou nao) usar as duas fontes na mesma pagina:
    se o vies fosse pequeno dariam para misturar; como nao e, viram camadas.
    """
    if not os.path.exists(INMET):
        return None

    era = {t: (diario["temperature_2m_max"][i], diario["temperature_2m_min"][i])
           for i, t in enumerate(diario["time"])}

    difs_max, difs_min = [], []
    with open(INMET, encoding="utf-8", newline="") as arquivo:
        for linha in csv.DictReader(arquivo):
            if int(linha["horas_validas"]) < 20:
                continue
            par = era.get(linha["data"])
            if not par or par[0] is None:
                continue
            if linha["temp_max"]:
                difs_max.append(par[0] - float(linha["temp_max"]))
            if linha["temp_min"] and par[1] is not None:
                difs_min.append(par[1] - float(linha["temp_min"]))

    if not difs_max:
        return None
    return {
        "dias": len(difs_max),
        "vies_temp_max": round(sum(difs_max) / len(difs_max), 2),
        "vies_temp_min": round(sum(difs_min) / len(difs_min), 2),
    }


def main():
    fim = None
    if os.path.exists(INMET):
        with open(INMET, encoding="utf-8", newline="") as arquivo:
            fim = list(csv.DictReader(arquivo))[-1]["data"]
    diario = baixar(fim or "2026-08-31")["daily"]

    resumo = resumir(diario)
    saida = {
        "fonte": "ERA5 (reanalise) via Open-Meteo Archive, ponto -15.78, -47.93",
        "aviso": "Reanalise em grade de ~30 km, nao medicao de estacao. "
                 "Nao deve ser misturada dia a dia com a serie do INMET.",
        "comparacao_inmet": comparar_com_inmet(diario),
        "resumo": resumo,
    }

    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    json.dump(saida, open(SAIDA, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"{len(resumo)} anos ({resumo[0]['ano']}-{resumo[-1]['ano']}) "
          f"-> {SAIDA} ({os.path.getsize(SAIDA) / 1024:.0f} KB)")
    if saida["comparacao_inmet"]:
        c = saida["comparacao_inmet"]
        print(f"vies contra o INMET em {c['dias']} dias: "
              f"maxima {c['vies_temp_max']:+.2f} C, minima {c['vies_temp_min']:+.2f} C")


if __name__ == "__main__":
    main()
