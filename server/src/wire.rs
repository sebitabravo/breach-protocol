//! Glue con Vercel: lectura acotada del cuerpo, encabezados y respuestas JSON.

use bytes::Bytes;
use http_body::Body;
use http_body_util::{BodyExt, LengthLimitError, Limited};
use serde_json::Value;
use vercel_runtime::{Error, Request, Response};

use crate::error::ApiError;
use crate::MAX_BODY_BYTES;

/// Lee el cuerpo sin pasar de `MAX_BODY_BYTES`. Excederlo es 413, no un error de lectura.
pub async fn read_capped<B>(body: B) -> Result<Vec<u8>, ApiError>
where
    B: Body<Data = Bytes>,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    match Limited::new(body, MAX_BODY_BYTES).collect().await {
        Ok(collected) => Ok(collected.to_bytes().to_vec()),
        Err(err) if err.downcast_ref::<LengthLimitError>().is_some() => Err(ApiError::BodyTooLarge),
        Err(_) => Err(ApiError::BadRequest),
    }
}

pub fn header_value(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

pub fn json_response(
    status: u16,
    body: &Value,
    headers: &[(&str, &str)],
) -> Result<Response<String>, Error> {
    let mut builder = Response::builder()
        .status(status)
        .header("content-type", "application/json; charset=utf-8")
        .header("x-content-type-options", "nosniff");
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    Ok(builder.body(body.to_string())?)
}

/// Los errores nunca se cachean.
pub fn error_response(err: ApiError) -> Result<Response<String>, Error> {
    json_response(
        err.status(),
        &err.to_json(),
        &[("cache-control", "no-store")],
    )
}

#[cfg(test)]
mod tests {
    use http_body_util::Full;

    use super::*;

    #[tokio::test]
    async fn reads_a_body_within_the_cap() {
        let bytes = read_capped(Full::new(Bytes::from_static(b"{}"))).await;
        assert_eq!(bytes, Ok(b"{}".to_vec()));
    }

    #[tokio::test]
    async fn accepts_a_body_of_exactly_the_cap() {
        let exact = vec![b' '; MAX_BODY_BYTES];
        let read = read_capped(Full::new(Bytes::from(exact.clone()))).await;
        assert_eq!(read, Ok(exact));
    }

    #[tokio::test]
    async fn one_byte_over_the_cap_is_413_not_a_read_error() {
        let over = vec![b' '; MAX_BODY_BYTES + 1];
        let read = read_capped(Full::new(Bytes::from(over))).await;
        assert_eq!(read, Err(ApiError::BodyTooLarge));
    }

    #[tokio::test]
    async fn a_body_that_fails_while_reading_is_400() {
        struct Broken;
        impl Body for Broken {
            type Data = Bytes;
            type Error = std::io::Error;
            fn poll_frame(
                self: std::pin::Pin<&mut Self>,
                _: &mut std::task::Context<'_>,
            ) -> std::task::Poll<Option<Result<http_body::Frame<Bytes>, Self::Error>>> {
                std::task::Poll::Ready(Some(Err(std::io::Error::other("client went away"))))
            }
        }
        assert_eq!(read_capped(Broken).await, Err(ApiError::BadRequest));
    }
}
