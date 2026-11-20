//! Identidad del cliente para el límite de tasa. Solo se guarda un HMAC de la IP, nunca la IP.

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Primer salto de `x-forwarded-for`; si falta, `x-real-ip`. Vercel sobrescribe el encabezado
/// y no reenvía IPs externas, así que el primer salto no lo fabrica el cliente.
pub fn client_ip<'a>(forwarded_for: Option<&'a str>, real_ip: Option<&'a str>) -> Option<&'a str> {
    let first_hop = forwarded_for.and_then(|value| value.split(',').next());
    non_empty(first_hop).or_else(|| non_empty(real_ip))
}

/// HMAC-SHA256(sal, ip) truncado a 128 bits, en hex. Sin la sal, cualquiera puede recorrer
/// IPv4 completo y revertir la clave. Sin IP visible se usa un balde compartido `unknown`.
pub fn client_key(salt: &[u8], ip: Option<&str>) -> String {
    let mut mac = HmacSha256::new_from_slice(salt).expect("HMAC accepts keys of any length");
    mac.update(ip.unwrap_or("unknown").as_bytes());
    let digest = mac.finalize().into_bytes();
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_first_hop_of_forwarded_for() {
        assert_eq!(
            client_ip(Some("203.0.113.7, 10.0.0.1"), None),
            Some("203.0.113.7")
        );
    }

    #[test]
    fn falls_back_to_real_ip_when_forwarded_for_is_missing_or_blank() {
        assert_eq!(client_ip(None, Some("198.51.100.2")), Some("198.51.100.2"));
        assert_eq!(
            client_ip(Some("  , 10.0.0.1"), Some("198.51.100.2")),
            Some("198.51.100.2")
        );
        assert_eq!(client_ip(Some(""), None), None);
    }

    #[test]
    fn key_is_128_bit_hex_and_never_contains_the_ip() {
        let key = client_key(b"salt", Some("203.0.113.7"));
        assert_eq!(key.len(), 32);
        assert!(key.bytes().all(|b| b.is_ascii_hexdigit()));
        assert!(!key.contains("203"));
    }

    #[test]
    fn key_depends_on_the_salt() {
        assert_ne!(
            client_key(b"salt-a", Some("203.0.113.7")),
            client_key(b"salt-b", Some("203.0.113.7"))
        );
    }

    #[test]
    fn key_is_stable_for_the_same_salt_and_ip() {
        assert_eq!(
            client_key(b"salt", Some("203.0.113.7")),
            client_key(b"salt", Some("203.0.113.7"))
        );
    }

    #[test]
    fn distinct_ips_get_distinct_keys() {
        assert_ne!(
            client_key(b"salt", Some("203.0.113.7")),
            client_key(b"salt", Some("203.0.113.8"))
        );
    }

    #[test]
    fn missing_ip_shares_the_unknown_bucket() {
        assert_eq!(
            client_key(b"salt", None),
            client_key(b"salt", Some("unknown"))
        );
    }
}
