//! Bounded Responses decoding, restricted to assistant text. No tool execution here.
use serde_json::{Value, json};
use tokio::sync::watch;

#[derive(Clone, Default)]
pub(crate) struct Progress {
    pub text: String,
    pub thinking: bool,
}

const TEXT_LIMIT: usize = 262144;
fn failure(code: &str) -> Value {
    json!({"error":code,"outcome":"unknown"})
}
pub(crate) async fn complete(
    request: reqwest::RequestBuilder,
    provider: &str,
    progress: Option<watch::Sender<Progress>>,
) -> Result<Value, Value> {
    let mut response = request.send().await.map_err(|e| {
        failure(if e.is_timeout() {
            "ai_timeout"
        } else {
            "ai_transport_failed"
        })
    })?;
    if !response.status().is_success() {
        let code = match response.status().as_u16() {
            401 | 403 => "ai_gateway_auth_failed",
            429 => "ai_gateway_rate_limited",
            408 | 504 => "ai_timeout",
            409 => "chatgpt_busy",
            _ => "ai_gateway_response_failed",
        };
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u32>().ok())
            .map(|s| s.min(3600));
        return Err(
            json!({"error":code,"http_status":response.status().as_u16(),"retry_after_seconds":retry,"outcome":if response.status().is_client_error(){"rejected"}else{"unknown"}}),
        );
    }
    let stream = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(';').next() == Some("text/event-stream"));
    let mut decoder = Responses::new();
    let mut received = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| failure("ai_transport_failed"))?
    {
        received += chunk.len();
        if received > if stream { 1048576 } else { TEXT_LIMIT } {
            return Err(failure("ai_response_too_large"));
        }
        decoder.bytes.extend_from_slice(&chunk);
        if stream {
            while let Some(frame) = decoder.frame()? {
                decoder.event(&frame, progress.as_ref())?;
            }
        }
    }
    let value = if stream {
        decoder
            .completed
            .ok_or_else(|| failure("ai_gateway_incomplete_response"))?
    } else {
        serde_json::from_slice(&decoder.bytes).map_err(|_| failure("ai_invalid_response"))?
    };
    let text = crate::ai_assistant::chat_text(&value).map_err(|code| {
        failure(if provider == "local-gateway" {
            match code {
                "chatgpt_empty_response" => "ai_gateway_empty_response",
                _ => "ai_gateway_incomplete_response",
            }
        } else {
            code
        })
    })?;
    if text.len() > TEXT_LIMIT {
        return Err(failure("ai_response_too_large"));
    }
    // Missing usage/effective options remain unknown, never fabricated as zero or as requested.
    let usage=value.get("usage").map(|v|json!({"input_tokens":v["input_tokens"].as_u64(),"output_tokens":v["output_tokens"].as_u64()}));
    let result = json!({"text":text,"outcome":"completed","usage":usage,"effective_effort":null,"partial":false});
    if serde_json::to_vec(&result).map_or(true, |v| v.len() > 280000) {
        return Err(failure("ai_response_too_large"));
    }
    Ok(result)
}
struct Responses {
    bytes: Vec<u8>,
    text: String,
    completed: Option<Value>,
    json_size: usize,
}
impl Responses {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            text: String::new(),
            completed: None,
            json_size: 2,
        }
    }
    fn frame(&mut self) -> Result<Option<String>, Value> {
        let split = self
            .bytes
            .windows(2)
            .position(|v| v == b"\n\n")
            .map(|p| (p, 2))
            .into_iter()
            .chain(
                self.bytes
                    .windows(4)
                    .position(|v| v == b"\r\n\r\n")
                    .map(|p| (p, 4)),
            )
            .min_by_key(|v| v.0);
        let Some((at, len)) = split else {
            if self.bytes.len() > 300000 {
                return Err(failure("ai_stream_frame_too_large"));
            }
            return Ok(None);
        };
        let frame = String::from_utf8(self.bytes.drain(..at + len).collect())
            .map_err(|_| failure("ai_invalid_response"))?;
        Ok(Some(frame))
    }
    fn event(
        &mut self,
        frame: &str,
        progress: Option<&watch::Sender<Progress>>,
    ) -> Result<(), Value> {
        let data = frame
            .lines()
            .filter_map(|line| {
                line.strip_prefix("data:")
                    .map(|v| v.strip_prefix(' ').unwrap_or(v))
            })
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            return Ok(());
        }
        let value: Value =
            serde_json::from_str(&data).map_err(|_| failure("ai_invalid_response"))?;
        match value["type"].as_str() {
            Some("response.output_text.delta") => {
                if self.completed.is_some() {
                    return Err(failure("ai_invalid_response"));
                }
                let delta = value["delta"]
                    .as_str()
                    .ok_or_else(|| failure("ai_invalid_response"))?;
                if self.text.len() + delta.len() > TEXT_LIMIT {
                    return Err(failure("ai_response_too_large"));
                }
                self.json_size += delta
                    .bytes()
                    .map(|b| match b {
                        b'"' | b'\\' | b'\n' | b'\r' | b'\t' | 8 | 12 => 2,
                        0..=31 => 6,
                        _ => 1,
                    })
                    .sum::<usize>();
                if self.json_size > 279000 {
                    return Err(failure("ai_response_too_large"));
                }
                self.text.push_str(delta);
                if let Some(progress) = progress {
                    progress.send_modify(|snapshot| {
                        snapshot.text.push_str(delta);
                        snapshot.thinking = false;
                    });
                }
            }
            Some("response.completed") => {
                if self.completed.is_some() {
                    return Err(failure("ai_invalid_response"));
                }
                self.completed = Some(value["response"].clone());
            }
            Some("response.failed" | "response.incomplete" | "error") => {
                return Err(failure("ai_gateway_incomplete_response"));
            }
            Some("response.reasoning_text.delta" | "response.reasoning_summary_text.delta") => {
                // Expose only the phase, never private chain-of-thought text.
                if let Some(progress) = progress {
                    progress.send_if_modified(|snapshot| {
                        if snapshot.thinking || !snapshot.text.is_empty() {
                            return false;
                        }
                        snapshot.thinking = true;
                        true
                    });
                }
            }
            _ => (), // Reasoning and protocol bookkeeping never enter public text events.
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn short_output_and_thinking_phase_survive_between_checkpoints() {
        let mut reader = Responses::new();
        let (tx, rx) = watch::channel(Progress::default());
        reader
            .event(
                "data: {\"type\":\"response.reasoning_text.delta\",\"delta\":\"private\"}",
                Some(&tx),
            )
            .unwrap();
        assert!(rx.borrow().thinking);
        assert!(rx.borrow().text.is_empty());
        for delta in ["xin ", "chào"] {
            reader
                .event(
                    &format!(
                        "data: {}",
                        json!({"type":"response.output_text.delta","delta":delta})
                    ),
                    Some(&tx),
                )
                .unwrap();
        }
        assert_eq!(rx.borrow().text, "xin chào");
        assert!(!rx.borrow().thinking);
    }
    #[tokio::test]
    async fn response_frames_handle_split_utf8_crlf_and_ignore_reasoning() {
        let mut reader = Responses::new();
        let (tx, rx) = watch::channel(Progress::default());
        let text = "đúng ".repeat(210);
        let payload = format!(
            "data: {}\r\n\r\ndata: {}\n\ndata: {}\n\n",
            json!({"type":"response.reasoning_text.delta","delta":"private"}),
            json!({"type":"response.output_text.delta","delta":text}),
            json!({"type":"response.completed","response":{"status":"completed"}})
        );
        for byte in payload.bytes() {
            reader.bytes.push(byte);
            while let Some(frame) = reader.frame().unwrap() {
                reader.event(&frame, Some(&tx)).unwrap();
            }
        }
        assert_eq!(rx.borrow().text, text);
        assert!(!reader.text.contains("private"));
        assert!(reader.completed.is_some());
        assert!(
            reader
                .event(
                    "data: {\"type\":\"response.output_text.delta\",\"delta\":\"late\"}",
                    Some(&tx)
                )
                .is_err()
        );
    }
    #[test]
    fn malformed_oversized_and_incomplete_streams_fail_closed() {
        let (tx, _) = watch::channel(Progress::default());
        let mut reader = Responses::new();
        assert!(reader.event("data: broken", Some(&tx)).is_err());
        assert!(
            reader
                .event("data: {\"type\":\"response.incomplete\"}", Some(&tx))
                .is_err()
        );
        reader.bytes = vec![b'x'; 300001];
        assert!(reader.frame().is_err());
        reader.text = "x".repeat(TEXT_LIMIT);
        assert!(
            reader
                .event(
                    "data: {\"type\":\"response.output_text.delta\",\"delta\":\"x\"}",
                    Some(&tx)
                )
                .is_err()
        );
    }
    #[test]
    fn escaped_text_cannot_overflow_the_persistent_or_public_frame_budget() {
        let mut reader = Responses::new();
        let sample = "đ\"\\\n\r\t\u{0000}\u{0008}\u{000c}";
        for _ in 0..10 {
            reader
                .event(
                    &format!(
                        "data: {}",
                        json!({"type":"response.output_text.delta","delta":sample})
                    ),
                    None,
                )
                .unwrap();
        }
        assert_eq!(
            reader.json_size,
            serde_json::to_vec(&reader.text).unwrap().len()
        );
        assert!(reader.event(&format!("data: {}",json!({"type":"response.output_text.delta","delta":"\u{0000}".repeat(50000)})),None).is_err());
    }
}
