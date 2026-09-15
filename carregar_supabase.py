# -*- coding: utf-8 -*-
"""
Carrega dados/clima_diario.csv na tabela clima.clima_diario do Supabase.

Faz upsert por data (conflito na chave primaria), em lotes. Le as credenciais
de .env - a service role key nunca entra no codigo nem no git.

    python carregar_supabase.py
    python carregar_supabase.py --arquivo dados/clima_diario.csv --lote 500
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.abspath(__file__))
TABELA = "clima_diario"
SCHEMA = "clima"

NUMERICOS = ("temp_max", "temp_min", "temp_media", "chuva_mm", "umidade_media",
             "umidade_min", "pressao_media", "vento_medio", "rajada_max")


def ler_env(caminho=None):
    """Le um .env simples (CHAVE=valor) sem depender de biblioteca externa."""
    caminho = caminho or os.path.join(RAIZ, ".env")
    valores = {}
    if not os.path.exists(caminho):
        return valores
    with open(caminho, encoding="utf-8") as arquivo:
        for linha in arquivo:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            valores[chave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def ler_linhas(caminho):
    """CSV -> lista de dicts com os tipos certos e vazio virando None."""
    with open(caminho, encoding="utf-8", newline="") as arquivo:
        linhas = []
        for bruta in csv.DictReader(arquivo):
            linha = {}
            for chave, valor in bruta.items():
                valor = (valor or "").strip()
                if valor == "":
                    linha[chave] = None
                elif chave in NUMERICOS:
                    linha[chave] = float(valor)
                elif chave == "horas_validas":
                    linha[chave] = int(valor)
                else:
                    linha[chave] = valor
            linhas.append(linha)
    return linhas


def enviar(url, chave, lote):
    """Upsert de um lote via PostgREST. on_conflict=data -> atualiza o dia existente."""
    destino = "%s/rest/v1/%s?on_conflict=data" % (url.rstrip("/"), TABELA)
    corpo = json.dumps(lote, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(destino, data=corpo, method="POST", headers={
        "apikey": chave,
        "Authorization": "Bearer %s" % chave,
        "Content-Type": "application/json",
        "Content-Profile": SCHEMA,          # grava no schema clima, nao no public
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=120) as resposta:
        return resposta.status


def main():
    p = argparse.ArgumentParser(description="Sobe o CSV diario para o Supabase.")
    p.add_argument("--arquivo", default=os.path.join(RAIZ, "dados", "clima_diario.csv"))
    p.add_argument("--lote", type=int, default=500)
    p.add_argument("--env", default=None)
    args = p.parse_args()

    env = ler_env(args.env)
    url = env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    chave = env.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not chave:
        print("faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env", file=sys.stderr)
        return 1

    linhas = ler_linhas(args.arquivo)
    if not linhas:
        print("CSV vazio: %s" % args.arquivo, file=sys.stderr)
        return 1

    enviados = 0
    for inicio in range(0, len(linhas), args.lote):
        lote = linhas[inicio:inicio + args.lote]
        try:
            enviar(url, chave, lote)
        except urllib.error.HTTPError as erro:
            print("falha no lote %d: %s - %s" % (inicio, erro.code, erro.read().decode("utf-8", "replace")),
                  file=sys.stderr)
            return 1
        enviados += len(lote)
        print("\r%d / %d dias" % (enviados, len(linhas)), end="")

    print("\nok: %d dias de %s a %s" % (len(linhas), linhas[0]["data"], linhas[-1]["data"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
