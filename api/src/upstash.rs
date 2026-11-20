//! Store sobre Upstash Redis REST. Cada operación es un arreglo de comandos enviado a
//! `/pipeline` (no atómico) o `/multi-exec` (transacción). El token viaja solo en el
//! encabezado `Authorization` y nunca aparece en errores ni en `Debug`.

use std::fmt;
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};

use crate::store::{Entry, Store, StoreError};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
/// Ventana del límite de tasa: `EXPIRE 60` según el contrato.
const RATE_WINDOW_SECONDS: u64 = 60;

#[derive(Clone)]
pub struct UpstashConfig {
    url: String,
    token: String,
}

impl UpstashConfig {
    /// Exige HTTPS: el token nunca viaja en claro.
    pub fn new(url: &str, token: &str) -> Result<Self, StoreError> {
        let url = url.trim().trim_end_matches('/');
        let token = token.trim();
        if !url.starts_with("https://") || token.is_empty() {
            return Err(StoreError::Unavailable);
        }
        Ok(Self {
            url: url.to_string(),
            token: token.to_string(),
        })
    }

    pub fn from_env() -> Result<Self, StoreError> {
        let url = std::env::var("UPSTASH_REDIS_REST_URL").map_err(|_| StoreError::Unavailable)?;
        let token =
            std::env::var("UPSTASH_REDIS_REST_TOKEN").map_err(|_| StoreError::Unavailable)?;
        Self::new(&url, &token)
    }
}

impl fmt::Debug for UpstashConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("UpstashConfig")
            .field("url", &self.url)
            .field("token", &"<redacted>")
            .finish()
    }
}

/// Transporte HTTP. Separado para poder probar comandos y respuestas sin red.
pub trait Transport: Send + Sync {
    fn post(&self, path: &str, commands: &Value) -> Result<Value, StoreError>;
}

pub struct UreqTransport {
    config: UpstashConfig,
}

/// Un agente compartido reutiliza conexiones TLS entre invocaciones calientes.
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(COMMAND_TIMEOUT))
            .build();
        ureq::Agent::new_with_config(config)
    })
}

impl Transport for UreqTransport {
    fn post(&self, path: &str, commands: &Value) -> Result<Value, StoreError> {
        let url = format!("{}{}", self.config.url, path);
        let mut response = agent()
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .send_json(commands)
            .map_err(|_| StoreError::Unavailable)?;
        response
            .body_mut()
            .read_json::<Value>()
            .map_err(|_| StoreError::Unavailable)
    }
}

pub struct Upstash<T: Transport> {
    transport: T,
}

impl Upstash<UreqTransport> {
    pub fn from_env() -> Result<Self, StoreError> {
        Ok(Self::new(UreqTransport {
            config: UpstashConfig::from_env()?,
        }))
    }
}

impl<T: Transport> Upstash<T> {
    pub fn new(transport: T) -> Self {
        Self { transport }
    }

    fn pipeline(&self, commands: Vec<Value>) -> Result<Vec<Value>, StoreError> {
        let expected = commands.len();
        let reply = self.transport.post("/pipeline", &Value::Array(commands))?;
        replies(reply, expected)
    }

    fn transaction(&self, commands: Vec<Value>) -> Result<Vec<Value>, StoreError> {
        let expected = commands.len();
        let reply = self
            .transport
            .post("/multi-exec", &Value::Array(commands))?;
        replies(reply, expected)
    }
}

/// Cada respuesta es `{"result": ...}` o `{"error": ...}`. Un error en cualquier comando
/// cuenta como fallo del almacén.
fn replies(reply: Value, expected: usize) -> Result<Vec<Value>, StoreError> {
    let Value::Array(items) = reply else {
        return Err(StoreError::Unavailable);
    };
    if items.len() != expected {
        return Err(StoreError::Unavailable);
    }
    items
        .into_iter()
        .map(|item| match item {
            Value::Object(mut map) if !map.contains_key("error") => {
                map.remove("result").ok_or(StoreError::Unavailable)
            }
            _ => Err(StoreError::Unavailable),
        })
        .collect()
}

fn board_key(board: &str) -> String {
    format!("lb:{board}")
}

fn times_key(board: &str) -> String {
    format!("lbat:{board}")
}

fn integer(value: &Value) -> Result<u64, StoreError> {
    value.as_u64().ok_or(StoreError::Unavailable)
}

impl<T: Transport> Store for Upstash<T> {
    fn zadd_nx(&self, board: &str, member: &str, score: u32, at: u64) -> Result<bool, StoreError> {
        let results = self.transaction(vec![
            json!(["ZADD", board_key(board), "NX", score, member]),
            json!(["HSETNX", times_key(board), member, at]),
        ])?;
        Ok(integer(&results[0])? == 1)
    }

    fn rank(&self, board: &str, member: &str) -> Result<Option<u64>, StoreError> {
        let results = self.pipeline(vec![json!(["ZREVRANK", board_key(board), member])])?;
        Ok(results[0].as_u64().map(|zero_based| zero_based + 1))
    }

    fn total(&self, board: &str) -> Result<u64, StoreError> {
        let results = self.pipeline(vec![json!(["ZCARD", board_key(board)])])?;
        integer(&results[0])
    }

    fn top(&self, board: &str, limit: usize) -> Result<Vec<Entry>, StoreError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let stop = limit - 1;
        let results = self.pipeline(vec![json!([
            "ZREVRANGE",
            board_key(board),
            0,
            stop,
            "WITHSCORES"
        ])])?;
        let flat = results[0].as_array().ok_or(StoreError::Unavailable)?;
        let rows = flat
            .chunks(2)
            .map(|pair| {
                let member = pair[0].as_str().ok_or(StoreError::Unavailable)?;
                let score = pair
                    .get(1)
                    .and_then(Value::as_str)
                    .and_then(|text| text.parse::<u32>().ok())
                    .ok_or(StoreError::Unavailable)?;
                Ok((member.to_string(), score))
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        if rows.is_empty() {
            return Ok(Vec::new());
        }

        let mut hmget = vec![json!("HMGET"), json!(times_key(board))];
        hmget.extend(rows.iter().map(|(member, _)| json!(member)));
        let times = self.pipeline(vec![Value::Array(hmget)])?;
        let times = times[0].as_array().ok_or(StoreError::Unavailable)?;

        Ok(rows
            .into_iter()
            .enumerate()
            .map(|(index, (member, score))| {
                let at = times
                    .get(index)
                    .and_then(Value::as_str)
                    .and_then(|text| text.parse::<u64>().ok())
                    .unwrap_or(0);
                Entry { member, score, at }
            })
            .collect())
    }

    fn rate_limit_hit(&self, bucket: &str) -> Result<u64, StoreError> {
        let results = self.transaction(vec![
            json!(["INCR", bucket]),
            json!(["EXPIRE", bucket, RATE_WINDOW_SECONDS]),
        ])?;
        integer(&results[0])
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::*;

    /// Transporte falso: guarda cada petición y responde con una cola de respuestas.
    #[derive(Default)]
    struct Scripted {
        replies: Mutex<VecDeque<Result<Value, StoreError>>>,
        sent: Mutex<Vec<(String, Value)>>,
    }

    impl Scripted {
        fn with(replies: Vec<Result<Value, StoreError>>) -> Self {
            Self {
                replies: Mutex::new(replies.into()),
                sent: Mutex::new(Vec::new()),
            }
        }

        fn sent(&self) -> Vec<(String, Value)> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl Transport for Scripted {
        fn post(&self, path: &str, commands: &Value) -> Result<Value, StoreError> {
            self.sent
                .lock()
                .unwrap()
                .push((path.to_string(), commands.clone()));
            self.replies
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(StoreError::Unavailable))
        }
    }

    fn ok(value: Value) -> Result<Value, StoreError> {
        Ok(json!([{ "result": value }]))
    }

    #[test]
    fn zadd_nx_runs_zadd_and_hsetnx_in_one_transaction() {
        let transport = Scripted::with(vec![Ok(json!([{ "result": 1 }, { "result": 1 }]))]);
        let store = Upstash::new(transport);
        assert!(store
            .zadd_nx("overflow", "SEB|00ff", 2310, 1_766_000_000)
            .unwrap());
        let sent = store.transport.sent();
        assert_eq!(sent[0].0, "/multi-exec");
        assert_eq!(
            sent[0].1[0],
            json!(["ZADD", "lb:overflow", "NX", 2310, "SEB|00ff"])
        );
        assert_eq!(
            sent[0].1[1],
            json!(["HSETNX", "lbat:overflow", "SEB|00ff", 1_766_000_000u64])
        );
    }

    #[test]
    fn zadd_nx_reports_a_duplicate_as_not_added() {
        let transport = Scripted::with(vec![Ok(json!([{ "result": 0 }, { "result": 0 }]))]);
        assert!(!Upstash::new(transport)
            .zadd_nx("overflow", "SEB|00ff", 1, 1)
            .unwrap());
    }

    #[test]
    fn rank_is_one_based_and_none_when_the_member_is_missing() {
        let found = Upstash::new(Scripted::with(vec![ok(json!(3))]));
        assert_eq!(found.rank("overflow", "SEB|00ff").unwrap(), Some(4));
        let missing = Upstash::new(Scripted::with(vec![ok(Value::Null)]));
        assert_eq!(missing.rank("overflow", "SEB|00ff").unwrap(), None);
    }

    #[test]
    fn total_reads_zcard() {
        let store = Upstash::new(Scripted::with(vec![ok(json!(31))]));
        assert_eq!(store.total("overflow").unwrap(), 31);
        assert_eq!(
            store.transport.sent()[0].1[0],
            json!(["ZCARD", "lb:overflow"])
        );
    }

    #[test]
    fn top_joins_members_scores_and_submission_times() {
        let store = Upstash::new(Scripted::with(vec![
            ok(json!(["A|1", "900", "B|2", "800"])),
            ok(json!(["10", null])),
        ]));
        let top = store.top("overflow", 2).unwrap();
        assert_eq!(
            top,
            vec![
                Entry {
                    member: "A|1".into(),
                    score: 900,
                    at: 10
                },
                Entry {
                    member: "B|2".into(),
                    score: 800,
                    at: 0
                },
            ]
        );
        let sent = store.transport.sent();
        assert_eq!(
            sent[0].1[0],
            json!(["ZREVRANGE", "lb:overflow", 0, 1, "WITHSCORES"])
        );
        assert_eq!(
            sent[1].1[0],
            json!(["HMGET", "lbat:overflow", "A|1", "B|2"])
        );
    }

    #[test]
    fn top_skips_the_time_lookup_when_the_board_is_empty() {
        let store = Upstash::new(Scripted::with(vec![ok(json!([]))]));
        assert!(store.top("overflow", 5).unwrap().is_empty());
        assert_eq!(store.transport.sent().len(), 1);
    }

    #[test]
    fn top_with_zero_limit_makes_no_request() {
        let store = Upstash::new(Scripted::with(vec![]));
        assert!(store.top("overflow", 0).unwrap().is_empty());
        assert!(store.transport.sent().is_empty());
    }

    #[test]
    fn rate_limit_hit_increments_and_sets_the_sixty_second_window() {
        let transport = Scripted::with(vec![Ok(json!([{ "result": 4 }, { "result": 1 }]))]);
        let store = Upstash::new(transport);
        assert_eq!(store.rate_limit_hit("rl:abc:29000000").unwrap(), 4);
        let sent = store.transport.sent();
        assert_eq!(sent[0].1[0], json!(["INCR", "rl:abc:29000000"]));
        assert_eq!(sent[0].1[1], json!(["EXPIRE", "rl:abc:29000000", 60]));
    }

    #[test]
    fn an_error_inside_a_reply_is_a_store_failure() {
        let store = Upstash::new(Scripted::with(vec![Ok(json!([{ "error": "WRONGTYPE" }]))]));
        assert_eq!(store.total("overflow"), Err(StoreError::Unavailable));
    }

    #[test]
    fn a_reply_with_the_wrong_length_is_a_store_failure() {
        let store = Upstash::new(Scripted::with(vec![Ok(
            json!([{ "result": 1 }, { "result": 2 }]),
        )]));
        assert_eq!(store.total("overflow"), Err(StoreError::Unavailable));
    }

    #[test]
    fn a_transport_failure_is_a_store_failure() {
        let store = Upstash::new(Scripted::with(vec![Err(StoreError::Unavailable)]));
        assert_eq!(store.total("overflow"), Err(StoreError::Unavailable));
    }

    #[test]
    fn a_whole_discarded_transaction_is_a_store_failure() {
        let store = Upstash::new(Scripted::with(vec![Ok(json!({ "error": "ERR syntax" }))]));
        assert_eq!(store.rate_limit_hit("rl:x:1"), Err(StoreError::Unavailable));
    }

    #[test]
    fn config_requires_https_and_a_token() {
        assert!(UpstashConfig::new("https://example.upstash.io/", "tok").is_ok());
        assert_eq!(
            UpstashConfig::new("http://example.upstash.io", "tok").map(|_| ()),
            Err(StoreError::Unavailable)
        );
        assert_eq!(
            UpstashConfig::new("https://example.upstash.io", "  ").map(|_| ()),
            Err(StoreError::Unavailable)
        );
    }

    #[test]
    fn debug_output_never_shows_the_token() {
        let config = UpstashConfig::new("https://example.upstash.io", "s3cr3t-token").unwrap();
        let shown = format!("{config:?}");
        assert!(!shown.contains("s3cr3t-token"));
        assert!(shown.contains("<redacted>"));
    }
}
