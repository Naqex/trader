"""Offline installed-file identity fixtures; never executes a scientific job."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from rust_runtime_adapter_bootstrap import dependency_tree, dependency_digest, validate_import_paths


class ScientificDependencies(unittest.TestCase):
    def test_every_installed_byte_including_compiled_and_cached_code_is_pinned(self):
        with tempfile.TemporaryDirectory(prefix='scientific-pins-') as temporary:
            root = Path(temporary)
            names = {'python312.dll': b'runtime', 'Lib/site-packages/transitive/core.pyd': b'compiled',
                     'Lib/site-packages/transitive/.libs/dependency.dll': b'linked',
                     'Lib/site-packages/transitive/cache.pyc': b'bytecode'}
            for name, data in names.items():
                target = root/name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            initial = dependency_tree(root)
            self.assertEqual(initial['file_count'], 4)
            self.assertEqual(initial['total_bytes'], sum(map(len, names.values())))
            self.assertEqual(initial['sha256'], 'd3bf01aac1a0b6d95a5b88a0f5fdf89a090e0b52afff56fe8c7d3bf70f8b4d65')
            for name, original in names.items():
                with self.subTest(changed=name):
                    (root/name).write_bytes(b'modified')
                    self.assertNotEqual(initial, dependency_tree(root))
                    (root/name).write_bytes(original)
            (root/'injected.pth').write_bytes(b'import unsafe')
            self.assertNotEqual(initial, dependency_tree(root))
            (root/'injected.pth').unlink()
            (root/'python312.dll').unlink()
            self.assertNotEqual(initial, dependency_tree(root))

    def test_rejects_file_roots_symlinks_and_parent_junctions(self):
        with tempfile.TemporaryDirectory(prefix='scientific-link-') as temporary:
            root = Path(temporary)
            (root/'file').write_text('x')
            with self.assertRaises(ValueError):
                dependency_tree(root/'file')
            linked = root/'linked'
            import os
            if os.name == 'nt':
                result = subprocess.run(['cmd', '/C', 'mklink', '/J', str(linked), str(root)], capture_output=True)
                self.assertEqual(result.returncode, 0)
                try:
                    with self.assertRaisesRegex(ValueError, 'links'):
                        dependency_tree(root)
                    with self.assertRaisesRegex(ValueError, 'links'):
                        dependency_tree(linked)
                finally:
                    linked.rmdir()
            else:
                linked.symlink_to(root/'file')
                with self.assertRaisesRegex(ValueError, 'links'):
                    dependency_tree(root)

    def test_fixed_budgets_and_canonical_manifest_digest(self):
        with tempfile.TemporaryDirectory(prefix='scientific-budget-') as temporary:
            root = Path(temporary)
            (root/'file').write_bytes(b'payload')
            with patch('rust_runtime_adapter_bootstrap.MAX_BYTES', 2), self.assertRaisesRegex(ValueError, 'byte budget'):
                dependency_tree(root)
            with patch('rust_runtime_adapter_bootstrap.MAX_FILES', 1), self.assertRaisesRegex(ValueError, 'file budget'):
                dependency_tree(root)
        trees = {'engine_runtime': {'path': 'C:/fixture/é', 'sha256': 'a'*64, 'file_count': 1, 'total_bytes': 2},
                 'base_python': {'path': 'C:/python', 'sha256': 'b'*64, 'file_count': 2, 'total_bytes': 3}}
        expected = hashlib.sha256((json.dumps(trees, sort_keys=True, separators=(',', ':'))+'\n').encode()).hexdigest()
        self.assertEqual(dependency_digest(trees), expected)
        changed = copy.deepcopy(trees)
        changed['engine_runtime']['file_count'] += 1
        self.assertNotEqual(dependency_digest(changed), expected)

    def test_external_import_paths_are_rejected_and_runtime_shadow_modules_are_pinned(self):
        with tempfile.TemporaryDirectory(prefix='scientific-path-') as temporary:
            root = Path(temporary)
            runtime = root/'engine_runtime'
            base = root/'python'
            runtime.mkdir()
            base.mkdir()
            (runtime/'run.py').write_bytes(b'entry')
            (base/'python.exe').write_bytes(b'executable')
            validate_import_paths([str(runtime), str(base/'python312.zip')], runtime, base)
            for paths in [[str(root/'external')], [''], []]:
                with self.assertRaisesRegex(ValueError, 'outside pinned'):
                    validate_import_paths(paths, runtime, base)
            before = dependency_tree(runtime)
            (runtime/'decimal.py').write_bytes(b'import shadowed')
            self.assertNotEqual(before, dependency_tree(runtime))


if __name__ == '__main__':
    unittest.main()
