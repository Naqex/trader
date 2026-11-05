import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from forex_h4_pilot import main
from test_forex_prop_candidates import candle


class PreflightTests(unittest.TestCase):
    def test_preflight_validates_and_exits_without_trade_simulation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            protocol=root/'protocol.md'
            protocol.write_text('Registered fixture')
            output=root/'attempt'
            quality=dict(ticks=100,complete_h4=81)
            with patch('forex_h4_pilot.inspect_qdm', return_value=(quality,[candle(i) for i in range(81)])) as inspect, \
                 patch('forex_h4_pilot.run_scenario') as simulate:
                main(['--input-dir',str(root),'--output-dir',str(output),'--preflight-only'])
            self.assertEqual(inspect.call_count,2)
            simulate.assert_not_called()
            self.assertFalse((output/'results.json').exists())
            self.assertEqual(json.loads((output/'receipt.json').read_text())['stage'],'preflight_passed_no_simulation')
            self.assertEqual(json.loads((output/'manifest.json').read_text())['execution_mode'],'preflight_only_no_simulation')
            # An existing attempt is never silently overwritten by preflight.
            with self.assertRaises(FileExistsError):
                main(['--input-dir',str(root),'--output-dir',str(output),'--preflight-only'])

    def test_missing_warmup_stops_before_simulation_and_retains_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            output=root/'attempt'
            with patch('forex_h4_pilot.inspect_qdm', return_value=({},[])), \
                 patch('forex_h4_pilot.run_scenario') as simulate:
                with self.assertRaisesRegex(ValueError,'warmup'):
                    main(['--input-dir',str(root),'--output-dir',str(output),'--preflight-only'])
            simulate.assert_not_called()
            self.assertEqual(json.loads((output/'receipt.json').read_text())['stage'],'failed')


if __name__=='__main__':
    unittest.main()
