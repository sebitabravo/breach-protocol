//! `POST /api/runs`: verifica el registro re-simulado y lo ordena en su tablero.

use bp_server::client::{client_ip, client_key};
use bp_server::error::ApiError;
use bp_server::submit::{malformed_response, submit, Submission};
use bp_server::upstash::Upstash;
use bp_server::wire::{error_response, header_value, json_response, now_unix, read_capped};
use vercel_runtime::{run, service_fn, Error, Request, Response};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

async fn handler(req: Request) -> Result<Response<String>, Error> {
    handle(
        req,
        || std::env::var("IP_HASH_SALT").ok(),
        || Upstash::from_env().map_err(ApiError::from),
        now_unix,
    )
    .await
}

pub(crate) async fn handle<B, S>(
    req: http::Request<B>,
    salt: impl FnOnce() -> Option<String>,
    store: impl FnOnce() -> Result<S, ApiError>,
    now: impl FnOnce() -> Result<u64, ApiError>,
) -> Result<Response<String>, Error>
where
    B: http_body::Body<Data = bytes::Bytes>,
    B::Error: Into<Error>,
    S: bp_server::store::Store + 'static,
{
    if req.method().as_str() != "POST" {
        let error = ApiError::MethodNotAllowed;
        return json_response(
            error.status(),
            &error.to_json(),
            &[("allow", "POST"), ("cache-control", "no-store")],
        );
    }

    // Sin sal configurada la IP no se puede anonimizar: se rechaza en vez de guardarla en claro.
    let Some(salt) = salt() else {
        return error_response(ApiError::StoreUnavailable);
    };
    let forwarded = header_value(&req, "x-forwarded-for");
    let real_ip = header_value(&req, "x-real-ip");
    let client = client_key(
        salt.as_bytes(),
        client_ip(forwarded.as_deref(), real_ip.as_deref()),
    );

    let body = read_capped(req.into_body()).await;
    let store = match store() {
        Ok(store) => store,
        Err(error) => return error_response(error),
    };
    let now_unix = match now() {
        Ok(now) => now,
        Err(error) => return error_response(error),
    };

    // La re-simulación es CPU pura y el almacén bloquea: ninguno debe ocupar el runtime async.
    let outcome = tokio::task::spawn_blocking(move || {
        let body = body.map_err(|error| malformed_response(&store, &client, now_unix, error))?;
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
