//! Calls the production HTTP handlers with in-process requests and an Upstash JSON double.

#[path = "../../server/tests/common/mod.rs"]
mod common;
mod fake_upstash;
#[allow(dead_code)] // Include the actual binary sources, not copied handlers.
#[path = "../leaderboard.rs"]
mod leaderboard;
#[allow(dead_code)]
#[path = "../runs.rs"]
mod runs;

use bp_core::{run_bytes, FLAG_SHOTGUN};
use bp_server::upstash::Upstash;
use bp_server::MAX_BODY_BYTES;
use bytes::Bytes;
use common::*;
use fake_upstash::FakeUpstash;
use http::{Request, Response};
use http_body_util::Full;
use serde_json::{json, Value};

async fn post(fake: &FakeUpstash, payload: Vec<u8>, now: u64) -> Response<String> {
    let req = Request::post("/api/runs")
        .header("x-forwarded-for", "192.0.2.1")
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(payload)))
        .unwrap();
    runs::handle(
        req,
        || Some("test salt".into()),
        || Ok(Upstash::new(fake.clone())),
        || Ok(now),
    )
    .await
    .unwrap()
}

async fn get(fake: &FakeUpstash, board: &str, now: u64) -> Response<String> {
    let req = Request::get(format!("/api/leaderboard?board={board}"))
        .body(())
        .unwrap();
    leaderboard::handle(req, || Ok(Upstash::new(fake.clone())), || Ok(now))
        .await
        .unwrap()
}

fn assert_response(response: Response<String>, status: u16, json: Value) {
    assert_eq!(response.status(), status, "{}", response.body());
    assert_eq!(
        response.headers()["content-type"],
        "application/json; charset=utf-8"
    );
    if status != 200 {
        assert_eq!(response.headers()["cache-control"], "no-store");
    }
    assert_eq!(
        serde_json::from_str::<Value>(response.body()).unwrap(),
        json
    );
}

#[tokio::test]
async fn post_verifies_and_stores_then_get_ranks_and_retry_keeps_first_entry() {
    let fake = FakeUpstash::default();
    let low_log = &logs().overflow_idle;
    let high_log = &logs().overflow_fire;
    let low = run_bytes(low_log).unwrap();
    let high = run_bytes(high_log).unwrap();
    assert!(
        high.score > low.score,
        "fixtures must test score ordering: low={}, high={}",
        low.score,
        high.score
    );
    let low_member = format!("{:016x}", low.hash);
    let high_member = format!("{:016x}", high.hash);
    let accepted = |outcome: &bp_core::Outcome, rank, total| {
        json!({
            "ok": true, "board": "overflow", "score": outcome.score, "scoreVersion": outcome.score_version,
            "won": outcome.won, "rank": rank, "total": total,
        })
    };

    assert_response(
        post(&fake, body("LOW", low_log), NOW_UNIX).await,
        200,
        accepted(&low, 1, 1),
    );
    assert_response(
        post(&fake, body("HIGH", high_log), NOW_UNIX + 1).await,
        200,
        accepted(&high, 1, 2),
    );
    let stored = json!({
        "sortedSets": { "lb:overflow": { (&low_member): low.score, (&high_member): high.score } },
        "hashes": {
            "lbname:overflow": { (&low_member): "LOW", (&high_member): "HIGH" },
            "lbat:overflow": { (&low_member): NOW_UNIX.to_string(), (&high_member): (NOW_UNIX + 1).to_string() },
        },
    });
    assert_eq!(fake.stored(), stored);

    assert_response(
        post(&fake, body("RETRY", low_log), NOW_UNIX + 2).await,
        200,
        accepted(&low, 2, 2),
    );
    assert_eq!(fake.stored(), stored, "duplicate changed Redis state");
    assert_response(
        get(&fake, "overflow", NOW_UNIX).await,
        200,
        json!({
            "board": "overflow", "total": 2, "entries": [
                { "rank": 1, "name": "HIGH", "score": high.score, "at": NOW_UNIX + 1 },
                { "rank": 2, "name": "LOW", "score": low.score, "at": NOW_UNIX },
            ],
        }),
    );
}

#[tokio::test]
async fn daily_get_rejects_impossible_future_and_expired_dates() {
    let fake = FakeUpstash::default();
    let midnight = NOW_UNIX - 12 * 3600;
    for (board, now) in [
        ("daily:2026-02-29", NOW_UNIX),
        ("daily:2026-11-21", NOW_UNIX),
        ("daily:2026-11-18", NOW_UNIX),
        ("daily:2026-11-18", midnight),
    ] {
        assert_response(
            get(&fake, board, now).await,
            400,
            json!({"ok": false, "error": "bad_board"}),
        );
    }
    for (board, now) in [
        ("daily:2026-11-19", NOW_UNIX),
        ("daily:2026-11-20", NOW_UNIX),
        ("daily:2026-11-18", midnight - 1),
    ] {
        let response = get(&fake, board, now).await;
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_response(
            response,
            200,
            json!({"board": board, "total": 0, "entries": []}),
        );
    }
}

#[tokio::test]
async fn malformed_throttle_does_not_spend_the_replay_budget() {
    let fake = FakeUpstash::default();
    assert_response(
        post(&fake, vec![b' '; MAX_BODY_BYTES + 1], NOW_UNIX).await,
        413,
        json!({"ok": false, "error": "body_too_large"}),
    );
    for _ in 0..9 {
        assert_response(
            post(&fake, b"{".to_vec(), NOW_UNIX).await,
            400,
            json!({"ok": false, "error": "bad_json"}),
        );
    }
    assert_response(
        post(&fake, body("OK", b"bad BPL1"), NOW_UNIX).await,
        429,
        json!({"ok": false, "error": "rate_limited"}),
    );
    assert_eq!(fake.stored(), json!({"sortedSets": {}, "hashes": {}}));
    for _ in 0..10 {
        let response = post(&fake, body("OK", &logs().overflow_fire), NOW_UNIX).await;
        assert_eq!(response.status(), 200, "{}", response.body());
    }
    assert_response(
        post(&fake, body("OK", &logs().overflow_fire), NOW_UNIX).await,
        429,
        json!({"ok": false, "error": "rate_limited"}),
    );
}

#[tokio::test]
async fn a_qualifying_run_with_an_unproven_sg08_flag_never_ranks() {
    let fake = FakeUpstash::default();
    let log = record(MODE_OVERFLOW, 0, 4242, FLAG_SHOTGUN, false, 30_000);
    let outcome = run_bytes(&log).unwrap();
    assert!(outcome.ticks >= 60 && outcome.phase == bp_core::LOSE as u8);
    assert_response(
        post(&fake, body("SG08", &log), NOW_UNIX).await,
        422,
        json!({"ok": false, "error": "not_qualified"}),
    );
    assert_eq!(fake.stored(), json!({"sortedSets": {}, "hashes": {}}));
}
