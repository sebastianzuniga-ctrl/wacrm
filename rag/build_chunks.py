import json

SRC = "/home/ino/wacrm/dent_diccionario.json"
OUT = "/home/ino/wacrm/rag/chunks.jsonl"

with open(SRC, encoding="utf-8") as f:
    data = json.load(f)

tablas = data.get("tablas", {})
count = 0

with open(OUT, "w", encoding="utf-8") as out:
    for nombre, info in tablas.items():
        comentario = info.get("comentario", "").strip()
        campos = info.get("campos", {}) or {}
        pk = info.get("primaryKey", {}) or {}
        rels = info.get("relacionesTabla", []) or []

        lineas = [f"Tabla: {nombre}"]
        if comentario:
            lineas.append(f"Descripción: {comentario}")

        if campos:
            lineas.append("Campos:")
            for cnombre, cinfo in campos.items():
                tipo = cinfo.get("tipo", "")
                tam = cinfo.get("tamano", "")
                es_pk = " PK" if cinfo.get("pk") else ""
                ccomentario = cinfo.get("comentario", "").strip()
                desc = f"  - {cnombre} ({tipo}{('(' + str(tam) + ')') if tam else ''}{es_pk})"
                if ccomentario:
                    desc += f": {ccomentario}"
                lineas.append(desc)

        if pk and pk.get("campos"):
            pk_raw = pk["campos"]
            if isinstance(pk_raw, dict):
                pk_campos = ", ".join(str(v) for v in pk_raw.values())
            elif isinstance(pk_raw, list):
                pk_campos = ", ".join(str(v) for v in pk_raw)
            else:
                pk_campos = str(pk_raw)
            lineas.append(f"Primary Key: {pk.get('nombre', '')} ({pk_campos})")

        if rels:
            lineas.append("Relaciones:")
            for r in rels:
                campo = r.get("campo", "")
                tabla_ref = r.get("tablaReferenciada", "")
                campo_ref = r.get("campoReferenciado", "")
                sentido = r.get("sentido", "")
                lineas.append(f"  - {campo} -> {tabla_ref}.{campo_ref} ({sentido})")

        texto = "\n".join(lineas)
        rec = {"id": nombre, "text": texto, "metadata": {"tabla": nombre}}
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        count += 1

print(f"Chunks generados: {count}")
print("--- Ejemplo (primer chunk) ---")
with open(OUT, encoding="utf-8") as f:
    primero = json.loads(f.readline())
    print(primero["text"])
