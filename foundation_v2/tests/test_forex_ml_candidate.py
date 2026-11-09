from copy import deepcopy
from decimal import Decimal as D
import math
import unittest

from trading_workspace_v2.forex_h4 import Candle, HOUR
from trading_workspace_v2.forex_ml_candidate import (
    FEATURE_NAMES, ML_CANDIDATES, MLH1Candidate, features, predict, validate_model)


def bars(count=100):
    return [Candle((i+1)*HOUR,D('1.1')+D(i)/100000,
        D('1.101')+D(i)/100000,D('1.099')+D(i)/100000,D('1.1')+D(i)/100000)
        for i in range(count)]


def pack():
    return dict(schema='forex-ml-h1-pack-v1',candidate=ML_CANDIDATES[0],feature_names=list(FEATURE_NAMES),
        folds=[dict(cutoff=101*HOUR,available_from=102*HOUR,train_start=0,train_rows=100,
            last_label_endpoint_msc=100*HOUR*1000,model=dict(kind='ridge',mean=[0]*21,
            scale=[1]*21,coef=[[0]*21,[0]*21],intercept=[.3,-.2]))])


class MLSignalTests(unittest.TestCase):
    def test_features_hand_computed_and_causal_prefix(self):
        history=bars(102)
        x,distance=features(history[:100],D('.00002'))
        self.assertEqual(len(x),21)
        self.assertEqual(distance,D('.003'))
        self.assertAlmostEqual(x[0],.005)
        self.assertAlmostEqual(x[6],.36)
        self.assertAlmostEqual(x[7],1)
        self.assertAlmostEqual(x[-1],.01)
        history[-1]=Candle(103*HOUR,D('8'),D('9'),D('7'),D('8'))
        self.assertEqual(features(history[:100],D('.00002')),(x,distance))

    def test_no_model_before_available_and_pack_is_owned(self):
        p=pack();c=MLH1Candidate(ML_CANDIDATES[0],p)
        out=[c.observe(b)[0] for b in bars(101)]
        self.assertTrue(all(v is None for v in out[:100]))
        self.assertEqual(out[-1],'BUY')
        p['folds'][0]['model']['intercept']=[-1,1]
        self.assertEqual(c.observe(bars(102)[-1])[0],'BUY')

    def test_restore_same_pack_and_position_age_identity(self):
        p=pack();c=MLH1Candidate(ML_CANDIDATES[0],p)
        for b in bars(101):c.observe(b)
        c.observe(bars(102)[-1],side='BUY',position_id='a')
        r=MLH1Candidate.from_state(c.export_state().model_dump(mode='json'),pack=p)
        for b in bars(105)[102:]:
            self.assertEqual(c.observe(b,side='BUY',position_id='a'),r.observe(b,side='BUY',position_id='a'))
        self.assertEqual(c.held_bars,4)
        self.assertEqual(c.observe(bars(106)[-1],side='BUY',position_id='b')[0],None)
        self.assertEqual(c.held_bars,1)
        bad=deepcopy(p);bad['folds'][0]['model']['intercept'][0]=.4
        with self.assertRaisesRegex(ValueError,'pack changed'):
            MLH1Candidate.from_state(c.export_state(),pack=bad)

    def test_purge_identity_nan_and_bad_tree_rejected(self):
        p=pack();p['folds'][0]['last_label_endpoint_msc']=101*HOUR*1000
        with self.assertRaisesRegex(ValueError,'leakage'):MLH1Candidate(ML_CANDIDATES[0],p)
        with self.assertRaisesRegex(ValueError,'identity'):MLH1Candidate(ML_CANDIDATES[1],pack())
        m=pack()['folds'][0]['model'];m['scale'][0]=math.nan
        with self.assertRaises(ValueError):validate_model(m)
        for tree in ([[0,0,0,0,[0,0]]],[[0,0,1,1,[0,0]],[-2,0,-1,-1,[0,0]]]):
            with self.subTest(tree=tree),self.assertRaises(ValueError):
                validate_model(dict(kind='forest',trees=[tree]))

    def test_float32_threshold_and_negative_side_tie(self):
        m=dict(kind='forest',trees=[[[0,1.00000003,1,2,[0,0]],
            [-2,0,-1,-1,[1,2]],[-2,0,-1,-1,[3,4]]]])
        validate_model(m)
        self.assertEqual(predict(m,[1.00000004]+[0]*20),[1,2])
        p=pack();p['folds'][0]['model']['intercept']=[.2,.2]
        c=MLH1Candidate(ML_CANDIDATES[0],p)
        for b in bars(101):out=c.observe(b)
        self.assertIsNone(out[0])

    def test_observation_order_and_position_side_not_ambiguous(self):
        c=MLH1Candidate(ML_CANDIDATES[0],pack());b=bars()[0];c.observe(b)
        with self.assertRaises(ValueError):c.observe(b)
        with self.assertRaises(ValueError):c.observe(bars()[1],side='BUY')
