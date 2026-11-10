# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.2"]
# ///
"""Writes public/us-states.parquet from the Census cartographic boundary file.

The app loads it into DuckDB-Wasm (`ST_GeomFromWKB(geom_wkb)`), the same way
awii-app loads its municipality boundaries.

Usage:
    uv run scripts/make_states_parquet.py [--src cb_2023_us_state_20m.zip]
"""

import argparse
import tempfile
import urllib.request
from pathlib import Path

import duckdb

SRC_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip"
OUT = Path(__file__).resolve().parent.parent / "public" / "us-states.parquet"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", help="Local copy of the Census zip (downloaded if omitted)")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(args.src) if args.src else Path(tmp) / "states.zip"
        if not args.src:
            urllib.request.urlretrieve(SRC_URL, src)
        con = duckdb.connect()
        con.sql("INSTALL spatial; LOAD spatial;")
        OUT.parent.mkdir(exist_ok=True)
        con.sql(f"""
            COPY (
              SELECT STATEFP::INTEGER AS id, STUSPS AS abbrev, NAME AS name,
                     ST_AsWKB(ST_MakeValid(geom)) AS geom_wkb
              FROM ST_Read('/vsizip/{src}/cb_2023_us_state_20m.shp')
              ORDER BY id
            ) TO '{OUT}' (FORMAT parquet, COMPRESSION zstd)
        """)
        print(con.sql(f"SELECT count(*) AS states FROM '{OUT}'"))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
