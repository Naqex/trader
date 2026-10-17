"""Inspect installed Node provider files; never installs or calls a provider."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil


def dependency_digest(root):
    root = Path(root)
    files = []
    def regular(path, directory=False):
        stat = path.lstat()
        if path.is_symlink() or getattr(stat, 'st_file_attributes', 0) & 0x400:
            raise ValueError('provider dependency links are unsupported')
        if not (path.is_dir() if directory else path.is_file()):
            raise ValueError('provider dependency type is invalid')
    regular(root, True)
    for name in ('package.json', 'package-lock.json'):
        file = root/name
        regular(file)
        files.append(file)
    modules = root/'node_modules'
    regular(modules, True)
    for folder, dirs, names in os.walk(modules, followlinks=False):
        for name in dirs:
            regular(Path(folder)/name, True)
        for name in names:
            file = Path(folder)/name
            regular(file)
            files.append(file)
            if len(files) > 8192:
                raise ValueError('provider dependency file budget exceeded')
    digest = hashlib.sha256()
    total = 0
    for file in sorted(files, key=lambda p: p.relative_to(root).as_posix()):
        total += file.stat().st_size
        if total > 64*1024*1024:
            raise ValueError('provider dependency byte budget exceeded')
        name = file.relative_to(root).as_posix().encode('utf-8')
        content = hashlib.sha256()
        with file.open('rb') as source:
            for chunk in iter(lambda: source.read(65536), b''):
                content.update(chunk)
        digest.update(len(name).to_bytes(8, 'little'))
        digest.update(name)
        digest.update(content.digest())
    return digest.hexdigest()


def inspect_adapter(root, node):
    root = Path(root).resolve(strict=True)
    node = Path(node).resolve(strict=True)
    worker = root/'index.mjs'
    return dict(TW_V2_DUKASCOPY_NODE=str(node), TW_V2_DUKASCOPY_NODE_SHA256=hashlib.sha256(node.read_bytes()).hexdigest(),
        TW_V2_DUKASCOPY_WORKER=str(worker), TW_V2_DUKASCOPY_WORKER_SHA256=hashlib.sha256(worker.read_bytes()).hexdigest(),
        TW_V2_DUKASCOPY_DEPENDENCIES_SHA256=dependency_digest(root))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1]/'data_worker')
    parser.add_argument('--node', type=Path, default=shutil.which('node'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    value = inspect_adapter(args.root, args.node)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'output':str(args.output.resolve()), 'dependency_sha256':value['TW_V2_DUKASCOPY_DEPENDENCIES_SHA256']}))


if __name__ == '__main__':
    main()
