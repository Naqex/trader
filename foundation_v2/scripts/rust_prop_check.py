"""Run pure Prop parity independently of concurrent API module edits."""
from pathlib import Path
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
API = ROOT/'foundation_v2/api-rust'
work = Path(tempfile.gettempdir())/'rust_prop_check-mt5-20261017'
(work/'src').mkdir(parents=True,exist_ok=True)
(work/'tests').mkdir(exist_ok=True)
(work/'Cargo.toml').write_text('''[package]
name = "trading-workspace-api"
version = "0.0.0"
edition = "2024"
[dependencies]
bigdecimal = "=0.4.10"
num-bigint = "0.4"
chrono = { version = "0.4", features = ["serde"] }
chrono-tz = "=0.10.4"
serde_json = "1"
sha2 = "0.10"
''',encoding='utf-8')
(work/'src/lib.rs').write_text(f'#[path = {str(API / "src/prop_core.rs").replace(chr(92), "/")!r}]\npub mod prop_core;\n'.replace("'",'"'),encoding='utf-8')
test=(API/'tests/rust_prop_differential.rs').read_text(encoding='utf-8')
fixture=ROOT/'foundation_v2/evidence/rust-native-20261017/prop/fixtures.json'
test=test.replace('../../evidence/rust-native-20261017/prop/fixtures.json',fixture.as_posix())
test=test.replace('../../evidence/rust-native-20261017/prop/decimal-scale-fixtures.json',(fixture.parent/'decimal-scale-fixtures.json').as_posix())
(work/'tests/rust_prop_differential.rs').write_text(test,encoding='utf-8')
print(f'Pure harness: {work}',flush=True)
raise SystemExit(subprocess.run(['cargo','test','--offline','--manifest-path',str(work/'Cargo.toml'),'--test','rust_prop_differential','--','--nocapture'],env=os.environ).returncode)
