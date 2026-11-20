//! Una corrida verificada = una entrada por tablero, sin importar el nombre con que se envíe.

mod common;

use bp_server::store::{MemoryStore, Store};
use bp_server::submit::{submit, Submission};
use common::*;

const CLIENT: &str = "client-hash-a";

fn sub<'a>(body: &'a [u8], client: &'a str) -> Submission<'a> {
    Submission {
        body,
        client,
        now_unix: NOW_UNIX,
    }
}

fn hash16(log: &[u8]) -> String {
    let outcome = bp_core::run(&bp_core::decode(log).expect("decodes")).expect("replays");
    format!("{:016x}", outcome.hash)
}

#[test]
fn same_run_under_another_name_returns_the_existing_rank_and_total() {
    let store = MemoryStore::default();
    let first =
        submit(&store, &sub(&body("SEBITA", &logs().overflow_fire), CLIENT)).expect("first");
    let other = submit(&store, &sub(&body("OTRO", &logs().overflow_fire), CLIENT)).expect("other");
    assert_eq!((other.rank, other.total), (first.rank, first.total));
    assert_eq!(other.total, 1, "one verified run, one entry");
}

#[test]
fn first_submitted_name_wins_on_the_board() {
    let store = MemoryStore::default();
    submit(&store, &sub(&body("SEBITA", &logs().overflow_fire), CLIENT)).expect("first");
    submit(&store, &sub(&body("OTRO", &logs().overflow_fire), CLIENT)).expect("other");
    let top = store.top("overflow", 10).expect("top");
    assert_eq!(top.len(), 1);
    assert_eq!(top[0].name, "SEBITA");
}

#[test]
fn deduplication_holds_across_clients() {
    let store = MemoryStore::default();
    submit(
        &store,
        &sub(&body("SEBITA", &logs().overflow_fire), "client-a"),
    )
    .expect("first");
    let other = submit(
        &store,
        &sub(&body("OTRO", &logs().overflow_fire), "client-b"),
    )
    .expect("other");
    assert_eq!(other.total, 1);
}

#[test]
fn the_member_is_the_replay_hash_alone() {
    let store = MemoryStore::default();
    submit(&store, &sub(&body("SEBITA", &logs().overflow_fire), CLIENT)).expect("first");
    let top = store.top("overflow", 10).expect("top");
    assert_eq!(top[0].member, hash16(&logs().overflow_fire));
    assert!(!top[0].member.contains('|'));
}

#[test]
fn distinct_runs_on_the_same_board_are_separate_entries() {
    let store = MemoryStore::default();
    submit(&store, &sub(&body("SEBITA", &logs().overflow_fire), CLIENT)).expect("fire");
    let idle = submit(&store, &sub(&body("IDLE", &logs().overflow_idle), CLIENT)).expect("idle");
    assert_eq!(idle.total, 2);
}

#[test]
fn repeated_submissions_leave_a_single_entry() {
    let store = MemoryStore::default();
    for name in ["A", "B", "C"] {
        submit(&store, &sub(&body(name, &logs().overflow_fire), CLIENT)).expect("accepted");
    }
    assert_eq!(store.total("overflow").expect("total"), 1);
}
