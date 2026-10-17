"""Generate offline differential oracles from the retained Python implementation."""
from __future__ import annotations
import json
import copy
import sys
from datetime import datetime, timezone, time
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / 'foundation_v2'), str(ROOT / 'foundation_v2/tests')]
from test_ps02_prop_lifecycle import context, event, multi_phase_context, phase_spec
from trading_workspace_v2.prop_session import (
    MoneyOracleInput, TransitionIntent, calendar_oracle, money_oracle,
    evaluate_prop_lifecycle_event, apply_prop_lifecycle_command, apply_transition_intent,
)
from trading_workspace_v2.paper_accounting import PaperAccountState, PaperOrderIntent, PaperFillReceipt, apply_paper_receipt, reconcile_paper_account
from trading_workspace_v2.prop_replay import validate_replay_prop_binding, replay_mark_to_prop_event, validate_replay_prop_transition_boundary, validate_replay_prop_transition_result, validate_replay_prop_branch_checkpoint
from trading_workspace_v2.prop_report import build_prop_attempt_report, prop_attempt_report_csv
from trading_workspace_v2.replay_execution import ReplayExecutionEvent, ReplayExecutionSnapshot
from test_ps02_replay_prop_connection import prop_state, instrument_mapping, cost_mapping, DATASET_SHA, BASE_TIME

def clean(value):
    if hasattr(value, 'model_dump'):
        return value.model_dump(mode='json')
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [clean(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value

cases = []
def add(name, op, args, call):
    try:
        case = {'name': name, 'op': op, 'args': clean(args), 'expected': clean(call())}
    except ValueError as exc:
        case = {'name': name, 'op': op, 'args': clean(args), 'error': str(exc)}
    cases.append(case)

for kind, granularity in [('static', None), ('trailing', 'intraday'), ('trailing', 'end_of_day')]:
    for basis in ['balance', 'equity']:
        for comparator in ['lt', 'lte']:
            p = phase_spec(overall_kind=kind, trailing_granularity=granularity, overall_basis=basis, overall_comparator=comparator)
            for balance in ['89999.99', '90000', '95000', '100000', '110000.125']:
                v = MoneyOracleInput(initial_capital='100000', daily_anchor='100000', balance_before_separate_costs=balance, floating_pl='-0.125', high_water_mark='110000', fees='2.25', swap='0.5', accounting='costs_separate')
                add(f'money-{kind}-{basis}-{comparator}-{balance}', 'money', [p,v], lambda p=p,v=v:money_oracle(p,v))

for zone in ['UTC','Europe/Prague','America/New_York','Australia/Lord_Howe','Pacific/Apia']:
    for month,day in [(3,7),(3,28),(10,24),(11,1)]:
        p=phase_spec().model_copy(update={'reset_timezone':zone,'reset_local_time':time(2,30)})
        start=datetime(2026,month,day,tzinfo=timezone.utc)
        end=start.replace(day=day+2)
        args={'virtual_start_utc':start,'previous_virtual_utc':start,'current_virtual_utc':end,'qualifying_local_dates':[]}
        add(f'calendar-{zone}-{month}-{day}','calendar',[p,args],lambda p=p,args=args:calendar_oracle(p,**args))

for base in ['initial_capital','daily_anchor','high_water_mark']:
    for val in ['0','7.12345678901234567890123456789','99.99999999999999999999999999']:
        p=phase_spec()
        p=p.model_copy(update={'profit_target':p.profit_target.model_copy(update={'threshold':p.profit_target.threshold.model_copy(update={'amount':None,'percent':Decimal(val),'percent_base':base})})})
        v=MoneyOracleInput(initial_capital='100000',daily_anchor='123456.78901234567890123456789',balance_before_separate_costs='100000.12345678901234567890123456789',floating_pl='-0.000000000000000000000123456789',high_water_mark='123456.9876543210987654321098765')
        add(f'precision-{base}-{val}','money',[p,v],lambda p=p,v=v:money_oracle(p,v))

for kind, granularity in [('static',None),('trailing','intraday'),('trailing','end_of_day')]:
    for order in ['fees_then_reset','reset_then_fees']:
        s,a,p=context(phase_spec(overall_kind=kind,trailing_granularity=granularity,reset_order=order))
        for balance in ['89900','95000','99900','110000']:
            for quality in ['full_for_declared_model','insufficient','approximate']:
                e=event(balance_before_separate_costs=Decimal(balance),evaluation_quality=quality)
                args=[s,a,p,e,{}]
                add(f'event-{kind}-{order}-{balance}-{quality}','event',args,lambda s=s,a=a,p=p,e=e:evaluate_prop_lifecycle_event(s,a,p,e))
        e=event(kind='calendar_boundary',virtual_time_utc=datetime(2026,1,2,tzinfo=timezone.utc),balance_before_separate_costs='100100',fees='35',swap='2',accounting='costs_separate',qualifying_day=True)
        add(f'boundary-{kind}-{order}','event',[s,a,p,e,{}],lambda s=s,a=a,p=p,e=e:evaluate_prop_lifecycle_event(s,a,p,e))

s,a,p=context()
for patch in [{'expected_revision':2},{'event_sequence':9},{'virtual_time_utc':datetime(2026,1,1,11,tzinfo=timezone.utc)},{'virtual_time_utc':datetime(2026,2,1,tzinfo=timezone.utc)},{'workspace_id':'wrong'},{'profile_hash':'sha256:wrong'},{'virtual_time_utc':datetime(2026,1,2,1,tzinfo=timezone.utc)}]:
    e=event(**patch)
    add(f'invalid-event-{len(cases)}','event',[s,a,p,e,{}],lambda e=e:evaluate_prop_lifecycle_event(s,a,p,e))
for policy in ['reset','carry_balance','carry_all']:
    s,a,p=multi_phase_context(carry_policy=policy,position_policy='carry')
    a=a.model_copy(update={'status':'phase_passed'})
    p=p.model_copy(update={'balance':Decimal('110000'),'equity':Decimal('110100'),'floating_pl':Decimal('100'),'high_water_mark':Decimal('112000'),'open_positions':1 if policy=='carry_all' else 0})
    i=TransitionIntent(workspace_id=a.workspace_id,session_id=a.session_id,attempt_id=a.attempt_id,profile_hash=a.profile_hash,intent_id='next-phase',expected_revision=a.revision,event_sequence=p.last_event_sequence,action='next_phase')
    add(f'carry-{policy}','command',[s,a,p,i,{},False],lambda s=s,a=a,p=p,i=i:apply_prop_lifecycle_command(s,a,p,i))
for status in ['ready','running','paused','phase_passed','next_phase_ready','failed_breach','completed_pass','expired','abandoned']:
    for action in ['start','pause','resume','phase_pass','next_phase','complete_pass','breach','expire','abandon']:
        aa=a.model_copy(update={'status':status})
        i=TransitionIntent(workspace_id=a.workspace_id,session_id=a.session_id,attempt_id=a.attempt_id,profile_hash=a.profile_hash,intent_id='transition-é-你好',expected_revision=a.revision,event_sequence=p.last_event_sequence,action=action)
        add(f'transition-{status}-{action}','transition',[aa,i,{}],lambda aa=aa,i=i:apply_transition_intent(aa,i,{}))

now=datetime(2026,1,1,12,tzinfo=timezone.utc)
paper=PaperAccountState(account_id='paper-é',cash='10000',updated_at_utc=now)
def paper_intent(id,side='buy',quantity='3'):
    return PaperOrderIntent(intent_id=id,account_id='paper-é',symbol='AAA',side=side,quantity=quantity,risk_budget_hash='risk-12345',created_at_utc=now,expires_at_utc=now.replace(hour=13))
def receipt(intent,id,status='filled',quantity=None,price='100',source='adapter_response'):
    return PaperFillReceipt(receipt_id=id,intent_id=intent.intent_id,intent_fingerprint=intent.fingerprint(),account_id=intent.account_id,symbol=intent.symbol,side=intent.side,status=status,filled_quantity=quantity or (intent.quantity if status=='filled' else '0'),fill_price=price if status in ['filled','partial'] else None,fee='0.25' if status in ['filled','partial'] else '0',source=source,evidence_hash='sha256:fixture',observed_at_utc=now)
buy=paper_intent('buy-1')
for status in ['filled','rejected','unknown']:
    r=receipt(buy,f'buy-{status}',status)
    add(f'paper-{status}','paper',[paper,buy,r],lambda r=r:apply_paper_receipt(paper,buy,r))
unknown_r=receipt(buy,'unknown','unknown')
unknown=apply_paper_receipt(paper,buy,unknown_r)
resolved_r=receipt(buy,'resolved',source='reconciliation')
for r in [unknown_r,resolved_r,receipt(buy,'unsafe-after-unknown')]:
    add(f'paper-unknown-{r.receipt_id}','paper',[unknown,buy,r],lambda r=r:apply_paper_receipt(unknown,buy,r))
partial_r=receipt(buy,'partial','partial','1','100.1')
partial=apply_paper_receipt(paper,buy,partial_r)
for r in [receipt(buy,'complete','filled','2','101.1'),receipt(buy,'overfill','filled','3','101'),receipt(buy,'incomplete','filled','1','101'),receipt(buy,'reject-after-partial','rejected'),partial_r]:
    add(f'paper-partial-{r.receipt_id}','paper',[partial,buy,r],lambda r=r:apply_paper_receipt(partial,buy,r))
filled=apply_paper_receipt(partial,buy,receipt(buy,'complete','filled','2','101.1'))
for q in ['1','3','4']:
    sell=paper_intent(f'sell-{q}','sell',q)
    r=receipt(sell,f'sell-{q}',price='102')
    add(f'paper-sell-{q}','paper',[filled,sell,r],lambda sell=sell,r=r:apply_paper_receipt(filled,sell,r))
for cash,positions in [(filled.cash,filled.positions),('0',()),(filled.cash,())]:
    args={'observed_cash':Decimal(cash),'observed_positions':positions,'checked_at_utc':now}
    add(f'paper-reconcile-{len(cases)}','reconcile',[filled,args],lambda args=args:reconcile_paper_account(filled,**args))

ps,pa,pp,pr=prop_state()
mark=ReplayExecutionEvent(sequence=1,kind='price_mark',replay_session_id='replay-parent',branch_id='branch-parent',dataset_id='dataset-1',dataset_sha256=DATASET_SHA,cursor_index=0,virtual_time_utc=BASE_TIME,balance='100000',floating_pl='0',equity='100000',open_positions=0,pending_orders=0,details={'intrabar_equity_coverage':'complete'})
snap=ReplayExecutionSnapshot(replay_session_id='replay-parent',branch_id='branch-parent',dataset_id='dataset-1',dataset_sha256=DATASET_SHA,instrument_spec=instrument_mapping(),cost_model=cost_mapping(),spread_price='0.0002',timeframe_seconds=60,starting_balance='100000',balance='100000',equity='100000',cursor_index=0,event_sequence=1,ledger=[mark.model_dump(mode='json')])
pr['replay_binding']={'replay_session_id':snap.replay_session_id,'branch_id':snap.branch_id,'dataset_id':snap.dataset_id,'dataset_sha256':snap.dataset_sha256,'last_replay_event_sequence':1}
for patch in [{},{'engine_version':'wrong'},{'data_version':'wrong'},{'cost_version':'wrong'}]:
    aa=pa.model_copy(update=patch)
    add(f'binding-{len(cases)}','binding',[snap,aa,pp],lambda aa=aa:validate_replay_prop_binding(snap,aa,pp))
for equity in [False,True]:
    sp,aa,ph,rs=prop_state(equity_rules=equity)
    args={'workspace_id':aa.workspace_id,'prop_session_id':aa.session_id,'prop_attempt_id':aa.attempt_id,'profile_hash':aa.profile_hash,'expected_prop_revision':1,'prop_event_sequence':1}
    for coverage in ['complete','insufficient']:
        mm=mark.model_copy(update={'details':{'intrabar_equity_coverage':coverage}})
        add(f'feed-{equity}-{coverage}','feed',[args,sp.profile.phases[0],mm],lambda args=args,sp=sp,mm=mm:replay_mark_to_prop_event(**args,phase_spec=sp.profile.phases[0],replay_event=mm))
for mutation in ['valid','missing_binding','wrong_sequence','wrong_cursor','wrong_time','wrong_money','end_of_data']:
    rs=copy.deepcopy(pr)
    ph=pp
    count=10
    if mutation=='missing_binding':rs.pop('replay_binding')
    if mutation=='wrong_sequence':rs['replay_binding']['last_replay_event_sequence']=0
    if mutation=='wrong_cursor':rs['cursor']['bar_index']=1
    if mutation=='wrong_time':rs['cursor']['timestamp_utc']='2026-01-01T00:01:00Z'
    if mutation=='wrong_money':ph=pp.model_copy(update={'balance':Decimal('100001'),'equity':Decimal('100001')})
    if mutation=='end_of_data':count=1
    payload={'dataset_id':snap.dataset_id,'branch_id':snap.branch_id,'cursor_index':snap.cursor_index,'status':'ready'}
    add(f'transition-boundary-{mutation}','transition_boundary',[snap,payload,count,pa,ph,rs,ps.profile.phases[0]],lambda rs=rs,ph=ph,count=count,payload=payload:validate_replay_prop_transition_boundary(snap,replay_payload=payload,dataset_row_count=count,attempt=pa,phase=ph,resume_state=rs,phase_spec=ps.profile.phases[0]))
    add(f'transition-result-{mutation}','transition_result',[snap,pa,ph,rs],lambda rs=rs,ph=ph:validate_replay_prop_transition_result(snap,attempt=pa,phase=ph,resume_state=rs))
child=snap.model_copy(update={'replay_session_id':'replay-child','branch_id':'branch-child'})
payload={'parent_session_id':snap.replay_session_id,'branch_id':child.branch_id,'cursor_index':child.cursor_index,'parent_checkpoint_event_sequence':1}
for mutation in ['valid','wrong_parent','wrong_cursor','wrong_binding','wrong_money']:
    pl=copy.deepcopy(payload);rs=copy.deepcopy(pr);ph=pp
    if mutation=='wrong_parent':pl['parent_session_id']='wrong'
    if mutation=='wrong_cursor':pl['cursor_index']=1
    if mutation=='wrong_binding':rs['replay_binding']['branch_id']='wrong'
    if mutation=='wrong_money':ph=pp.model_copy(update={'balance':Decimal('100001'),'equity':Decimal('100001')})
    add(f'branch-{mutation}','branch_checkpoint',[child,pl,snap,pa,ph,rs],lambda pl=pl,rs=rs,ph=ph:validate_replay_prop_branch_checkpoint(child,child_payload=pl,parent_snapshot=snap,historical_attempt=pa,phase=ph,resume_state=rs))
for status in ['running','completed_pass','failed_breach','expired','abandoned']:
    for resume in [{},pr,{'prop_lifecycle':{'last_objectives':{'technical_status':'blocked_by_data','terminal_action':None}}},{'prop_lifecycle':{'last_objectives':{'money':{'daily_loss':{'breached':True,'current':'95000','floor':'95000','reference':'100000'},'overall_drawdown':{'breached':True,'current':'90000','floor':'90000','reference':'100000'}},'technical_status':'ready','terminal_action':'breach'}}}]:
        aa=pa.model_copy(update={'status':status,'attempt_id':'=SUM(A1:A2)'})
        report=build_prop_attempt_report(ps,aa,pp,resume)
        add(f'report-{status}-{len(cases)}','report',[ps,aa,pp,resume],lambda report=report:report)
        add(f'csv-{status}-{len(cases)}','csv',[report],lambda report=report:prop_attempt_report_csv(report))

target=ROOT/'foundation_v2/evidence/rust-native-20261017/prop/fixtures.json'
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps(cases,indent=2,ensure_ascii=True)+'\n',encoding='utf-8')
print(f'{len(cases)} cases -> {target}')
