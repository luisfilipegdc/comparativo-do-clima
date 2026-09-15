# -*- coding: utf-8 -*-
"""
Importador INMET - estacao automatica A001 (Brasilia).

Baixa o ZIP anual do portal do INMET, encontra o CSV da A001, converte a hora
de UTC para UTC-3 e agrega as leituras horarias em um registro por dia.

Somente biblioteca padrao. Uso:

    python importar_inmet.py 2025
    python importar_inmet.py 2000 2026 --saida dados/clima_diario.csv
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import unicodedata
import urllib.request
import zipfile
from datetime import datetime, timedelta

URL_ZIP = "https://portal.inmet.gov.br/uploads/dadoshistoricos/{ano}.zip"
ESTACAO = "_A001_"
SEM_DADO = -9999.0
FUSO_LOCAL = timedelta(hours=-3)   # UTC-3, sem horario de verao desde 2019
CABECALHO_MAX = 20                 # linhas de metadados antes do cabecalho real

PASTA_DADOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dados")

# Cada campo aponta para um trecho (ja normalizado) do nome da coluna no CSV.
COLUNAS = {
    "data":        "DATA",
    "hora":        "HORA",
    "chuva":       "PRECIPITACAO TOTAL",
    "pressao":     "PRESSAO ATMOSFERICA AO NIVEL DA ESTACAO",
    "temp":        "TEMPERATURA DO AR - BULBO SECO",
    "temp_max":    "TEMPERATURA MAXIMA",
    "temp_min":    "TEMPERATURA MINIMA",
    "umidade":     "UMIDADE RELATIVA DO AR, HORARIA",
    "umidade_min": "UMIDADE REL. MIN",
    "vento":       "VENTO, VELOCIDADE",
    "rajada":      "VENTO, RAJADA",
}


def normalizar(texto):
    """Tira acentos, espacos sobrando e caixa - os nomes de coluna mudam com o ano."""
    sem_acento = unicodedata.normalize("NFKD", texto or "")
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return " ".join(sem_acento.upper().split())


def baixar_zip(ano):
    """Baixa o ZIP do ano para dados/ e devolve o caminho. Reaproveita o arquivo local."""
    os.makedirs(PASTA_DADOS, exist_ok=True)
    destino = os.path.join(PASTA_DADOS, "%d.zip" % ano)
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        print("[%d] ZIP ja baixado (%.1f MB)" % (ano, os.path.getsize(destino) / 1e6))
        return destino

    url = URL_ZIP.format(ano=ano)
    print("[%d] baixando %s" % (ano, url))
    parcial = destino + ".parcial"
    req = urllib.request.Request(url, headers={"User-Agent": "comparativo-do-clima/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resposta, open(parcial, "wb") as saida:
        total = int(resposta.headers.get("Content-Length") or 0)
        baixado = 0
        while True:
            pedaco = resposta.read(1 << 20)
            if not pedaco:
                break
            saida.write(pedaco)
            baixado += len(pedaco)
            if total:
                print("\r[%d] %6.1f / %.1f MB" % (ano, baixado / 1e6, total / 1e6), end="")
            else:
                print("\r[%d] %6.1f MB" % (ano, baixado / 1e6), end="")
    print()
    os.replace(parcial, destino)
    return destino


def achar_csv(zf):
    """Nome do CSV da A001 dentro do ZIP."""
    candidatos = [n for n in zf.namelist()
                  if ESTACAO in n.upper() and n.upper().endswith(".CSV")]
    if not candidatos:
        raise LookupError("nenhum CSV com %s no ZIP" % ESTACAO)
    return candidatos[0]


def mapear_colunas(cabecalho):
    """Casa cada campo com o indice da coluna correspondente."""
    normalizado = [normalizar(c) for c in cabecalho]
    indices = {}
    for campo, trecho in COLUNAS.items():
        for i, nome in enumerate(normalizado):
            achou = nome.startswith(trecho) if campo in ("data", "hora") else trecho in nome
            if achou:
                indices[campo] = i
                break
    faltando = [c for c in ("data", "hora", "temp") if c not in indices]
    if faltando:
        raise LookupError("colunas nao encontradas: %s - cabecalho: %s" % (faltando, normalizado))
    return indices


def ler_numero(texto):
    """Converte '23,4' em 23.4. Devolve None para vazio e para -9999."""
    texto = (texto or "").strip().replace(",", ".")
    if not texto:
        return None
    try:
        valor = float(texto)
    except ValueError:
        return None
    return None if valor <= SEM_DADO else valor


def ler_instante(data, hora):
    """Junta as colunas Data e Hora UTC num datetime. O formato varia entre os anos."""
    data = (data or "").strip()
    hora = (hora or "").strip().upper().replace("UTC", "").replace(":", "").strip()
    if not data or not hora:
        return None
    try:
        hh = int(hora[:2])
        mm = int(hora[2:4]) if len(hora) >= 4 else 0
    except ValueError:
        return None
    for formato in ("%Y/%m/%d", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            dia = datetime.strptime(data, formato)
        except ValueError:
            continue
        return dia.replace(hour=hh, minute=mm)
    return None


class Acumulador:
    """Junta as leituras horarias de um mesmo dia local."""

    def __init__(self):
        self.temp_max = None
        self.temp_min = None
        self.umidade_min = None
        self.rajada_max = None
        self.chuva = 0.0
        self.tem_chuva = False
        self.soma = {}
        self.n = {}
        self.horas_validas = 0

    def media(self, campo, valor):
        if valor is None:
            return
        self.soma[campo] = self.soma.get(campo, 0.0) + valor
        self.n[campo] = self.n.get(campo, 0) + 1

    def resultado(self, campo, casas=1):
        if not self.n.get(campo):
            return None
        return round(self.soma[campo] / self.n[campo], casas)


def agregar(caminho_zip, ano):
    """Le o CSV da A001 e devolve uma linha por dia local."""
    dias = {}

    with zipfile.ZipFile(caminho_zip) as zf:
        nome_csv = achar_csv(zf)
        print("[%d] CSV: %s" % (ano, nome_csv))
        with zf.open(nome_csv) as bruto:
            texto = io.TextIOWrapper(bruto, encoding="latin-1", newline="")
            leitor = csv.reader(texto, delimiter=";")

            indices = None
            for _ in range(CABECALHO_MAX):
                linha = next(leitor, None)
                if linha is None:
                    break
                # o cabecalho real e a unica linha com "Data" e "Hora UTC" lado a lado
                # (a linha "DATA DE FUNDACAO:" dos metadados tambem comeca com DATA)
                if (len(linha) > 2
                        and normalizar(linha[0]).startswith("DATA")
                        and normalizar(linha[1]).startswith("HORA")):
                    indices = mapear_colunas(linha)
                    break
            if indices is None:
                raise LookupError("[%d] cabecalho 'Data;Hora UTC;...' nao encontrado" % ano)

            def campo(linha, nome):
                i = indices.get(nome)
                if i is None or i >= len(linha):
                    return None
                return ler_numero(linha[i])

            for linha in leitor:
                if not linha or len(linha) <= indices["temp"]:
                    continue
                instante = ler_instante(linha[indices["data"]], linha[indices["hora"]])
                if instante is None:
                    continue
                dia = (instante + FUSO_LOCAL).strftime("%Y-%m-%d")
                acc = dias.setdefault(dia, Acumulador())

                temp = campo(linha, "temp")
                t_max = campo(linha, "temp_max")
                t_min = campo(linha, "temp_min")
                umid = campo(linha, "umidade")
                u_min = campo(linha, "umidade_min")
                chuva = campo(linha, "chuva")
                rajada = campo(linha, "rajada")

                for valor in (t_max, temp):
                    if valor is not None and (acc.temp_max is None or valor > acc.temp_max):
                        acc.temp_max = valor
                for valor in (t_min, temp):
                    if valor is not None and (acc.temp_min is None or valor < acc.temp_min):
                        acc.temp_min = valor
                for valor in (u_min, umid):
                    if valor is not None and (acc.umidade_min is None or valor < acc.umidade_min):
                        acc.umidade_min = valor
                if rajada is not None and (acc.rajada_max is None or rajada > acc.rajada_max):
                    acc.rajada_max = rajada
                if chuva is not None:
                    acc.chuva += chuva
                    acc.tem_chuva = True

                acc.media("temp", temp)
                acc.media("umidade", umid)
                acc.media("pressao", campo(linha, "pressao"))
                acc.media("vento", campo(linha, "vento"))
                if temp is not None:
                    acc.horas_validas += 1

    linhas = []
    for dia in sorted(dias):
        acc = dias[dia]
        if acc.horas_validas == 0:
            continue  # dia sem nenhuma leitura util - fica para a fonte reserva
        linhas.append({
            "data": dia,
            "fonte": "inmet_a001",
            "temp_max": acc.temp_max,
            "temp_min": acc.temp_min,
            "temp_media": acc.resultado("temp"),
            "chuva_mm": round(acc.chuva, 1) if acc.tem_chuva else None,
            "umidade_media": acc.resultado("umidade", 0),
            "umidade_min": acc.umidade_min,
            "pressao_media": acc.resultado("pressao"),
            "vento_medio": acc.resultado("vento"),
            "rajada_max": acc.rajada_max,
            "horas_validas": acc.horas_validas,
        })
    return linhas


def gravar_csv(linhas, caminho):
    os.makedirs(os.path.dirname(os.path.abspath(caminho)), exist_ok=True)
    campos = list(linhas[0].keys())
    with open(caminho, "w", encoding="utf-8", newline="") as saida:
        escritor = csv.DictWriter(saida, fieldnames=campos)
        escritor.writeheader()
        escritor.writerows(linhas)


def main():
    p = argparse.ArgumentParser(description="Importa dados diarios da estacao A001 do INMET.")
    p.add_argument("ano_inicial", type=int)
    p.add_argument("ano_final", type=int, nargs="?")
    p.add_argument("--saida", default=os.path.join(PASTA_DADOS, "clima_diario.csv"))
    p.add_argument("--amostra", type=int, default=5, help="linhas exibidas no fim")
    args = p.parse_args()

    ano_final = args.ano_final or args.ano_inicial
    todas = []
    for ano in range(args.ano_inicial, ano_final + 1):
        try:
            todas.extend(agregar(baixar_zip(ano), ano))
        except Exception as erro:  # um ano ruim nao derruba a importacao inteira
            print("[%d] FALHOU: %s" % (ano, erro), file=sys.stderr)

    if not todas:
        print("nenhum dia importado", file=sys.stderr)
        return 1

    gravar_csv(todas, args.saida)
    print("\n%d dias de %s a %s -> %s\n" % (len(todas), todas[0]["data"], todas[-1]["data"], args.saida))
    for linha in todas[:args.amostra]:
        print(json.dumps(linha, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
