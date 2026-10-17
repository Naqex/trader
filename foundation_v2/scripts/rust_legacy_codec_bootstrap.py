"""Inspect an existing installed PyArrow codec; never installs or opens datasets."""
from __future__ import annotations
import argparse,hashlib,json,sys
from pathlib import Path
import pyarrow

def inspect_codec():
    root=Path(__file__).resolve().parents[1]
    package=Path(pyarrow.__file__).resolve().parent
    files={Path(sys.executable).resolve(),Path(sys._base_executable).resolve(),root/'scripts/rust_legacy_parquet_codec.py',root/'engine_runtime/limits.py'}
    files.update(p for p in package.rglob('*') if p.is_file() and p.suffix.lower() in {'.py','.pyd','.dll','.so'})
    files.update(package.parent.glob('pyarrow-*.dist-info/METADATA'))
    files.update(Path(sys._base_executable).resolve().parent.glob('python3*.dll'))
    return dict(schema='legacy-pyarrow-codec-capability-v1',foundation_root=str(root.resolve()),executable=str(Path(sys.executable).resolve()),pyarrow_version=pyarrow.__version__,files={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)})
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    value=inspect_codec()
    if value['pyarrow_version']!='21.0.0':raise RuntimeError('legacy codec requires pinned installed PyArrow 21.0.0')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(value,sort_keys=True,separators=(',',':')),encoding='utf-8')
    print(json.dumps(dict(schema=value['schema'],files=len(value['files']),output=str(args.output.resolve()))))
if __name__=='__main__':main()
