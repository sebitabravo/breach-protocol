//! Saneado del nombre en el tablero (contrato: 1-16 caracteres tras recortar).

use crate::error::ApiError;

pub const MAX_NAME_CHARS: usize = 16;

/// Quita todo lo que no sea letra, dígito, espacio, `_`, `-` o `.`; recorta los bordes y
/// valida el largo sobre el resultado. Las letras son Unicode, así que "José" se conserva.
/// Un nombre que queda demasiado largo se rechaza: no se trunca en silencio.
pub fn sanitize_name(raw: &str) -> Result<String, ApiError> {
    let kept: String = raw.chars().filter(|&c| is_allowed(c)).collect();
    let trimmed = kept.trim();
    let len = trimmed.chars().count();
    if len == 0 || len > MAX_NAME_CHARS {
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
    fn strips_disallowed_characters_then_trims() {
        assert_eq!(sanitize_name("  Seb<i>ta!  ").unwrap(), "Sebita");
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
    fn drops_control_characters_and_pipes_used_as_member_separator() {
        assert_eq!(sanitize_name("ab|c\u{0007}d\n").unwrap(), "abcd");
    }

    #[test]
    fn rejects_when_nothing_survives_stripping() {
        assert_eq!(sanitize_name("<<<>>>"), Err(ApiError::BadName));
        assert_eq!(sanitize_name("   \t  "), Err(ApiError::BadName));
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
    }
}
