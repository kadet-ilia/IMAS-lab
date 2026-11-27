"""Convert explicitly mapped, already aligned agent output CSV to external-v1.
Never infer labels, manufacture agents or silently drop/sort rows.
Usage: python convert_external_csv.py manifest.json observations.csv output.jsonl
The browser performs the full external-v1 schema and chronology checks.
"""
import argparse
import csv
import json
import math
from pathlib import Path

SCHEMA = "imas-e2-external-v1"
FIXED = ("id", "incident", "split", "time", "x", "labelTime")

def bit(value):
    if value == "":
        return None
    if value not in ("0", "1"):
        raise ValueError(f"Expected 0, 1 or empty, got {value!r}")
    return int(value)

def number(value):
    v = float(value)
    if not math.isfinite(v):
        raise ValueError("Nonfinite time")
    return v

def convert(manifest, stream):
    if manifest.get("schema") != SCHEMA or "rows" in manifest:
        raise ValueError("Manifest must be an external-v1 header without rows")
    groups, agent_ids = manifest["groups"], manifest["agentIds"]
    if not isinstance(groups, list) or not 1 <= len(groups) <= 20 or any(type(n) is not int or not 1 <= n <= 50 for n in groups):
        raise ValueError("Invalid group sizes")
    if len(agent_ids) != len(groups) or any(not isinstance(g,list) or len(g)!=n for g,n in zip(agent_ids,groups)):
        raise ValueError("Invalid agent IDs")
    agents = [a for g in agent_ids for a in g]
    if any(not isinstance(a,str) or not a.strip() for a in agents) or len(set(agents))!=len(agents) or set(agents)&set(FIXED):
        raise ValueError("Agent columns must be unique and not reserved")
    reader = csv.DictReader(stream)
    required = set(FIXED) | set(agents)
    if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or set(reader.fieldnames) != required:
        raise ValueError("CSV header must contain exactly id, incident, split, time, x, labelTime and the manifest agent IDs")
    rows = []
    for r in reader:
        try:
            if None in r or any(v is None for v in r.values()):
                raise ValueError("Column count mismatch")
            rows.append(dict(id=r["id"],incident=r["incident"],split=r["split"],time=number(r["time"]),x=bit(r["x"]),labelTime=None if r["labelTime"]=="" else number(r["labelTime"]),agents=[[bit(r[a]) for a in g] for g in agent_ids]))
            if len(rows)>50000 or len(rows)*len(agents)>10000000:
                raise ValueError("Dataset size limit")
        except (ValueError,TypeError) as e:
            raise ValueError(f"CSV line {reader.line_num}: {e}") from e
    return rows

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("manifest",type=Path);p.add_argument("csv",type=Path);p.add_argument("output",type=Path)
    a=p.parse_args()
    manifest=json.loads(a.manifest.read_text(encoding="utf-8-sig"))
    with a.csv.open(encoding="utf-8-sig",newline="") as src:
        rows=convert(manifest,src)
    # Exclusive creation: never overwrite existing source/evidence.
    with a.output.open("x",encoding="utf-8",newline="\n") as out:
        for record in [manifest,*rows]:
            out.write(json.dumps(record,ensure_ascii=False,allow_nan=False)+"\n")
    print(f"Converted {len(rows)} rows; validate external-v1 in the browser. No external evidence is asserted.")
if __name__=="__main__":
    main()
