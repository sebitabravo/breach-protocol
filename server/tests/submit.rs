//! Extremo a extremo de `submit()`: registros reales, almacén en memoria.

mod common;

use bp_server::error::ApiError;
use bp_server::store::{Candidate, Entry, MemoryStore, Store, StoreError};
use bp_server::submit::{submit, Submission};
use bp_server::MAX_BODY_BYTES;
use common::*;

const CLIENT: &str = "client-hash-a";

fn sub<'a>(body: &'a [u8], client: &'a str) -> Submission<'a> {
    Submission {
        body,
        client,
        now_unix: NOW_UNIX,
    }
}

fn verified(log: &[u8]) -> bp_core::Outcome {
    bp_core::run(&bp_core::decode(log).expect("log decodes")).expect("log replays")
}

/// Falla siempre: simula Upstash caído.
struct FailingStore;

impl Store for FailingStore {
    fn zadd_nx(&self, _: &str, _: &Candidate<'_>) -> Result<bool, StoreError> {
        Err(StoreError::Unavailable)
    }
    fn rank(&self, _: &str, _: &str) -> Result<Option<u64>, StoreError> {
        Err(StoreError::Unavailable)
    }
    fn total(&self, _: &str) -> Result<u64, StoreError> {
        Err(StoreError::Unavailable)
    }
    fn top(&self, _: &str, _: usize) -> Result<Vec<Entry>, StoreError> {
        Err(StoreError::Unavailable)
    }
    fn rate_limit_hit(&self, _: &str) -> Result<u64, StoreError> {
        Err(StoreError::Unavailable)
    }
}

#[test]
fn valid_overflow_run_is_accepted_and_ranked() {
    let store = MemoryStore::default();
    let payload = body("SEBITA", &logs().overflow_fire);
    let accepted = submit(&store, &sub(&payload, CLIENT)).expect("valid overflow run");
    let expected = verified(&logs().overflow_fire);

    assert_eq!(accepted.board, "overflow");
    assert_eq!(accepted.score, expected.score);
    assert_eq!(accepted.score_version, expected.score_version);
    assert_eq!(accepted.won, expected.won);
    assert_eq!((accepted.rank, accepted.total), (1, 1));
}

#[test]
fn overflow_death_without_kills_is_accepted() {
    let store = MemoryStore::default();
    let log = &logs().overflow_idle;
    let outcome = verified(log);
    assert_eq!(outcome.phase, bp_core::LOSE as u8);
    assert_eq!(outcome.kills, 0);
    let accepted = submit(&store, &sub(&body("IDLE", log), CLIENT)).expect("natural death");
    assert_eq!(accepted.board, "overflow");
}

#[test]
fn zero_tick_overflow_is_422_not_qualified() {
    let store = MemoryStore::default();
    let log = record(MODE_OVERFLOW, 0, 7, 0, false, 0);
    assert_eq!(verified(&log).ticks, 0);
    let err = submit(&store, &sub(&body("SEBITA", &log), CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::NotQualified);
    assert_eq!((err.status(), err.code()), (422, "not_qualified"));
    assert_eq!(store.total("overflow").unwrap(), 0);
}

#[test]
fn daily_stubs_do_not_qualify_even_with_todays_seed() {
    let store = MemoryStore::default();
    for ticks in [0, 60] {
        let log = record(MODE_DAILY, 0, 20_261_120, 0, false, ticks);
        let outcome = verified(&log);
        assert_eq!(outcome.ticks, ticks);
        assert_eq!(outcome.phase, bp_core::PLAYING as u8);
        assert_eq!(
            submit(&store, &sub(&body("SEBITA", &log), CLIENT)),
            Err(ApiError::NotQualified)
        );
    }
    assert_eq!(store.total("daily:2026-11-20").unwrap(), 0);
}

#[test]
fn log_padded_after_its_match_ended_is_422_log_invalid() {
    let log = &logs().overflow_idle;
    let outcome = verified(log);
    assert!(
        outcome.phase == 3 || outcome.phase == 4,
        "premise: the idle run must end by death or timeout, got phase {}",
        outcome.phase
    );

    let mut tampered = log.clone();
    tampered.extend_from_slice(&[0, 0]);
    let ticks = u32::from_le_bytes(tampered[TICKS_OFFSET..TICKS_OFFSET + 4].try_into().unwrap());
    tampered[TICKS_OFFSET..TICKS_OFFSET + 4].copy_from_slice(&(ticks + 1).to_le_bytes());

    let payload = body("CHEAT", &tampered);
    let err = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::LogInvalid);
    assert_eq!(err.status(), 422);
}

#[test]
fn structurally_broken_log_is_400_malformed_log() {
    let mut broken = logs().overflow_fire.clone();
    broken[0] = b'X';
    let payload = body("SEBITA", &broken);
    let err = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::MalformedLog);
    assert_eq!(err.status(), 400);
}

#[test]
fn truncated_log_is_400_malformed_log() {
    let log = &logs().overflow_fire;
    let payload = body("SEBITA", &log[..log.len() - 1]);
    let err = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::MalformedLog);
}

#[test]
fn practice_run_is_not_qualified_for_any_board() {
    let payload = body("SEBITA", &logs().practice_fire);
    let err = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::NotQualified);
    assert_eq!(err.status(), 422);
}

#[test]
fn mission_loss_is_not_qualified() {
    let payload = body("SEBITA", &logs().mission_idle);
    let err = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::NotQualified);
}

#[test]
fn daily_run_of_today_counts_on_its_date_board() {
    let payload = body("SEBITA", &logs().daily_today);
    let accepted = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).expect("today");
    assert_eq!(accepted.board, "daily:2026-11-20");
}

#[test]
fn daily_run_of_yesterday_is_accepted_on_its_own_date() {
    let payload = body("SEBITA", &logs().daily_yesterday);
    let accepted = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).expect("yesterday");
    assert_eq!(accepted.board, "daily:2026-11-19");
}

#[test]
fn daily_run_of_another_day_is_not_qualified() {
    let payload = body("SEBITA", &logs().daily_wrong_day);
    let err = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::NotQualified);
}

#[test]
fn body_over_one_mib_is_413() {
    let oversized = vec![b' '; MAX_BODY_BYTES + 1];
    let err = submit(&MemoryStore::default(), &sub(&oversized, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::BodyTooLarge);
    assert_eq!(err.status(), 413);
}

#[test]
fn eleventh_submission_in_a_minute_is_429_even_when_valid() {
    let store = MemoryStore::default();
    let valid = body("SEBITA", &logs().overflow_fire);
    for _ in 0..10 {
        assert!(submit(&store, &sub(&valid, CLIENT)).is_ok());
    }
    let err = submit(&store, &sub(&valid, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::RateLimited);
    assert_eq!(err.status(), 429);
}

#[test]
fn rate_limit_is_per_client_key() {
    let store = MemoryStore::default();
    let valid = body("SEBITA", &logs().overflow_fire);
    for _ in 0..10 {
        assert!(submit(&store, &sub(&valid, CLIENT)).is_ok());
    }
    assert!(submit(&store, &sub(&valid, "client-hash-b")).is_ok());
    assert!(submit(
        &store,
        &Submission {
            now_unix: NOW_UNIX + 60,
            ..sub(&valid, CLIENT)
        }
    )
    .is_ok());
}

#[test]
fn resubmitting_the_same_run_with_the_same_name_is_idempotent() {
    let store = MemoryStore::default();
    let payload = body("SEBITA", &logs().overflow_fire);
    let first = submit(&store, &sub(&payload, CLIENT)).expect("first");
    let second = submit(&store, &sub(&payload, CLIENT)).expect("second");
    assert_eq!((first.rank, first.total), (1, 1));
    assert_eq!((second.rank, second.total), (1, 1));
    assert_eq!(second.score, first.score);
}

#[test]
fn same_run_under_another_name_returns_the_existing_entry() {
    let store = MemoryStore::default();
    let first =
        submit(&store, &sub(&body("SEBITA", &logs().overflow_fire), CLIENT)).expect("first");
    let other = submit(&store, &sub(&body("OTRO", &logs().overflow_fire), CLIENT)).expect("other");
    assert_eq!((other.rank, other.total), (first.rank, first.total));
}

#[test]
fn name_is_trimmed_but_accents_are_stored_verbatim() {
    let store = MemoryStore::default();
    let payload = body("  José  ", &logs().overflow_fire);
    submit(&store, &sub(&payload, CLIENT)).expect("valid");
    let top = store.top("overflow", 10).expect("top");
    assert_eq!(top[0].name, "José");
}

#[test]
fn mixed_valid_and_disallowed_name_is_400_bad_name() {
    let store = MemoryStore::default();
    let payload = body("Jo\u{200d}sé", &logs().overflow_fire);
    let err = submit(&store, &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::BadName);
    assert_eq!((err.status(), err.code()), (400, "bad_name"));
    assert_eq!(store.total("overflow").unwrap(), 0);
}

#[test]
fn name_with_no_allowed_characters_is_400_bad_name() {
    let payload = body("<<<>>>", &logs().overflow_fire);
    let err = submit(&MemoryStore::default(), &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::BadName);
}

#[test]
fn malformed_request_shapes_are_400() {
    let store = MemoryStore::default();
    let cases: [(&[u8], ApiError); 4] = [
        (b"not json", ApiError::BadJson),
        (b"{}", ApiError::BadRequest),
        (br#"{"name": 5, "log": "AA=="}"#, ApiError::BadRequest),
        (br#"{"name": "SEBITA", "log": "!!!"}"#, ApiError::BadBase64),
    ];
    for (raw, expected) in cases {
        let err = submit(&store, &sub(raw, "client-shape")).unwrap_err();
        assert_eq!(err, expected, "body {:?}", String::from_utf8_lossy(raw));
    }
}

#[test]
fn store_outage_is_503_store_unavailable() {
    let payload = body("SEBITA", &logs().overflow_fire);
    let err = submit(&FailingStore, &sub(&payload, CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::StoreUnavailable);
    assert_eq!(err.status(), 503);
}
