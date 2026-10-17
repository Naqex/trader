"""Alternating buffered/streaming provider publication on owned synthetic files."""
import argparse,hashlib,json,math,os,platform,statistics,subprocess,tempfile,time
from pathlib import Path
from rust_replay_scaling_benchmark import process_resources

V2=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--rows',default='50003,420003');parser.add_argument('--samples',type=int,default=3)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    counts=[int(v) for v in args.rows.split(',')]
    assert 1<=args.samples<=10 and all(2<=v<=1000000 for v in counts)
    build=subprocess.run(['cargo','test','--locked','--release','--lib','--no-run','--message-format=json'],cwd=V2/'api-rust',capture_output=True,text=True,encoding='utf-8')
    (args.output/'build.jsonl').write_text(build.stdout,encoding='utf-8');(args.output/'build.log').write_text(build.stderr,encoding='utf-8')
    if build.returncode:raise RuntimeError('probe build failed; inspect build.log')
    messages=[json.loads(line) for line in build.stdout.splitlines() if line.startswith('{')]
    executable=next(Path(m['executable']) for m in messages if m.get('reason')=='compiler-artifact' and m.get('executable') and m['profile']['test'] and 'lib' in m['target']['kind'])
    samples=[]
    with tempfile.TemporaryDirectory(prefix='tw-provider-bench-') as folder:
        root=Path(folder)
        for count in [2000,*counts]:
            with (root/'candles.csv').open('w',encoding='utf-8',newline='') as source:
                source.write('time,open,high,low,close,volume\n')
                for i in range(count):source.write(f'{i*60},1,2,0,1.23456,{i%17}\n')
            for repeat in range(1 if count==2000 else args.samples):
                order=['buffered','streamed'] if repeat%2==0 else ['streamed','buffered']
                for mode in order:
                    label=f'{count}-{repeat}-{mode}';output=args.output/f'{label}.json';log=args.output/f'{label}.log'
                    env={**os.environ,'TW_PROVIDER_BENCH_ROOT':str(root),'TW_PROVIDER_BENCH_MODE':mode,'TW_PROVIDER_BENCH_OUTPUT':str(output.resolve())}
                    with log.open('w',encoding='utf-8') as stream:
                        started=time.perf_counter()
                        process=subprocess.Popen([str(executable),'--exact','provider_routes::execution::tests::publication_resource_probe','--ignored','--nocapture'],cwd=V2/'api-rust',env=env,stdout=stream,stderr=stream,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                        peak_rss=peak_commit=0;cpu_ns=0
                        while process.poll() is None:
                            try:
                                stats=process_resources(process._handle)
                                peak_rss=max(peak_rss,stats['peak_rss_bytes']);peak_commit=max(peak_commit,stats['private_commit_bytes'])
                                cpu_ns=max(cpu_ns,stats['cpu_kernel_ns']+stats['cpu_user_ns'])
                            except OSError:pass
                            time.sleep(.01)
                        wall_ms=(time.perf_counter()-started)*1000
                    if process.returncode:raise RuntimeError(f'probe failed: {label}; inspect log')
                    sample=json.loads(output.read_text(encoding='utf-8'))
                    sample.update(sample=repeat,warmup=count==2000,peak_rss_bytes=peak_rss,peak_private_commit_bytes=peak_commit,cpu_ms=cpu_ns/1e6,wall_ms=wall_ms,raw_bytes=(root/'candles.csv').stat().st_size)
                    samples.append(sample)
                    (args.output/'samples.json').write_text(json.dumps(samples,indent=2),encoding='utf-8')
                    print(json.dumps(dict(rows=count,mode=mode,total_ms=sample['total_ms'],peak_rss_mib=peak_rss/1024**2)),flush=True)
            selected=[s for s in samples if s['row_count']==count]
            assert all((s['preview'],s['raw_sha256'],s['artifact_sha256'])==(selected[0]['preview'],selected[0]['raw_sha256'],selected[0]['artifact_sha256']) for s in selected),'identity changed across modes/repeats'
    summaries=[]
    for count in counts:
        for mode in ['buffered','streamed']:
            selected=[s for s in samples if s['row_count']==count and s['mode']==mode and not s['warmup']]
            summary=dict(rows=count,mode=mode,samples=len(selected))
            for key in ['total_ms','preparation_ms','publication_ms','wall_ms','cpu_ms','peak_rss_bytes','peak_private_commit_bytes']:
                values=sorted(s[key] for s in selected);summary[key]=dict(median=statistics.median(values),sample_p95=values[math.ceil(len(values)*.95)-1])
            summaries.append(summary)
    receipt=dict(passed=True,scope='owned synthetic full CSV preparation and immutable publication; no PG/provider/network/UI; small diagnostic sample tails',platform=platform.platform(),processor=platform.processor(),probe_sha256=hashlib.sha256(executable.read_bytes()).hexdigest(),summaries=summaries,source_hashes={str(p.relative_to(V2)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [V2/'api-rust/src/artifact_data.rs',V2/'api-rust/src/data_routes.rs',V2/'api-rust/src/data_routes/ingest.rs',V2/'api-rust/src/provider_routes/execution.rs',V2/'api-rust/src/provider_routes/publication.rs']})
    (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(dict(passed=True,samples=len(samples))),flush=True)
if __name__=='__main__':main()
