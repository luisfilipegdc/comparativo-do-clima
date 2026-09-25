"""Gera o QR code do site em site/qr.svg.

SVG em vez de PNG: imprime nitido em qualquer impressora e pesa ~1 KB.
Requer `pip install segno` — e so isso; o site nao depende de nada em runtime.

    python gerar_qr.py [url]
"""
import sys
import pathlib

import segno

URL_PADRAO = "https://comparativo-do-clima.vercel.app/"
SAIDA = pathlib.Path(__file__).parent / "site" / "qr.svg"


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else URL_PADRAO
    # correcao de erro alta: a folha vai ser fotocopiada e dobrada
    qr = segno.make(url, error="h")
    qr.save(SAIDA, kind="svg", scale=10, border=2, dark="#12203a", light=None,
            svgclass=None, lineclass=None, omitsize=True)
    print(f"{SAIDA.relative_to(pathlib.Path.cwd())}  <-  {url}  ({qr.version}-H)")


if __name__ == "__main__":
    main()
