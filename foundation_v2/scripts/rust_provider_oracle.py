"""Source-local provider parity fixtures; no provider process/network is started."""
from copy import deepcopy
import json
import hashlib
from pathlib import Path
import sys

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]
from trading_workspace_v2.qdm_cli import parse_catalog
from trading_workspace_v2.dukascopy_catalog import normalize_instruments
from trading_workspace_v2.replay_instrument import replay_instrument_spec


def main():
    cases = []
    def add(kind, body, function):
        case = {'kind': kind, 'body': body}
        try:
            result = function(body)
            case['expected'] = result
        except (ValueError, TypeError, KeyError):
            case['error'] = True
        cases.append(case)
    rows = [
        ['XAUUSD', 'Gold', 'Forex', 'Metals', '01.01.2000', '01.01.2003'],
        ['EURUSD', 'Euro / US Dollar', 'Forex', 'Majors', '01.01.2000', '01.01.2003'],
        ['ABC', 'Société “Exemple”', 'Stocks', 'US', '01.01.2000', '01.01.2003'],
    ]
    def encoded(rows, codec='utf8'):
        return ('\n'.join(';'.join(row + [''] * (12-len(row))) for row in rows)).encode(codec)
    for codec in ['utf8', 'utf-8-sig', 'cp1252']:
        raw = encoded(rows, codec)
        add('qdm', list(raw), lambda b: list(parse_catalog(bytes(b)).items()))
    for category, group in [('Commodities','Energy'), ('Commodities','Metals'), ('Commodities','Soft'), ('Indices','Any'), ('Crypto','Any'), ('Bond','Any')]:
        row = ['ABC','Name',category,group,'1.1.2000','2.2.2001']
        add('qdm', list(encoded([row])), lambda b: list(parse_catalog(bytes(b)).items()))
    for bad in [b'', b'BAD;row', encoded(rows + [rows[0]]), encoded([['abc','Bad','Forex','Any','01.01.2000','01.01.2001']]), encoded([['ABC','Bad','Unknown','Any','01.01.2000','01.01.2001']]), encoded([['ABC','Bad','Forex','Any','31.02.2000','01.01.2001']])]:
        add('qdm',list(bad),lambda b:list(parse_catalog(bytes(b)).items()))
    base={'groups':[{'id':1,'code':'FX','parentId':None},{'id':2,'code':'FX_METALS','parentId':1}], 'instruments':[{'name':'xau/usd','code':'xauusd','description':'Gold','groupId':2,'pipValue':.01,'priceScale':3},{'name':'EUR/USD','code':'eurusd','description':'Euro €','groupId':1,'pipValue':.0001,'priceScale':5}]}
    add('dukascopy',base,normalize_instruments)
    snapshot={'version':2,'source':'https://jetta.dukascopy.com/v1/instruments','retrieved_at_utc':'2026-01-01T00:00:00+00:00','raw_catalog':base,'sha256':hashlib.sha256(json.dumps(normalize_instruments(base),sort_keys=True).encode()).hexdigest()}
    cache_output=V2/'api-rust/tests/rust_provider/cache.json'
    cache_output.parent.mkdir(exist_ok=True)
    cache_output.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf8')
    for field,value in [('pipValue',True),('pipValue',0),('priceScale',True),('priceScale',13),('groupId','1'),('code','bad/code'),('name','bad name')]:
        sample=deepcopy(base);sample['instruments'][0][field]=value
        add('dukascopy',sample,normalize_instruments)
    for field,value in [('instruments',[]),('groups',[{'id':1,'code':'FX','parentId':1}]),('groups',[{'id':True,'code':'FX'}]),('groups',[{'id':1,'code':'FX'},{'id':1,'code':'FX'}])]:
        sample=deepcopy(base);sample[field]=value
        add('dukascopy',sample,normalize_instruments)
    for symbol in ['EUR/USD','USD/JPY','XAU/USD','XAG/USD','EURUSD','eur/usd','ABC/DEF','EUR//USD','!UR/USD','']:
        for stamp in [0,1700000000,-1,None]:
            add('instrument',{'instrument_id':symbol,'first_timestamp':stamp},replay_instrument_spec)
    output=V2/'api-rust/tests/rust_provider/oracle.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'cases':len(cases),'output':str(output),'network':False,'provider_execution':False}))

if __name__=='__main__': main()
