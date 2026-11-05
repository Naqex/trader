"""Lossless prepared tick inputs shared by offline scenarios, never strategy state."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .forex_h4 import TICK, read_qdm_ticks
from .forex_qdm_inspection import _digest, _json_bytes, inspection_path
from .replay_tick_execution import BrokerReplayTick

BATCH_SIZE = 16384
SCHEMA = pa.schema([('time_msc', pa.int64()), ('sequence', pa.int64()),
                    ('bid', pa.string()), ('ask', pa.string())])


def tick_cache_paths(cache_dir, *, sha256, first_day, last_day):
    _, source = inspection_path(cache_dir, sha256=sha256, first_day=first_day, last_day=last_day)
    binding = dict(schema='forex-qdm-ticks-v1', input=source, pyarrow=pa.__version__,
                   decoder_sha256=_digest(Path(__file__)))
    key = hashlib.sha256(_json_bytes(binding)).hexdigest()
    stem = Path(cache_dir)/('ticks-'+key)
    return stem.with_suffix('.parquet'), stem.with_suffix('.json'), binding


def tick_cache_metadata(path, *, cache_dir, sha256, first_day, last_day):
    data, metadata, binding = tick_cache_paths(cache_dir, sha256=sha256, first_day=first_day, last_day=last_day)
    if _digest(Path(path)) != sha256:
        raise ValueError('QDM CSV hash mismatch')
    if not data.is_file() or not metadata.is_file():
        raise ValueError('prepared tick cache missing; prepare before dispatch')
    envelope = json.loads(metadata.read_bytes())
    payload = envelope['payload']
    if (payload['binding'] != binding
            or hashlib.sha256(_json_bytes(payload)).hexdigest() != envelope['payload_sha256']
            or type(payload['ticks']) is not int or payload['ticks'] <= 0
            or data.stat().st_size != payload['bytes'] or _digest(data) != payload['sha256']):
        raise ValueError('prepared tick cache binding, count or checksum mismatch')
    return data, metadata, payload


def prepare_ticks(path, *, cache_dir, sha256, first_day, last_day, on_progress=None):
    path = Path(path)
    data, metadata, binding = tick_cache_paths(cache_dir, sha256=sha256, first_day=first_day, last_day=last_day)
    if data.exists() or metadata.exists():
        return tick_cache_metadata(path, cache_dir=cache_dir, sha256=sha256,
                                   first_day=first_day, last_day=last_day)[2]
    data.parent.mkdir(parents=True, exist_ok=True)
    lock = metadata.with_suffix('.lock')
    with lock.open('x', encoding='utf-8') as stream:
        stream.write(str(os.getpid()))
    try:
        temporary = data.with_suffix('.parquet.tmp')
        count, first, last = 0, None, None
        columns = {name: [] for name in SCHEMA.names}
        with temporary.open('xb') as stream, pq.ParquetWriter(stream, SCHEMA,
                compression='zstd', use_dictionary=['bid', 'ask']) as writer:
            for tick in read_qdm_ticks(path, sha256=sha256, first_day=first_day, last_day=last_day):
                for name, value in zip(SCHEMA.names, (tick.time_msc, tick.sequence, str(tick.bid), str(tick.ask))):
                    columns[name].append(value)
                count += 1
                first = tick.time_msc if first is None else first
                last = tick.time_msc
                if len(columns['time_msc']) == BATCH_SIZE:
                    writer.write_table(pa.Table.from_pydict(columns, schema=SCHEMA))
                    columns = {name: [] for name in SCHEMA.names}
                    if on_progress:
                        on_progress(count)
            if columns['time_msc']:
                writer.write_table(pa.Table.from_pydict(columns, schema=SCHEMA))
        if count == 0 or _digest(path) != sha256:
            raise ValueError('empty or changed QDM input during tick preparation')
        payload = dict(binding=binding, ticks=count, first_time_msc=first, last_time_msc=last,
                       bytes=temporary.stat().st_size, sha256=_digest(temporary))
        temporary_metadata = metadata.with_suffix('.json.tmp')
        with temporary_metadata.open('xb') as stream:
            stream.write(_json_bytes(dict(payload=payload,
                payload_sha256=hashlib.sha256(_json_bytes(payload)).hexdigest())))
        temporary.rename(data)
        temporary_metadata.rename(metadata)
        if on_progress:
            on_progress(count)
        return payload
    finally:
        lock.unlink()


def read_prepared_ticks(path, *, cache_dir, sha256, first_day, last_day):
    data, _, payload = tick_cache_metadata(path, cache_dir=cache_dir, sha256=sha256,
                                         first_day=first_day, last_day=last_day)
    start = int(datetime.strptime(first_day, '%Y%m%d').replace(tzinfo=timezone.utc).timestamp())*1000
    end = int((datetime.strptime(last_day, '%Y%m%d').replace(tzinfo=timezone.utc)
               + timedelta(days=1)).timestamp())*1000
    count, first, previous = 0, None, None
    with data.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != payload['sha256']:
            raise ValueError('prepared tick content changed before read')
        stream.seek(0)
        parquet = pq.ParquetFile(stream, read_dictionary=['bid', 'ask'])
        schema = parquet.schema_arrow
        if (schema.names != SCHEMA.names or schema.field('time_msc').type != pa.int64()
                or schema.field('sequence').type != pa.int64()
                or any(not pa.types.is_dictionary(schema.field(name).type) for name in ('bid', 'ask'))
                or parquet.metadata.num_rows != payload['ticks']):
            raise ValueError('invalid prepared tick schema or count')
        for batch in parquet.iter_batches(batch_size=BATCH_SIZE, use_threads=False):
            if any(column.null_count for column in batch.columns):
                raise ValueError('prepared ticks contain nulls')
            bids, asks = batch.column(2), batch.column(3)
            bid_values = [Decimal(value) for value in bids.dictionary.to_pylist()]
            ask_values = [Decimal(value) for value in asks.dictionary.to_pylist()]
            for stamp, sequence, bid_index, ask_index in zip(batch.column(0).to_pylist(),
                    batch.column(1).to_pylist(), bids.indices.to_pylist(), asks.indices.to_pylist()):
                bid, ask = bid_values[bid_index], ask_values[ask_index]
                count += 1
                if (sequence != count or not start <= stamp < end
                        or previous is not None and stamp < previous
                        or bid <= 0 or ask < bid or bid % TICK or ask % TICK):
                    raise ValueError('prepared tick date, order or price grid invalid')
                tick = BrokerReplayTick.trusted(time_msc=stamp, sequence=sequence, bid=bid, ask=ask)
                first = stamp if first is None else first
                previous = stamp
                yield tick
    if (count, first, previous) != (payload['ticks'], payload['first_time_msc'], payload['last_time_msc']):
        raise ValueError('prepared tick coverage differs from metadata')
