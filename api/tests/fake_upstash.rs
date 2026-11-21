//! Stateful in-process double at the Upstash REST JSON transport boundary.
//! Models only the commands the application uses; no sockets or credentials.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use bp_server::store::StoreError;
use bp_server::upstash::Transport;
use serde_json::{json, Value};

#[derive(Clone, Default)]
pub struct FakeUpstash(Arc<Mutex<State>>);

#[derive(Default)]
struct State {
    // Redis replies to reads return strings even if a write sent a JSON number.
    boards: BTreeMap<String, BTreeMap<String, u32>>,
    hashes: BTreeMap<String, BTreeMap<String, String>>,
    counts: BTreeMap<String, u64>,
}

impl FakeUpstash {
    pub fn stored(&self) -> Value {
        let state = self.0.lock().unwrap();
        json!({ "sortedSets": state.boards, "hashes": state.hashes })
    }
}

impl State {
    fn ranked(&self, key: &str) -> Vec<(&str, u32)> {
        let mut rows: Vec<_> = self
            .boards
            .get(key)
            .into_iter()
            .flatten()
            .map(|(member, score)| (member.as_str(), *score))
            .collect();
        rows.sort_unstable_by(|a, b| (b.1, b.0).cmp(&(a.1, a.0)));
        rows
    }
}

impl Transport for FakeUpstash {
    fn post(&self, path: &str, commands: &Value) -> Result<Value, StoreError> {
        let mut state = self.0.lock().unwrap();
        let mut results = Vec::new();
        for command in commands.as_array().unwrap() {
            let args = command.as_array().unwrap();
            let key = args[1].as_str().unwrap();
            let result = match (path, args[0].as_str().unwrap(), args.len()) {
                ("/multi-exec", "INCR", 2) => {
                    let hits = state.counts.entry(key.into()).or_default();
                    *hits += 1;
                    json!(*hits)
                }
                ("/multi-exec", "EXPIRE", 3) if args[2] == 60 => json!(1),
                ("/multi-exec", "ZADD", 5) if args[2] == "NX" => {
                    let rows = state.boards.entry(key.into()).or_default();
                    let member = args[4].as_str().unwrap();
                    if rows.contains_key(member) {
                        json!(0)
                    } else {
                        rows.insert(member.into(), args[3].as_u64().unwrap().try_into().unwrap());
                        json!(1)
                    }
                }
                ("/multi-exec", "HSETNX", 4) => {
                    let rows = state.hashes.entry(key.into()).or_default();
                    let member = args[2].as_str().unwrap();
                    if rows.contains_key(member) {
                        json!(0)
                    } else {
                        let value = args[3]
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| args[3].as_u64().unwrap().to_string());
                        rows.insert(member.into(), value);
                        json!(1)
                    }
                }
                ("/pipeline", "ZCARD", 2) => json!(state.boards.get(key).map_or(0, BTreeMap::len)),
                ("/pipeline", "ZREVRANK", 3) => json!(state
                    .ranked(key)
                    .iter()
                    .position(|row| row.0 == args[2].as_str().unwrap())),
                ("/pipeline", "ZREVRANGE", 5) if args[2] == 0 && args[4] == "WITHSCORES" => {
                    let stop = args[3].as_u64().unwrap() as usize;
                    json!(state
                        .ranked(key)
                        .into_iter()
                        .take(stop + 1)
                        .flat_map(|(member, score)| [member.to_string(), score.to_string()])
                        .collect::<Vec<_>>())
                }
                ("/pipeline", "HMGET", 3..) => json!(args[2..]
                    .iter()
                    .map(|member| {
                        state
                            .hashes
                            .get(key)
                            .and_then(|hash| hash.get(member.as_str().unwrap()))
                    })
                    .collect::<Vec<_>>()),
                _ => panic!("unexpected Upstash request: {path} {command}"),
            };
            results.push(json!({ "result": result }));
        }
        Ok(Value::Array(results))
    }
}
