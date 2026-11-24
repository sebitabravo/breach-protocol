//! Paridad grabación→verificación, la garantía central del tablero: un registro
//! grabado por la ruta del cliente (grabador armado por `bp_start`, entradas
//! cuantizadas por `Game::step`, mismo codificador BPL1) re-simula en `submit()`
//! al mismo resultado que la partida viva produjo. Y las trampas de un cliente
//! hostil terminan en rechazo o en un resultado que el cliente no controla.
//!
//! El contrato de red no lleva puntaje declarado (`submit::parse` solo lee `name`
//! y `log`), así que "inflar el puntaje declarado" no existe como ataque; lo más
//! cerca es inflar los `ticks` del encabezado, y está cubierto aquí.

mod common;

use bp_core::ReplayError;
use bp_server::error::ApiError;
use bp_server::store::{MemoryStore, Store};
use bp_server::submit::{submit, Submission};
use common::*;

const CLIENT: &str = "client-hash-parity";

fn sub<'a>(body: &'a [u8], client: &'a str) -> Submission<'a> {
    Submission {
        body,
        client,
        now_unix: NOW_UNIX,
    }
}

/// Recorre el cuerpo RLE del registro y voltea el bit bajo del primer byte de un
/// valor de mirada (`M_LOOK_X`/`M_LOOK_Y`): un cambio mínimo de entrada que sí
/// mueve la simulación (el yaw se arrastra al resto de la partida). Nunca toca el
/// encabezado, ni el `count` ni el `mask`. Devuelve `None` si ningún frame lleva
/// valores de mirada.
fn flip_first_input_value_byte(log: &[u8]) -> Option<Vec<u8>> {
    const HEADER: usize = 16;
    let mut out = log.to_vec();
    let mut at = HEADER;
    while at + 2 <= out.len() {
        let count = 1 + out[at] as usize;
        let mask = out[at + 1];
        // Desplazamientos de cada valor dentro del frame, en orden del mask:
        // M_FLAGS=1 (u16), M_MOVE_X=2, M_MOVE_Z=4, M_LOOK_X=8 (i16), M_LOOK_Y=16 (i16).
        let mut offset = 2usize;
        for (bit, size) in [(1u8, 2usize), (2, 1), (4, 1), (8, 2), (16, 2)] {
            if mask & bit != 0 {
                if bit == 8 || bit == 16 {
                    out[at + offset] ^= 1;
                    return Some(out);
                }
                offset += size;
            }
        }
        at += offset + (count - 1);
    }
    None
}

/// Paridad pura: la partida grabada y el envío verificado deben acordar.
#[test]
fn client_recorded_run_verifies_to_the_live_score() {
    // Modo overflow con fuego: matar enemigos es la única forma de puntaje distinto
    // de cero, así que este registro ejercita la cadena completa de puntaje.
    let (log, live) = record_with_outcome(MODE_OVERFLOW, 0, 21, FLAG_AUTO_RELOAD, true, 6_000);
    assert!(live.score > 0, "premise: the recording must have scored");

    let store = MemoryStore::default();
    let accepted = submit(&store, &sub(&body("SEBITA", &log), CLIENT)).expect("valid run ranks");

    assert_eq!(accepted.board, "overflow");
    assert_eq!(accepted.score, live.score, "server score == live score");
    assert_eq!(accepted.score_version, live.score_version);
    assert_eq!(accepted.won, live.won);
}

/// Un cliente que altera un byte del stream de entrada no recupera la corrida
/// original: el servidor re-simula y obtiene una corrida distinta. El puntaje del
/// cliente nunca entra en el cálculo porque el contrato no lo trae.
#[test]
fn tampered_input_frame_verifies_to_a_different_run() {
    let (log, live) = record_with_outcome(MODE_OVERFLOW, 0, 21, FLAG_AUTO_RELOAD, true, 6_000);
    let tampered = flip_first_input_value_byte(&log).expect("a fired log carries input values");

    let decoded = bp_core::decode(&tampered).expect("the flip stays inside the BPL1 grammar");
    let verified = bp_core::run(&decoded).expect("the flipped log still re-simulates");
    let honest = bp_core::run_bytes(&log).expect("the honest log verifies");
    assert_eq!(honest.score, live.score, "parity premise: the honest log scores what the live run scored");
    assert_ne!(verified.hash, honest.hash, "the honest run is no longer what plays");
}

/// Trampas estructurales, cada una con el código exacto que devuelve el servidor:
/// mask desconocido (400), ticks inflados con relleno tras el fin (422) y
/// registro truncado (400). Nada pánico, nada aceptado.
#[test]
fn structurally_tampered_logs_are_rejected_with_their_exact_codes() {
    let (log, _) = record_with_outcome(MODE_OVERFLOW, 0, 21, FLAG_AUTO_RELOAD, true, 6_000);
    let store = MemoryStore::default();

    // Mask con un bit desconocido en el primer frame (byte[17] es el mask del frame
    // que empieza en 16): BadField en decode → 400.
    let mut bad_mask = log.clone();
    bad_mask[FIRST_FRAME + 1] = 0x20;
    let err = submit(&store, &sub(&body("CHEAT", &bad_mask), CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::MalformedLog);
    assert_eq!((err.status(), err.code()), (400, "malformed_log"));

    // Ticks inflados y frames de relleno tras el fin de la partida:
    // TickMismatch en run → 422 log_invalid.
    let mut inflated = log.clone();
    let ticks = u32::from_le_bytes(inflated[TICKS_OFFSET..TICKS_OFFSET + 4].try_into().unwrap());
    inflated[TICKS_OFFSET..TICKS_OFFSET + 4].copy_from_slice(&(ticks + 1).to_le_bytes());
    inflated.extend_from_slice(&[0, 0]);
    assert_eq!(
        bp_core::run_bytes(&inflated).unwrap_err(),
        ReplayError::TickMismatch
    );
    let err = submit(&store, &sub(&body("CHEAT", &inflated), CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::LogInvalid);
    assert_eq!((err.status(), err.code()), (422, "log_invalid"));

    // Registro truncado un byte: Truncated en decode → 400, sin pánico.
    let err = submit(&store, &sub(&body("CHEAT", &log[..log.len() - 1]), CLIENT)).unwrap_err();
    assert_eq!(err, ApiError::MalformedLog);
    assert_eq!(err.status(), 400);

    assert_eq!(store.total("overflow").unwrap(), 0, "nothing entered the board");
}

/// Fuzz pequeño pero real: 256 mutaciones aleatorias (volteos de byte, truncados
/// y basura al final) sobre un registro válido nunca panean ni cuelgan `submit`,
/// y el almacén sigue respondiendo después.
#[test]
fn mutated_and_truncated_logs_never_panic_and_never_poison_the_board() {
    let (log, _) = record_with_outcome(MODE_OVERFLOW, 0, 21, FLAG_AUTO_RELOAD, true, 6_000);
    let store = MemoryStore::default();
    let mut state = 0x9E37_79B9_7F4A_7C15u64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for _ in 0..256u32 {
        let mut mutant = log.clone();
        match next() % 3 {
            0 => {
                let at = (next() as usize) % mutant.len();
                mutant[at] ^= (1 + next() % 255) as u8;
            }
            1 => {
                let cut = (next() as usize) % (mutant.len() + 1);
                mutant.truncate(cut);
            }
            _ => {
                for _ in 0..1 + next() % 8 {
                    mutant.push((next() % 256) as u8);
                }
            }
        }
        let _ = submit(&store, &sub(&body("FUZZ", &mutant), CLIENT));
    }
    let _ = store.total("overflow").expect("store still answers");
}

/// Primer frame del cuerpo: la cabecera BPL1 es fija de 16 bytes.
const FIRST_FRAME: usize = 16;
