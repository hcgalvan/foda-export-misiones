#!/usr/bin/env python3
"""gcloud falso para tests: mapea gs://bucket/ruta a la carpeta $FAKE_GCS_ROOT/bucket/ruta.
Soporta: storage cp, storage ls, storage objects describe --format=value(size).
Si existe $FAKE_GCS_FAIL, falla siempre (simula sin permisos)."""
import os, sys, shutil, glob
root = os.environ["FAKE_GCS_ROOT"]
if os.environ.get("FAKE_GCS_FAIL"):
    print("ERROR: 403 sin permisos", file=sys.stderr); sys.exit(1)
def loc(u): return os.path.join(root, u[len("gs://"):]) if u.startswith("gs://") else u
a = sys.argv[1:]
if a[:2] == ["storage", "cp"]:
    s, d = loc(a[2]), loc(a[3])
    os.makedirs(os.path.dirname(d), exist_ok=True)
    if not os.path.isfile(s): print("No such object", file=sys.stderr); sys.exit(1)
    shutil.copy(s, d)
elif a[:2] == ["storage", "ls"]:
    for p in sorted(glob.glob(loc(a[2]))): print("gs://" + os.path.relpath(p, root))
elif a[:3] == ["storage", "objects", "describe"]:
    p = loc(a[3])
    if not os.path.isfile(p): print("not found", file=sys.stderr); sys.exit(1)
    print(os.path.getsize(p))
else:
    print("comando no soportado", a, file=sys.stderr); sys.exit(2)
