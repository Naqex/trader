//! CSV normalization and preview identity, independent of persistence and providers.
use bigdecimal::{BigDecimal, ToPrimitive, Zero};
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, str::FromStr};

pub const TRANSFORM: &str = "u2-normalize-v3";
type R<T> = Result<T, String>;

/// Fixed numeric provider schemas never need a 64 KiB record. Bound bytes
/// before the CSV parser can grow a record allocation, including quoted lines.
pub(crate) struct ProviderCsvInput<R> {
    inner:R,
    record_bytes:usize,
    quoted:bool,
}
impl<R> ProviderCsvInput<R> {
    pub(crate) fn new(inner:R)->Self{Self{inner,record_bytes:0,quoted:false}}
}
impl<R:std::io::Read> std::io::Read for ProviderCsvInput<R> {
    fn read(&mut self,buffer:&mut [u8])->std::io::Result<usize>{
        let n=self.inner.read(buffer)?;
        for byte in &buffer[..n]{
            self.record_bytes+=1;
            if self.record_bytes>64*1024{return Err(std::io::Error::new(std::io::ErrorKind::InvalidData,"provider CSV record exceeds bound"));}
            if *byte==b'"'{self.quoted=!self.quoted;}
            if *byte==b'\n'&&!self.quoted{self.record_bytes=0;}
        }
        Ok(n)
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn canonical(v: &Value) -> String {
    let mut text = String::new();
    crate::control_routes::canonical_json(v, &mut text, true);
    text
}
fn identity(v: &Value) -> String {
    hash(canonical(v).as_bytes())
}
fn text(v: &Value) -> String {
    match v {
        Value::Null | Value::Bool(false) => String::new(),
        Value::String(s) => s.clone(),
        Value::Bool(true) => "True".into(),
        Value::Number(n) if n.as_f64() == Some(0.0) => String::new(),
        _ => v.to_string(),
    }
}
fn required(v: &Value, k: &str) -> R<String> {
    let s = text(&v[k]).trim().to_owned();
    if s.is_empty() {
        return Err(format!("{k} is required"));
    }
    Ok(s)
}
fn decimal(raw: &str, name: &str, row: usize) -> R<String> {
    if raw.len() > 512 {
        return Err(format!("row {row}: {name} exceeds decimal bounds"));
    }
    if nonfinite(raw) {
        return Err(format!("row {row}: {name} must be finite"));
    }
    let n = BigDecimal::from_str(raw.trim())
        .map_err(|_| format!("row {row}: {name} must be numeric"))?;
    if n.as_bigint_and_exponent().1.unsigned_abs() > 512 {
        return Err(format!("row {row}: {name} exceeds decimal bounds"));
    }
    let n = n
        .with_precision_round(
            std::num::NonZeroU64::new(28).unwrap(),
            bigdecimal::RoundingMode::HalfEven,
        )
        .normalized();
    Ok(if n.is_zero() {
        "0".into()
    } else {
        n.to_plain_string()
    })
}
fn nonfinite(raw: &str) -> bool {
    let s = raw
        .trim()
        .trim_start_matches(['+', '-'])
        .to_ascii_lowercase();
    s == "inf" || s == "infinity" || s.starts_with("nan") || s.starts_with("snan")
}
fn time(raw: &str, row: usize) -> R<i64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(format!("row {row}: time is required"));
    }
    if raw
        .trim_start_matches('-')
        .bytes()
        .all(|b| b.is_ascii_digit())
    {
        return raw
            .parse::<i64>()
            .ok()
            .filter(|n| *n >= 0)
            .ok_or_else(|| format!("row {row}: time must be unix seconds or ISO-8601"));
    }
    if let Ok(parsed) = DateTime::parse_from_rfc3339(raw) {
        return Ok(truncated_timestamp(parsed));
    }
    for fmt in [
        "%Y-%m-%d %H:%M:%S%.f%:z",
        "%Y-%m-%dT%H:%M:%S%.f%#z",
        "%Y-%m-%d %H:%M:%S%.f%#z",
        "%Y-%m-%dT%H:%M%#z",
        "%Y-%m-%d %H:%M%#z",
        "%Y%m%dT%H%M%S%#z",
    ] {
        if let Ok(parsed) = DateTime::<FixedOffset>::parse_from_str(raw, fmt) {
            return Ok(truncated_timestamp(parsed));
        }
    }
    let naive = NaiveDate::parse_from_str(raw, "%Y-%m-%d").is_ok()
        || [
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%dT%H:%M",
        ]
        .iter()
        .any(|fmt| NaiveDateTime::parse_from_str(raw, fmt).is_ok());
    Err(if naive {
        format!("row {row}: ISO time must include timezone")
    } else {
        format!("row {row}: time must be unix seconds or ISO-8601")
    })
}
fn truncated_timestamp(parsed: DateTime<FixedOffset>) -> i64 {
    parsed.timestamp() + i64::from(parsed.timestamp() < 0 && parsed.timestamp_subsec_nanos() > 0)
}
fn normalized_rows(bytes: &[u8]) -> R<(Vec<String>, Vec<Value>)> {
    let content = std::str::from_utf8(bytes).map_err(|_| "csv_text must be valid UTF-8")?;
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| format!("invalid CSV: {e}"))?
        .clone();
    let required = ["time", "open", "high", "low", "close"];
    let missing = required
        .iter()
        .filter(|name| !headers.iter().any(|h| h == **name))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!("missing required columns: {}", missing.join(", ")));
    }
    let columns = headers.iter().map(|s| s.trim().to_owned()).collect();
    let mut rows = vec![];
    for (index, result) in reader.records().enumerate() {
        let record = result.map_err(|e| format!("invalid CSV: {e}"))?;
        let row = index + 2;
        rows.push(normalize_record(&headers, &record, row)?);
    }
    Ok((columns, rows))
}
fn normalize_record(
    headers: &csv::StringRecord,
    record: &csv::StringRecord,
    row: usize,
) -> R<Value> {
    let value = |name: &str| {
        headers
            .iter()
            .enumerate()
            .filter(|(_, h)| *h == name)
            .map(|(i, _)| i)
            .last()
            .and_then(|i| record.get(i))
    };
    let timestamp = time(value("time").unwrap_or(""), row)?;
    let mut normalized = json!({"source_row":row,"timestamp":timestamp});
    for k in ["open", "high", "low", "close", "volume"] {
        let raw = if k == "volume" && !headers.iter().any(|h| h == k) {
            "0"
        } else {
            value(k).ok_or_else(|| format!("row {row}: {k} must be numeric"))?
        };
        normalized[k] = json!(decimal(raw, k, row)?);
    }
    let d = |k: &str| BigDecimal::from_str(normalized[k].as_str().unwrap()).unwrap();
    if d("high") < d("open").max(d("close")).max(d("low")) {
        return Err(format!("row {row}: high is below OHLC values"));
    }
    if d("low") > d("open").min(d("close")).min(d("high")) {
        return Err(format!("row {row}: low is above OHLC values"));
    }
    Ok(normalized)
}
fn parquet_row(r: &Value) -> R<Value> {
    let mut out = json!({"timestamp":r["timestamp"]});
    for k in ["open", "high", "low", "close", "volume"] {
        let n = BigDecimal::from_str(r[k].as_str().unwrap())
            .map_err(|_| "invalid normalized decimal")?
            .to_f64()
            .filter(|n| n.is_finite())
            .ok_or("normalized price exceeds finite Parquet value")?;
        out[k] = json!(n);
    }
    Ok(out)
}
fn parquet_rows(rows: &[Value]) -> R<Vec<Value>> {
    rows.iter().map(parquet_row).collect()
}
pub(super) fn stream_parquet_rows(raw: &std::path::Path, output: &std::path::Path) -> R<usize> {
    use std::io::Write;
    let file = std::fs::File::open(raw).map_err(|e| e.to_string())?;
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(file);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    let missing = ["time", "open", "high", "low", "close"]
        .into_iter()
        .filter(|k| !headers.iter().any(|h| h == *k))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!("missing required columns: {}", missing.join(", ")));
    }
    let mut output = std::io::BufWriter::new(
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .map_err(|e| e.to_string())?,
    );
    let mut count = 0;
    for (index, result) in reader.records().enumerate() {
        let record = result.map_err(|e| e.to_string())?;
        let row = parquet_row(&normalize_record(&headers, &record, index + 2)?)?;
        serde_json::to_writer(&mut output, &row).map_err(|e| e.to_string())?;
        output.write_all(b"\n").map_err(|e| e.to_string())?;
        count += 1;
    }
    if count < 2 {
        return Err("dataset requires at least two rows".into());
    }
    output
        .flush()
        .and_then(|_| output.get_ref().sync_all())
        .map_err(|e| e.to_string())?;
    Ok(count)
}

fn instrument(v: &Value) -> R<Value> {
    let mut out = json!({});
    for k in [
        "instrument_id",
        "asset_class",
        "base_ccy",
        "quote_ccy",
        "account_ccy",
        "effective_from_utc",
    ] {
        let s = required(v, k)?;
        out[k] = json!(if ["base_ccy", "quote_ccy", "account_ccy"].contains(&k) {
            s.to_uppercase()
        } else {
            s
        });
    }
    for k in [
        "tick_size",
        "pip_size",
        "contract_size",
        "quantity_min",
        "quantity_step",
    ] {
        let raw = text(&v[k]);
        if nonfinite(&raw) {
            return Err(format!("{k} must be finite"));
        }
        if raw.len() > 512 {
            return Err(format!("{k} exceeds decimal bounds"));
        }
        let n = BigDecimal::from_str(raw.trim()).map_err(|_| format!("{k} must be numeric"))?;
        if n <= BigDecimal::zero() {
            return Err(format!("{k} must be positive"));
        }
        if n.as_bigint_and_exponent().1.unsigned_abs() > 512 {
            return Err(format!("{k} exceeds decimal bounds"));
        }
        out[k] = json!(n.to_string());
    }
    out["effective_to_utc"] = json!(text(&v["effective_to_utc"]).trim());
    Ok(out)
}
fn holdout(v: &Value) -> R<Value> {
    let mode = v["mode"].as_str().unwrap_or("none");
    if mode == "none" {
        return Ok(json!({"mode":"none"}));
    }
    if mode != "metadata_only" {
        return Err("holdout content access is not allowed by this import slice".into());
    }
    let boundary = v["from_utc"]
        .as_i64()
        .or_else(|| v["from_utc"].as_bool().map(i64::from))
        .or_else(|| v["from_utc"].as_str()?.parse().ok())
        .or_else(|| {
            v["from_utc"]
                .as_f64()
                .filter(|v| v.is_finite() && *v >= i64::MIN as f64 && *v < i64::MAX as f64)
                .map(|n| n as i64)
        })
        .ok_or("metadata_only holdout requires integer from_utc")?;
    Ok(json!({"mode":mode,"from_utc":boundary}))
}

pub fn preview(body: &Value) -> R<(Value, Vec<Value>)> {
    let text = body["csv_text"].as_str().ok_or("csv_text must be text")?;
    if text.is_empty() || text.chars().count() > 10_000_000 {
        return Err("csv_text must contain 1 to 10000000 characters".into());
    }
    if text.len() > 10 * 1024 * 1024 {
        return Err("csv_text exceeds the 10 MiB import limit".into());
    }
    let instrument = instrument(&body["instrument"])?;
    let timeframe = body["timeframe_seconds"]
        .as_i64()
        .filter(|n| *n > 0 && *n <= 31536000)
        .ok_or("timeframe_seconds must be a positive integer")?;
    let holdout = holdout(&body["holdout_policy"])?;
    preview_inner(text, &body["source"], instrument, timeframe, holdout, None)
}

pub fn preview_price_only(
    text: &str,
    source: &Value,
    symbol: &str,
    timeframe: i64,
    requested_range: Option<(i64, i64)>,
) -> R<(Value, Vec<Value>)> {
    if symbol.is_empty()
        || symbol.len() > 80
        || !symbol.as_bytes()[0].is_ascii_alphanumeric()
        || symbol
            .chars()
            .any(|c| !c.is_ascii_uppercase() && !c.is_ascii_digit() && !"._/+-".contains(c))
    {
        return Err("invalid price-only instrument identifier".into());
    }
    if timeframe <= 0 {
        return Err("timeframe_seconds must be positive".into());
    }
    preview_inner(
        text,
        source,
        json!({"instrument_id":symbol,"metadata_kind":"price_only"}),
        timeframe,
        json!({"mode":"none"}),
        requested_range,
    )
}
fn preview_inner(
    text: &str,
    source: &Value,
    instrument: Value,
    timeframe: i64,
    holdout: Value,
    requested_range: Option<(i64, i64)>,
) -> R<(Value, Vec<Value>)> {
    let (columns, rows) = normalized_rows(text.as_bytes())?;
    let mut normalized = Sha256::new();
    let mut unique = BTreeSet::new();
    let mut out_of_order = 0;
    let mut previous = None;
    for row in &rows {
        let time = row["timestamp"].as_i64().unwrap();
        if previous.is_some_and(|p| time < p) {
            out_of_order += 1;
        }
        previous = Some(time);
        unique.insert(time);
        normalized.update(canonical(row).as_bytes());
        normalized.update(b"\n");
    }
    let mut gaps = vec![];
    let mut gap_count = 0;
    let mut overlaps = 0;
    previous = None;
    for t in &unique {
        if let Some(p) = previous {
            let delta = *t as i128 - p as i128;
            if delta < timeframe as i128 {
                overlaps += 1;
            }
            if delta > timeframe as i128 {
                gap_count += 1;
                if gaps.len() < 1000 {
                    gaps.push(json!({"from_utc":p,"to_utc":t,"missing_intervals":(delta/timeframe as i128-1).max(0)as i64,"classification":"unknown"}));
                }
            }
        }
        previous = Some(*t);
    }
    let first = unique.first().copied();
    let last = unique.last().copied();
    let duplicate = rows.len() - unique.len();
    let preview = finish_preview(
        source, instrument, timeframe, holdout, requested_range,
        hash(text.as_bytes()), format!("{:x}", normalized.finalize()), text.len() as u64,
        columns, rows.len(), first, last, duplicate, out_of_order, overlaps, gaps, gap_count,
    )?;
    Ok((preview, parquet_rows(&rows)?))
}

#[allow(clippy::too_many_arguments)]
fn finish_preview(
    source: &Value, instrument: Value, timeframe: i64, holdout: Value,
    requested_range: Option<(i64,i64)>, raw_hash: String, normalized_hash: String,
    raw_bytes: u64, columns: Vec<String>, count: usize, first: Option<i64>, last: Option<i64>,
    duplicate: usize, out_of_order: usize, overlaps: usize, gaps: Vec<Value>, gap_count: usize,
) -> R<Value> {
    if holdout["mode"] == "metadata_only"
        && last.is_some_and(|l| l >= holdout["from_utc"].as_i64().unwrap())
    {
        return Err("import source crosses the locked holdout boundary".into());
    }
    let mut preview = json!({"schema_version":"u2-import-preview-v2","source":source,"instrument":instrument,"timeframe_seconds":timeframe,"raw_sha256":raw_hash,"normalized_sha256":normalized_hash,"row_count":count,"unique_row_count":count-duplicate,"raw_partition":{"byte_count":raw_bytes,"schema":columns,"timezone_policy":"unix-seconds-or-explicit-offset"},"available_range":first.map(|f|json!({"from_utc":f,"to_utc":last.unwrap()})),"quality":{"duplicates":duplicate,"out_of_order":out_of_order,"overlapping_intervals":overlaps,"gaps":gaps,"gap_count":gap_count,"gap_details_truncated":gap_count>1000,"disposition":if count==0{"missing_data"}else if duplicate>0||out_of_order>0||gap_count>0||overlaps>0{"review"}else{"pass"}},"holdout_policy":holdout,"transform_version":TRANSFORM});
    if let Some((start, end)) = requested_range {
        if start >= end || first.is_some_and(|f| f < start || last.unwrap() >= end) {
            return Err("invalid requested coverage range".into());
        }
        let leading = if let Some(first) = first {
            (first - start) / timeframe
        } else {
            (end - start) / timeframe
        };
        let trailing = last
            .map(|last| ((end - last - timeframe) / timeframe).max(0))
            .unwrap_or(0);
        preview["quality"]["coverage"] = json!({"requested_from_utc":start,"requested_to_exclusive_utc":end,"leading_missing_intervals":leading,"trailing_missing_intervals":trailing,"classification":"unknown"});
        if count > 0 && (leading > 0 || trailing > 0) {
            preview["quality"]["disposition"] = json!("review");
        }
    }
    preview["preview_id"] = json!(identity(&preview));
    preview["dataset_id"] = json!(format!(
        "dataset-{}",
        identity(
            &json!({"raw_sha256":preview["raw_sha256"],"normalized_sha256":preview["normalized_sha256"],"source":preview["source"],"instrument":preview["instrument"],"timeframe_seconds":timeframe,"holdout_policy":preview["holdout_policy"],"transform_version":TRANSFORM})
        )
    ));
    Ok(preview)
}

/// Provider rows are chronological by contract. Rejecting an invalid sequence
/// lets preview/hash generation retain only one row and capped gap details.
pub(crate) fn stream_ordered_price_only(
    raw: &std::path::Path, output: &std::path::Path, source: &Value, symbol: &str,
    timeframe: i64, requested_range: (i64,i64),
) -> R<Value> {
    use std::io::{Read, Write};
    // Reuse the public price-only metadata validation before creating output.
    preview_price_only("time,open,high,low,close\n", source, symbol, timeframe, Some(requested_range))?;
    let mut file = std::fs::File::open(raw).map_err(|e|e.to_string())?;
    let mut raw_hash = Sha256::new();
    let mut bytes = 0u64;
    let mut block = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut block).map_err(|e|e.to_string())?;
        if n == 0 { break; }
        raw_hash.update(&block[..n]); bytes += n as u64;
    }
    let file = std::fs::File::open(raw).map_err(|e|e.to_string())?;
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(ProviderCsvInput::new(file));
    let headers = reader.headers().map_err(|e|e.to_string())?.clone();
    let columns = headers.iter().map(|s|s.trim().to_owned()).collect();
    if ["time","open","high","low","close"].iter().any(|k|!headers.iter().any(|h|h==*k)) {
        return Err("provider CSV columns are invalid".into());
    }
    let mut output = std::io::BufWriter::new(std::fs::OpenOptions::new()
        .write(true).create_new(true).open(output).map_err(|e|e.to_string())?);
    let mut normalized = Sha256::new();
    let (mut first, mut previous, mut count, mut gaps, mut gap_count) = (None,None,0usize,vec![],0usize);
    for (index,record) in reader.records().enumerate() {
        let row = normalize_record(&headers,&record.map_err(|e|e.to_string())?,index+2)?;
        let time = row["timestamp"].as_i64().unwrap();
        if let Some(p) = previous {
            let delta = time as i128 - p as i128;
            if delta < timeframe as i128 { return Err("provider rows overlap or are not chronological".into()); }
            if delta > timeframe as i128 {
                gap_count += 1;
                if gaps.len()<1000 { gaps.push(json!({"from_utc":p,"to_utc":time,"missing_intervals":(delta/timeframe as i128-1).max(0) as i64,"classification":"unknown"})); }
            }
        }
        first.get_or_insert(time); previous=Some(time); count+=1;
        normalized.update(canonical(&row).as_bytes()); normalized.update(b"\n");
        serde_json::to_writer(&mut output,&parquet_row(&row)?).map_err(|e|e.to_string())?;
        output.write_all(b"\n").map_err(|e|e.to_string())?;
    }
    if count<2 { return Err("dataset requires at least two rows".into()); }
    let preview=finish_preview(source,json!({"instrument_id":symbol,"metadata_kind":"price_only"}),
        timeframe,json!({"mode":"none"}),Some(requested_range),format!("{:x}",raw_hash.finalize()),
        format!("{:x}",normalized.finalize()),bytes,columns,count,first,previous,0,0,0,gaps,gap_count)?;
    output.flush().and_then(|_|output.get_ref().sync_all()).map_err(|e|e.to_string())?;
    Ok(preview)
}

#[cfg(test)]
mod streaming_tests {
    use super::*;
    fn root() -> std::path::PathBuf {
        let root=std::env::temp_dir().join(format!("tw-streaming-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap(); root
    }
    #[test]
    fn ordered_stream_retains_preview_rows_and_parquet_identity() {
        let root=root();
        for count in [2usize,1203,50003] {
            let text=format!("\u{feff}time,open,high,low,close,volume\r\n{}",(0..count).map(|i|
                format!("{},1,2,0,1.23456789012345678901234567895,{}\r\n",i*120,i%17)).collect::<String>());
            let source=json!({"provider":"fixture","license_use":"Tiếng Việt €"});
            let coverage=(-60, count as i64*120+60);
            let (expected,rows)=preview_price_only(&text,&source,"EUR/USD",60,Some(coverage)).unwrap();
            let raw=root.join(format!("{count}.csv"));let ndjson=root.join(format!("{count}.ndjson"));
            std::fs::write(&raw,text.as_bytes()).unwrap();
            let actual=stream_ordered_price_only(&raw,&ndjson,&source,"EUR/USD",60,coverage).unwrap();
            assert_eq!(actual,expected,"preview {count}");
            let encoded=std::fs::File::open(&ndjson).unwrap();
            let actual=serde_json::Deserializer::from_reader(std::io::BufReader::new(encoded)).into_iter::<Value>();
            assert_eq!(actual.map(Result::unwrap).collect::<Vec<_>>(),rows);
            let writer=crate::artifact_data::ArtifactData::new(&root).unwrap();
            let (_,a)=writer.write_dataset("tenant-a",&format!("buffered-{count}"),&rows).unwrap();
            let encoded=std::fs::File::open(&ndjson).unwrap();
            let actual=serde_json::Deserializer::from_reader(std::io::BufReader::new(encoded)).into_iter::<Value>().map(|v|v.map_err(|e|e.to_string()));
            let (_,b)=writer.write_dataset_iter("tenant-a",&format!("streamed-{count}"),actual).unwrap();
            assert_eq!(a,b,"Parquet {count}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn ordered_stream_rejects_invalid_rows_instead_of_sorting_or_dropping_them() {
        let root=root();
        for (index,body) in ["0,1,2,0,1\n0,1,2,0,1\n","60,1,2,0,1\n0,1,2,0,1\n",
            "0,1,2,0,1\n30,1,2,0,1\n","0,3,2,0,1\n60,1,2,0,1\n","0,1,2,0,1\n",""].iter().enumerate() {
            let raw=root.join(format!("{index}.csv"));let out=root.join(format!("{index}.ndjson"));
            std::fs::write(&raw,format!("time,open,high,low,close\n{body}")).unwrap();
            assert!(stream_ordered_price_only(&raw,&out,&json!({}),"EUR/USD",60,(0,120)).is_err(),"{index}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn provider_record_bound_also_covers_multiline_quoted_fields() {
        use std::io::Read;
        for bytes in [vec![b'x';65537],format!("\"{}\"\n","x\n".repeat(32769)).into_bytes()]{
            let mut reader=ProviderCsvInput::new(bytes.as_slice());let mut output=Vec::new();
            assert!(reader.read_to_end(&mut output).is_err());assert!(output.len()<=65536);
        }
        let bytes=b"\"1\"\n\"2\"\n";let mut output=Vec::new();
        ProviderCsvInput::new(bytes.as_slice()).read_to_end(&mut output).unwrap();assert_eq!(output,bytes);
    }
    #[test]
    #[ignore = "requires rust_data_ingest_parity.py Python fixtures"]
    fn python_ordered_provider_preview() {
        let cases:Vec<Value>=serde_json::from_slice(&std::fs::read(std::env::var("TW_DATA_PREVIEW_ORACLE").unwrap()).unwrap()).unwrap();
        let root=root();let mut checked=0;
        for (index,case) in cases.iter().enumerate() {
            let Some(symbol)=case["price_only"].as_str() else{continue};
            let Some(range)=case["range"].as_array() else{continue};
            if !case["expected"].is_object()||case["expected"]["row_count"].as_u64().unwrap_or(0)<2{continue}
            let raw=root.join(format!("{index}.csv"));let out=root.join(format!("{index}.ndjson"));
            std::fs::write(&raw,case["body"]["csv_text"].as_str().unwrap()).unwrap();
            let preview=stream_ordered_price_only(&raw,&out,&case["body"]["source"],symbol,
                case["body"]["timeframe_seconds"].as_i64().unwrap(),(range[0].as_i64().unwrap(),range[1].as_i64().unwrap())).unwrap();
            assert_eq!(preview,case["expected"],"{}",case["name"]);checked+=1;
        }
        assert!(checked>=6,"{checked}");std::fs::remove_dir_all(root).unwrap();
    }
}
