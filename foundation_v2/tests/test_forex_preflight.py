import json
from pathlib import Path
import sys
import logging
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from forex_h4_pilot import main, event_logger
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
            events=[json.loads(line) for line in (output/'events.jsonl').read_text().splitlines()]
            self.assertEqual(events[-1]['stage'],'preflight_passed_no_simulation')
            self.assertEqual(len({event['run_id'] for event in events}),1)
            self.assertEqual([event['event_sequence'] for event in events],list(range(1,len(events)+1)))
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

    def test_failure_records_source_locations_without_exception_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            output=root/'attempt'
            with patch('forex_h4_pilot.inspect_qdm',side_effect=ValueError('Bearer SECRET_PAYLOAD password=do-not-log')):
                with self.assertRaises(ValueError):
                    main(['--input-dir',str(root),'--output-dir',str(output),'--preflight-only'])
            failure=json.loads((output/'failure.json').read_text())
            self.assertEqual(failure['failed_stage'],'validate_warmup')
            self.assertTrue(failure['frames'])
            for name in ('failure.json','receipt.json','events.jsonl'):
                content=(output/name).read_text()
                self.assertNotIn('SECRET_PAYLOAD',content)
                self.assertNotIn('do-not-log',content)

    def test_diagnostic_rotation_is_bounded_and_does_not_change_root_logger(self):
        with tempfile.TemporaryDirectory() as directory:
            root_handlers=list(logging.getLogger().handlers)
            root=Path(directory)
            logger,handler=event_logger(root)
            handler.maxBytes=128
            try:
                for index in range(20):
                    logger.info(json.dumps(dict(sequence=index,padding='x'*40)))
            finally:
                handler.close()
                logger.removeHandler(handler)
            self.assertLessEqual(len(list(root.glob('events.jsonl*'))),3)
            self.assertEqual(logging.getLogger().handlers,root_handlers)


if __name__=='__main__':
    unittest.main()
