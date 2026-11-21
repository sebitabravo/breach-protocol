//! Saneado del nombre en el tablero (contrato: 1-16 caracteres tras recortar).

use crate::error::ApiError;

pub const MAX_NAME_CHARS: usize = 16;

/// Recorta espacios Unicode no de control en los bordes. Valida (no filtra ni normaliza)
/// el resto del nombre, en escalares Unicode, igual que el cliente.
pub fn sanitize_name(raw: &str) -> Result<String, ApiError> {
    let trimmed = raw.trim_matches(|c: char| c.is_whitespace() && !c.is_control());
    let len = trimmed.chars().count();
    if len == 0 || len > MAX_NAME_CHARS || !trimmed.chars().all(is_allowed) {
        return Err(ApiError::BadName);
    }
    Ok(trimmed.to_string())
}

fn is_allowed(c: char) -> bool {
    c.is_alphabetic() || c.is_ascii_digit() || matches!(c, ' ' | '_' | '-' | '.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_plain_names_unchanged() {
        assert_eq!(sanitize_name("SEBITA").unwrap(), "SEBITA");
    }

    #[test]
    fn trims_whitespace_but_rejects_disallowed_symbols() {
        assert_eq!(sanitize_name("  Ana  ").unwrap(), "Ana");
        assert_eq!(sanitize_name("\u{85}Ana"), Err(ApiError::BadName));
        assert_eq!(sanitize_name("\u{a0}Ana\u{3000}").unwrap(), "Ana");
        assert_eq!(sanitize_name("  Seb<i>ta!  "), Err(ApiError::BadName));
    }

    #[test]
    fn keeps_letters_digits_space_underscore_hyphen_and_dot() {
        assert_eq!(sanitize_name("a_b-c.d 9").unwrap(), "a_b-c.d 9");
    }

    #[test]
    fn keeps_unicode_letters_so_spanish_names_survive() {
        assert_eq!(sanitize_name("José Ñuñoa").unwrap(), "José Ñuñoa");
    }

    #[test]
    fn rejects_control_format_and_pipe_characters() {
        for name in [
            "a|b",
            "a\u{0007}b",
            "\tAna",
            "Ana\n",
            "Jo\u{200d}sé",
            "Ana\u{feff}",
        ] {
            assert_eq!(sanitize_name(name), Err(ApiError::BadName), "{name:?}");
        }
    }

    #[test]
    fn rejects_empty_and_all_space_names() {
        assert_eq!(sanitize_name(""), Err(ApiError::BadName));
        assert_eq!(sanitize_name("   "), Err(ApiError::BadName));
    }

    #[test]
    fn accepts_exactly_sixteen_characters() {
        let sixteen = "a".repeat(MAX_NAME_CHARS);
        assert_eq!(sanitize_name(&sixteen).unwrap(), sixteen);
    }

    #[test]
    fn rejects_seventeen_characters_instead_of_truncating() {
        let seventeen = "a".repeat(MAX_NAME_CHARS + 1);
        assert_eq!(sanitize_name(&seventeen), Err(ApiError::BadName));
    }

    #[test]
    fn counts_characters_not_bytes() {
        let sixteen_accents = "ñ".repeat(MAX_NAME_CHARS);
        assert_eq!(sanitize_name(&sixteen_accents).unwrap(), sixteen_accents);
        let astral = "𐐀".repeat(MAX_NAME_CHARS);
        assert_eq!(sanitize_name(&astral).unwrap(), astral);
        assert_eq!(sanitize_name(&(astral + "𐐀")), Err(ApiError::BadName));
    }
}
