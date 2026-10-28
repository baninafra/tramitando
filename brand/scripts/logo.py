import os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

CELESTE, CELESTE_CLARO, CARBON, BLANCO = "#6CACE4", "#B5D5F1", "#1E2329", "#FFFFFF"
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

font = TTFont(os.path.join(os.path.dirname(__file__), "Figtree-Bold.ttf"))
gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
hmtx = font["hmtx"]


def wordmark(text, x0, baseline, size, track=-0.01):
    s = size / upm
    pen = SVGPathPen(gs)
    x = x0
    for ch in text:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, baseline)))
        x += hmtx[g][0] * s + track * size
    return pen.getCommands(), x - track * size


PAPEL = "M9 2H25L35 12V36a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z"
DOBLEZ = "M25 2V9a3 3 0 0 0 3 3H35Z"


def isotipo(uid, papel, doblez, sello):
    # Máscaras: los renglones y el aro del sello se calan del papel; el check se cala del sello.
    m = (
        f'<mask id="p{uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="50">'
        f'<rect width="48" height="50" fill="#fff"/>'
        f'<path d="M10.5 18H26M10.5 25H21" stroke="#000" stroke-width="3" stroke-linecap="round"/>'
        f'<circle cx="33" cy="36" r="13" fill="#000"/></mask>'
        f'<mask id="s{uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="50">'
        f'<rect width="48" height="50" fill="#fff"/>'
        f'<path d="M28.3 36.3l3.2 3.2 6.1-6.7" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></mask>'
    )
    g = f'<g mask="url(#p{uid})"><path d="{PAPEL}" fill="{papel}"/>'
    if doblez:
        g += f'<path d="{DOBLEZ}" fill="{doblez}"/>'
    g += f'</g><circle cx="33" cy="36" r="10.5" fill="{sello}" mask="url(#s{uid})"/>'
    return m, g


def svg(w, h, defs, body, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h}" width="{w:.1f}" height="{h}" role="img">'
        f'<title>{title}</title><defs>{defs}</defs>{body}</svg>\n'
    )


def logo(name, papel, doblez, sello, texto, title):
    d, x_end = wordmark("tramitando", 56, 37, 36)
    m, g = isotipo(name, papel, doblez, sello)
    w = x_end + 2
    open(os.path.join(OUT, f"{name}.svg"), "w", encoding="utf-8").write(
        svg(w, 48, m, g + f'<path d="{d}" fill="{texto}"/>', title)
    )


def iso(name, papel, doblez, sello, title):
    m, g = isotipo(name, papel, doblez, sello)
    open(os.path.join(OUT, f"{name}.svg"), "w", encoding="utf-8").write(svg(46, 48, m, g, title))


logo("tramitando-logo", CELESTE, CELESTE_CLARO, CARBON, CARBON, "tramitando")
logo("tramitando-logo-negativo", CELESTE, CELESTE_CLARO, BLANCO, BLANCO, "tramitando")
logo("tramitando-logo-mono-carbon", CARBON, None, CARBON, CARBON, "tramitando")
logo("tramitando-logo-mono-blanco", BLANCO, None, BLANCO, BLANCO, "tramitando")
iso("tramitando-isotipo", CELESTE, CELESTE_CLARO, CARBON, "tramitando")
iso("tramitando-isotipo-negativo", CELESTE, CELESTE_CLARO, BLANCO, "tramitando")

# Favicon: el isotipo sobre una placa carbón, legible a 16 px.
m, g = isotipo("fav", CELESTE, CELESTE_CLARO, BLANCO)
open(os.path.join(OUT, "tramitando-favicon.svg"), "w", encoding="utf-8").write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img">'
    f'<title>tramitando</title><defs>{m}</defs><rect width="64" height="64" rx="14" fill="{CARBON}"/>'
    f'<g transform="translate(9 8)">{g}</g></svg>\n'
)
print(sorted(os.listdir(OUT)))
