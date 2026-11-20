//! `GET /api/leaderboard`: entradas de un tablero, con el límite acotado a 1..=50.

use bp_api::error::ApiError;
use bp_api::leaderboard::read;
use bp_api::upstash::Upstash;
use bp_api::wire::{error_response, json_response};
use vercel_runtime::{run, service_fn, Error, Request, Response};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

async fn handler(req: Request) -> Result<Response<String>, Error> {
    if req.method().as_str() != "GET" {
        let error = ApiError::MethodNotAllowed;
        return json_response(
            error.status(),
            &error.to_json(),
            &[("allow", "GET"), ("cache-control", "no-store")],
        );
    }

    let query = req.uri().query().map(str::to_string);
    let store = match Upstash::from_env() {
        Ok(store) => store,
        Err(_) => return error_response(ApiError::StoreUnavailable),
    };

    let outcome = tokio::task::spawn_blocking(move || read(&store, query.as_deref())).await;
    match outcome {
        // Lectura compartida y breve: el CDN puede servirla unos segundos.
        Ok(Ok(json)) => json_response(
            200,
            &json,
            &[(
                "cache-control",
                "public, s-maxage=5, stale-while-revalidate=30",
            )],
        ),
        Ok(Err(error)) => error_response(error),
        Err(_) => error_response(ApiError::Internal),
    }
}
