"""Retrieve a byte-pinned official checkout without installing packages."""
from __future__ import annotations
import argparse
import io
from pathlib import Path
import urllib.request
import zipfile
from pipeline import ROOT, engine_fingerprint, read_json, sha


def main():
    p=argparse.ArgumentParser();p.add_argument('--destination',type=Path,required=True);a=p.parse_args()
    lock=read_json(ROOT/'engine-lock.json');engine=a.destination/('machine_readability_rule-'+lock['commit'])
    if engine.exists():
        assert engine_fingerprint(engine)==lock['implementation_sha256'], 'Existing engine was changed'
    else:
        with urllib.request.urlopen(lock['source_archive_url'],timeout=45) as r: raw=r.read(10*1024*1024+1)
        assert len(raw)<=10*1024*1024 and sha(raw)==lock['source_archive_sha256'], 'Archive checksum mismatch'
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for name in z.namelist():
                path=Path(name)
                if path.is_absolute() or '..' in path.parts: raise ValueError('Unsafe archive path')
            z.extractall(a.destination)
        assert engine_fingerprint(engine)==lock['implementation_sha256']
    print(engine.resolve())

if __name__=='__main__': main()
