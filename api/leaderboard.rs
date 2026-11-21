//! `GET /api/leaderboard`: entradas de un tablero, con el límite acotado a 1..=50.

use bp_server::error::ApiError;
use bp_server::leaderboard::{parse_query, read};
use bp_server::upstash::Upstash;
use bp_server::wire::{error_response, json_response, now_unix};
use vercel_runtime::{run, service_fn, Error, Request, Response};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

async fn handler(req: Request) -> Result<Response<String>, Error> {
    handle(
        req,
        || Upstash::from_env().map_err(ApiError::from),
        now_unix,
    )
    .await
}

pub(crate) async fn handle<B, S>(
    req: http::Request<B>,
    store: impl FnOnce() -> Result<S, ApiError>,
    now: impl FnOnce() -> Result<u64, ApiError>,
) -> Result<Response<String>, Error>
where
    S: bp_server::store::Store + 'static,
{
    if req.method().as_str() != "GET" {
        let error = ApiError::MethodNotAllowed;
        return json_response(
            error.status(),
            &error.to_json(),
            &[("allow", "GET"), ("cache-control", "no-store")],
        );
    }

    let now = match now() {
        Ok(now) => now,
        Err(error) => return error_response(error),
    };
    let (board, limit) = match parse_query(req.uri().query(), now) {
        Ok(selection) => selection,
        Err(error) => return error_response(error),
    };
    // No servir un tablero diario caducado desde el CDN al pasar medianoche UTC.
    let cache = if board.starts_with("daily:") {
        "no-store"
    } else {
        "public, s-maxage=5, stale-while-revalidate=30"
    };
    let store = match store() {
        Ok(store) => store,
        Err(error) => return error_response(error),
    };

    let outcome = tokio::task::spawn_blocking(move || read(&store, &board, limit)).await;
    match outcome {
        Ok(Ok(json)) => json_response(200, &json, &[("cache-control", cache)]),
        Ok(Err(error)) => error_response(error),
        Err(_) => error_response(ApiError::Internal),
    }
}
