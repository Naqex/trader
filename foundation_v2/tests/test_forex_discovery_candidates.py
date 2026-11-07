from copy import deepcopy
from decimal import Decimal as D
from pathlib import Path
import sys,tempfile,unittest
import contextlib,hashlib,io,json
from unittest.mock import patch

sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[1]/'scripts')]
from trading_workspace_v2.forex_h4 import Candle,H4
from trading_workspace_v2.forex_discovery_candidates import (
    FAILED20,COMPRESSION,RANGE_FADE,DISCOVERY_CANDIDATES,DiscoveryH4Candidate,DiscoveryH4State)
from trading_workspace_v2.replay_tick_execution import BrokerReplayTick
import forex_h4_pilot as pilot
from forex_signal_screen import probe
import forex_signal_screen as screen

START=1641168000
def bar(i,close='1.10000',low='1.09900',high='1.10100'):
    return Candle(START+i*H4,D(close),D(high),D(low),D(close))
def warm(kind):
    result=DiscoveryH4Candidate(kind)
    for i in range(-81,0):result.observe(bar(i))
    return result


class DiscoveryTests(unittest.TestCase):
    def test_failed_level_rejection_both_sides_equality_and_double_sweep(self):
        for close,low,high,signal in [('1.0995','1.098','1.100','BUY'),('1.1005','1.100','1.102','SELL'),
                                    ('1.099','1.098','1.100',None),('1.100','1.098','1.102',None)]:
            with self.subTest(signal=signal):
                strategy=warm(FAILED20)
                self.assertEqual(strategy.observe(bar(0,close,low,high))[0],signal)
        # The signal candle's new low is not included in the prior-level oracle.
        strategy=warm(FAILED20)
        self.assertEqual(strategy.observe(bar(0,'1.0995','1.098','1.100'))[0],'BUY')
        self.assertEqual(strategy.observe(bar(1,'1.1002'),side='BUY',position_id='p1')[0],'EXIT')

    def test_compression_prior_ranges_and_both_directions(self):
        for close,side in [('1.102','BUY'),('1.098','SELL')]:
            strategy=DiscoveryH4Candidate(COMPRESSION)
            for i in range(-24,0):
                strategy.observe(bar(i,low='1.095' if i<-6 else '1.099',high='1.105' if i<-6 else '1.101'))
            self.assertEqual(strategy.observe(bar(0,close,low='1.097',high='1.103'))[0],side)
        self.assertIsNone(warm(COMPRESSION).observe(bar(0,'1.102',high='1.103'))[0])

    def test_fade_day_latch_missing_range_symmetric_rejection(self):
        for close,low,high,side in [('1.0995','1.098','1.100','BUY'),('1.1005','1.100','1.102','SELL')]:
            strategy=warm(RANGE_FADE)
            strategy.observe(bar(0));strategy.observe(bar(1))
            self.assertEqual(strategy.observe(bar(2,close,low,high))[0],side)
            restored=DiscoveryH4Candidate.from_state(strategy.export_state())
            self.assertIsNone(restored.observe(bar(3,close,low,high))[0])
            self.assertEqual(restored.observe(bar(4),side=side,position_id='p')[0],'EXIT')
        strategy=warm(RANGE_FADE);strategy.observe(bar(0))
        self.assertIsNone(strategy.observe(bar(2,'1.0995','1.098','1.100'))[0])
        strategy=warm(RANGE_FADE);strategy.observe(bar(0));strategy.observe(bar(1))
        self.assertIsNone(strategy.observe(bar(2,'1.100','1.098','1.102'))[0])

    def test_held_bars_reset_identity_missing_bar_and_roundtrip(self):
        strategy=warm(FAILED20)
        for i in (0,1,3,4,5):
            self.assertIsNone(strategy.observe(bar(i,'1.0992','1.099','1.100'),side='BUY',position_id='p')[0])
        restored=DiscoveryH4Candidate.from_state(DiscoveryH4State.model_validate_json(strategy.export_state().model_dump_json()))
        self.assertEqual(restored.observe(bar(6,'1.0992','1.099','1.100'),side='BUY',position_id='p')[0],'EXIT')
        self.assertIsNone(strategy.observe(bar(6,'1.0992','1.099','1.100'),side='BUY',position_id='new')[0])
        self.assertEqual(strategy.held_bars,1)

    def test_invalid_inputs_are_atomic_and_prefix_is_causal(self):
        for kind in DISCOVERY_CANDIDATES:
            strategy=warm(kind);before=strategy.export_state()
            for value,args in [(bar(-1),{}),(bar(0),dict(side='BUY')),(bar(0),dict(side='BUY',position_id=' '))]:
                with self.assertRaises(ValueError):strategy.observe(value,**args)
                self.assertEqual(strategy.export_state(),before)
            bad=before.model_dump(mode='json');bad['atr']=None
            with self.assertRaises(ValueError):DiscoveryH4State.model_validate(bad)
            first=warm(kind);second=warm(kind)
            prefix=[bar(i) for i in range(12)]
            self.assertEqual([first.observe(c) for c in prefix],[second.observe(c) for c in prefix])
            second.observe(bar(12,'1.2',low='1.19',high='1.21'))
            self.assertEqual(first.export_state().history[-1].timestamp,prefix[-1].timestamp)

    def test_probe_has_no_portfolio_and_is_not_a_trade_count(self):
        warmup=[bar(i) for i in range(-81,0)]
        bars=[bar(0),bar(1),bar(2,'1.0995','1.098','1.100'),bar(3,'1.0995','1.098','1.100')]
        result=probe(RANGE_FADE,warmup,bars)
        self.assertEqual(result['flat_entry_opportunities'],1)
        self.assertEqual(result['reason'],'eligible_for_tick_review')
        self.assertFalse(result['portfolio_simulated'])
        self.assertNotIn('profit',result)
        self.assertEqual(probe(RANGE_FADE,warmup,[bar(0)])['reason'],'no_entry_opportunities_in_window')

    def test_screen_cli_binds_cache_protocol_sources_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);protocol=root/'protocol.md';protocol.write_text('Synthetic fixture only')
            manifest=root/'inputs.json'
            manifest.write_text(json.dumps(dict(schema='forex-h4-inputs-v1',
                warmup=dict(path=str(root/'warm.csv'),sha256='a'*64,first_day='20211201',last_day='20211231'),
                development=dict(path=str(root/'eval.csv'),sha256='b'*64,first_day='20220103',last_day='20220331'))))
            output=root/'screen.json'
            args=['--input-manifest',str(manifest),'--inspection-cache-dir',str(root/'cache'),
                '--protocol',str(protocol),'--output',str(output),'--candidate',RANGE_FADE]
            bars=[bar(0),bar(1),bar(2,'1.0995','1.098','1.100')]
            with patch.object(screen,'load_inspection',side_effect=[({'ticks':81},[bar(i) for i in range(-81,0)]),
                                                                    ({'ticks':100},bars)]),contextlib.redirect_stdout(io.StringIO()):
                screen.main(args)
            result=json.loads(output.read_bytes())
            self.assertEqual(result['protocol_sha256'],hashlib.sha256(protocol.read_bytes()).hexdigest())
            self.assertFalse(result['portfolio_simulated']);self.assertFalse(result['promotion_authorized'])
            self.assertEqual(result['rows'][0]['flat_entry_opportunities'],1)
            original=output.read_bytes()
            with self.assertRaises(FileExistsError):screen.main(args)
            self.assertEqual(output.read_bytes(),original)

    def test_new_candidates_run_native_tick_accounting_and_state_roundtrip(self):
        ticks=[BrokerReplayTick(time_msc=pilot.START+i*3600000+1,sequence=i+1,
            bid='1.09900' if i%24<8 else '1.09800',ask='1.09920' if i%24<8 else '1.09820') for i in range(48)]
        for kind in DISCOVERY_CANDIDATES:
            with tempfile.TemporaryDirectory() as directory,patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks)):
                result=pilot.run_scenario(Path('unused'),[bar(i) for i in range(-81,0)],'reference',D(0),D(0),
                    Path(directory),lambda *args:None,research_candidate=kind)
                self.assertEqual(result['independent_accounting'],'passed')
                self.assertEqual(result['candidate_state_roundtrip'],'passed')


if __name__=='__main__':unittest.main()
