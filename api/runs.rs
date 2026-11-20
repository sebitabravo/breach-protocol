//! `POST /api/runs`: verifica el registro re-simulado y lo ordena en su tablero.

use std::time::{SystemTime, UNIX_EPOCH};

use bp_server::client::{client_ip, client_key};
use bp_server::error::ApiError;
use bp_server::submit::{submit, Submission};
use bp_server::upstash::Upstash;
use bp_server::wire::{error_response, header_value, json_response, read_capped};
use vercel_runtime::{run, service_fn, Error, Request, Response};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

async fn handler(req: Request) -> Result<Response<String>, Error> {
    if req.method().as_str() != "POST" {
        let error = ApiError::MethodNotAllowed;
        return json_response(
            error.status(),
            &error.to_json(),
            &[("allow", "POST"), ("cache-control", "no-store")],
        );
    }

    // Sin sal configurada la IP no se puede anonimizar: se rechaza en vez de guardarla en claro.
    let Ok(salt) = std::env::var("IP_HASH_SALT") else {
        return error_response(ApiError::StoreUnavailable);
    };
    let forwarded = header_value(&req, "x-forwarded-for");
    let real_ip = header_value(&req, "x-real-ip");
    let client = client_key(
        salt.as_bytes(),
        client_ip(forwarded.as_deref(), real_ip.as_deref()),
    );

    let body = match read_capped(req.into_body()).await {
        Ok(body) => body,
        Err(error) => return error_response(error),
    };
    let store = match Upstash::from_env() {
        Ok(store) => store,
        Err(_) => return error_response(ApiError::StoreUnavailable),
    };
    let now_unix = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => elapsed.as_secs(),
        Err(_) => return error_response(ApiError::Internal),
    };

    // La re-simulación es CPU pura y el almacén bloquea: ninguno debe ocupar el runtime async.
    let outcome = tokio::task::spawn_blocking(move || {
        let submission = Submission {
            body: &body,
            client: &client,
            now_unix,
        };
        submit(&store, &submission).map(|accepted| accepted.to_json())
    })
    .await;

    match outcome {
        Ok(Ok(json)) => json_response(200, &json, &[("cache-control", "no-store")]),
        Ok(Err(error)) => error_response(error),
        Err(_) => error_response(ApiError::Internal),
    }
}
