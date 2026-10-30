"""Mazo de gymkana (tarjetas.json de tipo «imagen») → datos e imágenes de «El Rincón de la Gymkana».

Las tarjetas de una gymkana son fotos con una marca (alfiler, flecha, bandera) y la misma foto con el nombre. Muchas
comparten la foto: las estaciones de una lámina de Yokochi, los alfileres de una estación de morfogym. Por eso cada foto
base se guarda una sola vez (la mediana de las preguntas de esa foto, que borra los alfileres) y, por tarjeta, solo los
recortes donde su imagen difiere de la base. La página pone los recortes encima de la base, en su lugar, y queda igual
a la imagen del mazo. Al terminar se comprueba cada imagen rearmada contra la original.

Uso (desde la carpeta del repositorio; necesita numpy, scipy y Pillow con WebP):
    ~/.claude/skills/video-a-apunte/.venv/bin/python herramientas/armar_gymkana.py anato2-c2
La gymkana se describe en herramientas/gymkanas.json. Escribe gymkanas/<id>/datos.json, gymkanas/<id>/img/*.webp
(nombre = huella del contenido, así que rearmar sin cambios no cambia los archivos) y gymkanas/indice.json.
"""
import argparse
import collections
import datetime
import hashlib
import io
import json
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

REPO = Path(__file__).resolve().parent.parent
PROYECTO = REPO.parent            # «claude medicina»
UMBRAL = 28                       # diferencia por canal que cuenta como «cambió»
DILATAR = 7                       # px de margen alrededor de cada cambio
MAX_FRAC = 0.40                   # si los recortes cubren más que esto, la imagen va entera
Q_BASE, Q_PARCHE = 90, 92         # calidad WebP


def grupo(t):
    o = t["origen"].split(":")
    if o[0] == "yk":
        return "yk:" + o[1]
    if o[0] == "morfogym":
        return f"mg:{o[1]}:{o[2]}"
    return t["origen"]


def fuente_de(t):
    o = t["origen"].split(":")[0]
    if o == "yk":
        return "Yokochi"
    if o == "morfogym":
        return "morfogym"
    if o == "cc":
        return "Modelos 3D" if "no_foto" in t["etiquetas"] else "ComprehensiveCadaver"
    if o == "old":
        return "Mazo antiguo"
    return o


def webp(arr, q):
    b = io.BytesIO()
    Image.fromarray(arr).save(b, "WEBP", quality=q, method=6)
    return b.getvalue()


def cajas(mask):
    """Rectángulos (x, y, w, h) que cubren los cambios; los que se tocan se juntan."""
    lab, _ = ndimage.label(mask)
    bs = [[s[1].start, s[0].start, s[1].stop, s[0].stop] for s in ndimage.find_objects(lab)]
    cambio = True
    while cambio:
        cambio = False
        for i in range(len(bs)):
            for j in range(i + 1, len(bs)):
                a, b = bs[i], bs[j]
                if a[0] <= b[2] + 4 and b[0] <= a[2] + 4 and a[1] <= b[3] + 4 and b[1] <= a[3] + 4:
                    bs[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    del bs[j]
                    cambio = True
                    break
            if cambio:
                break
    return [(x0, y0, x1 - x0, y1 - y0) for x0, y0, x1, y1 in bs]


def procesar(args):
    base_dir, tarjetas = args
    imgs = {}
    for t in tarjetas:
        for lado in ("pregunta", "respuesta"):
            p = base_dir / t[lado]
            if p not in imgs:
                imgs[p] = np.asarray(Image.open(p).convert("RGB"))
    por_tam = collections.defaultdict(list)
    for t in tarjetas:
        por_tam[imgs[base_dir / t["pregunta"]].shape].append(t)
    archivos, salida, errores = {}, {}, []

    def guardar(datos):
        h = hashlib.sha1(datos).hexdigest()[:14]
        archivos[h] = datos
        return h

    for forma, ts in por_tam.items():
        qs = [imgs[base_dir / t["pregunta"]] for t in ts]
        base = np.median(np.stack(qs), axis=0).astype(np.uint8) if len(qs) >= 3 else qs[0]
        datos_base = webp(base, Q_BASE)
        bid = guardar(datos_base)
        dec_base = np.asarray(Image.open(io.BytesIO(datos_base)).convert("RGB")).astype(np.int16)
        h, w = forma[:2]
        for t in ts:
            caras = {}
            for lado, k in (("pregunta", "q"), ("respuesta", "a")):
                im = imgs[base_dir / t[lado]]
                d = np.abs(im.astype(np.int16) - dec_base).max(axis=2) > UMBRAL
                d = ndimage.binary_dilation(d, iterations=DILATAR)
                cs = cajas(d) if d.any() else []
                if sum(cw * ch for *_, cw, ch in cs) > MAX_FRAC * w * h:
                    caras[k] = [guardar(webp(im, Q_BASE)), []]
                    continue
                parches = []
                rec = dec_base.copy()
                for x, y, cw, ch in cs:
                    datos = webp(np.ascontiguousarray(im[y:y + ch, x:x + cw]), Q_PARCHE)
                    parches.append([guardar(datos), int(x), int(y), int(cw), int(ch)])
                    rec[y:y + ch, x:x + cw] = np.asarray(Image.open(io.BytesIO(datos)).convert("RGB"))
                caras[k] = [bid, parches]
                # control: la imagen rearmada tiene que calzar con la del mazo
                mal = (np.abs(rec - im.astype(np.int16)).max(axis=2) > 60).mean()
                if mal > 0.002:
                    errores.append((t["codigo"], lado, round(float(mal), 4)))
            salida[t["codigo"]] = {"w": int(w), "h": int(h), **caras}
    return archivos, salida, errores


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id", help="clave de herramientas/gymkanas.json (p. ej., anato2-c2)")
    ap.add_argument("--procesos", type=int, default=6)
    a = ap.parse_args()
    conf = json.load(open(REPO / "herramientas" / "gymkanas.json"))[a.id]
    base_dir = PROYECTO / conf["fuente"]
    datos = json.load(open(base_dir / "tarjetas.json"))
    tarjetas = datos["tarjetas"]
    extras = set()
    for f in sorted(base_dir.glob("niveles*.json")):
        extras |= set(json.load(open(f)).get("extras", {}))
    vers = json.load(open(base_dir / "versiones.json"))["notas"] if (base_dir / "versiones.json").exists() else {}

    grupos = collections.defaultdict(list)
    for t in tarjetas:
        grupos[grupo(t)].append(t)
    archivos, imagenes, errores = {}, {}, []
    with ProcessPoolExecutor(max_workers=a.procesos) as ex:
        trabajos = [(base_dir, ts) for ts in grupos.values()]
        for n, (arch, sal, err) in enumerate(ex.map(procesar, trabajos, chunksize=2)):
            archivos.update(arch)
            imagenes.update(sal)
            errores += err
            if n % 100 == 0:
                print(f"{n}/{len(trabajos)} fotos · {sum(map(len, archivos.values())) / 1e6:.0f} MB", flush=True)

    sems, regs = set(conf.get("semanas", {})), set(conf.get("regiones", {}))
    salida = []
    for t in tarjetas:
        im = imagenes[t["codigo"]]
        v = vers.get(t["codigo"], {})
        pub = v.get("publicada") or v.get("actual") or {}
        version = pub.get("version", 1)
        salida.append({
            "c": t["codigo"],
            "e": t["encabezado"],
            "n": t["etiqueta"],
            "x": t.get("extra", ""),
            "f": t.get("fuente", ""),
            "sem": next((e for e in t["etiquetas"] if e in sems), ""),
            "reg": next((e for e in t["etiquetas"] if e in regs), ""),
            "src": fuente_de(t),
            "xt": t["codigo"] in extras,
            "v": version,
            "cr": v.get("creada", ""),
            "ac": pub.get("fecha", "") if version > 1 else "",
            "w": im["w"], "h": im["h"],
            "q": im["q"], "a": im["a"],
        })

    destino = REPO / "gymkanas" / a.id
    nuevo = destino.with_name(a.id + ".nuevo")
    shutil.rmtree(nuevo, ignore_errors=True)
    (nuevo / "img").mkdir(parents=True)
    for h, b in archivos.items():
        (nuevo / "img" / f"{h}.webp").write_bytes(b)
    meta = {k: conf[k] for k in ("titulo", "ramo", "periodo", "semanas", "regiones") if k in conf}
    (nuevo / "datos.json").write_text(json.dumps({**meta, "tarjetas": salida}, ensure_ascii=False,
                                                 separators=(",", ":")))
    shutil.rmtree(destino, ignore_errors=True)
    nuevo.rename(destino)

    indice_p = REPO / "gymkanas" / "indice.json"
    indice = json.load(open(indice_p)) if indice_p.exists() else []
    indice = [g for g in indice if g["id"] != a.id]
    indice.append({"id": a.id, "titulo": conf["titulo"], "ramo": conf["ramo"], "periodo": conf.get("periodo", ""),
                   "tarjetas": len(salida), "extras": sum(t["xt"] for t in salida),
                   "actualizada": datetime.date.today().isoformat()})
    indice_p.write_text(json.dumps(indice, ensure_ascii=False, indent=1))

    total = sum(map(len, archivos.values()))
    print(f"{a.id}: {len(salida)} tarjetas · {len(archivos)} imágenes · {total / 1e6:.0f} MB")
    print("errores de reconstrucción:", len(errores), errores[:15])
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
