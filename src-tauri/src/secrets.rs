use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::Aes256Gcm;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use directories::ProjectDirs;
use keyring::Entry;

use crate::errors::{AppError, AppResult};

const KEYRING_SERVICE: &str = "repix-local";
const KEYRING_USER: &str = "provider-master-key";
const MASTER_KEY_FILE: &str = "master.key";
const MASTER_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

static CANONICAL_MASTER_KEY: OnceLock<Vec<u8>> = OnceLock::new();

pub fn decrypt_secret(encrypted: &str) -> AppResult<String> {
    let (nonce_bytes, ciphertext) = parse_encrypted_payload(encrypted)?;
    let candidates = load_existing_master_keys()?;
    if candidates.is_empty() {
        return Err(secret_error(
            "decrypt",
            "no master encryption key available",
        ));
    }

    let mut key_mismatch = false;
    for key in candidates {
        match try_decrypt_with_key(&nonce_bytes, &ciphertext, &key) {
            Ok(plaintext) => {
                remember_canonical_master_key(&key);
                persist_master_key_if_needed(&key)?;
                return Ok(plaintext);
            }
            Err(DecryptAttempt::KeyMismatch) => key_mismatch = true,
            Err(DecryptAttempt::InvalidPlaintext(error)) => {
                return Err(secret_error("decrypt", error));
            }
        }
    }

    if key_mismatch {
        return Err(secret_error(
            "decrypt",
            "encryption key mismatch - re-enter API keys in Settings",
        ));
    }
    Err(secret_error("decrypt", "no master encryption key available"))
}

pub fn mask_secret(secret: &str) -> String {
    if secret.chars().count() > 4 {
        let visible: String = secret
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let masked_len = secret.chars().count() - 4;
        format!("{}{}", "*".repeat(masked_len), visible)
    } else {
        "****".to_string()
    }
}

pub fn encrypt_secret(secret: &str) -> AppResult<String> {
    let key = resolve_master_key_for_encrypt()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| secret_error("encrypt", error))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, secret.as_bytes())
        .map_err(|error| secret_error("encrypt", error))?;
    Ok(format!(
        "{}:{}",
        STANDARD.encode(nonce),
        STANDARD.encode(ciphertext)
    ))
}

#[derive(Debug)]
enum DecryptAttempt {
    KeyMismatch,
    InvalidPlaintext(String),
}

fn parse_encrypted_payload(encrypted: &str) -> AppResult<(Vec<u8>, Vec<u8>)> {
    let (nonce_b64, ciphertext_b64) = encrypted
        .split_once(':')
        .ok_or_else(|| secret_error("decrypt", "invalid encrypted secret format"))?;
    let nonce_bytes = STANDARD
        .decode(nonce_b64.trim())
        .map_err(|error| secret_error("decrypt", error))?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err(secret_error(
            "decrypt",
            format!("invalid encrypted secret format: expected {NONCE_LEN}-byte nonce"),
        ));
    }
    let ciphertext = STANDARD
        .decode(ciphertext_b64.trim())
        .map_err(|error| secret_error("decrypt", error))?;
    Ok((nonce_bytes, ciphertext))
}

fn try_decrypt_with_key(
    nonce_bytes: &[u8],
    ciphertext: &[u8],
    key: &[u8],
) -> Result<String, DecryptAttempt> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|error| {
        DecryptAttempt::InvalidPlaintext(format!("invalid master key: {error}"))
    })?;
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| DecryptAttempt::KeyMismatch)?;
    String::from_utf8(plaintext)
        .map_err(|error| DecryptAttempt::InvalidPlaintext(error.to_string()))
}

fn resolve_master_key_for_encrypt() -> AppResult<Vec<u8>> {
    if let Some(key) = CANONICAL_MASTER_KEY.get() {
        return Ok(key.clone());
    }

    let path = master_key_path()?;
    let file_key = read_master_key_file(&path)?;
    let keyring_key = read_master_key_from_keyring()?;

    match (&file_key, &keyring_key) {
        (Some(file), Some(keyring)) if file == keyring => {
            remember_canonical_master_key(file);
            Ok(file.clone())
        }
        (Some(_), Some(_)) => Err(secret_error(
            "encrypt",
            "local encryption keys are out of sync — re-enter API keys in Settings",
        )),
        (Some(file), None) => {
            persist_master_key(file)?;
            remember_canonical_master_key(file);
            Ok(file.clone())
        }
        (None, Some(keyring)) => {
            persist_master_key(keyring)?;
            remember_canonical_master_key(keyring);
            Ok(keyring.clone())
        }
        (None, None) => create_master_key(),
    }
}

fn load_existing_master_keys() -> AppResult<Vec<Vec<u8>>> {
    let path = master_key_path()?;
    let mut candidates = Vec::new();
    if let Some(key) = read_master_key_file(&path)? {
        candidates.push(key);
    }
    if let Some(key) = read_master_key_from_keyring()? {
        if !candidates.iter().any(|existing| existing == &key) {
            candidates.push(key);
        }
    }
    Ok(candidates)
}

fn remember_canonical_master_key(key: &[u8]) {
    let _ = CANONICAL_MASTER_KEY.get_or_init(|| key.to_vec());
}

fn persist_master_key_if_needed(key: &[u8]) -> AppResult<()> {
    let path = master_key_path()?;
    let file_key = read_master_key_file(&path)?;
    let keyring_key = read_master_key_from_keyring()?;
    let key_vec = key.to_vec();
    if file_key.as_ref() == Some(&key_vec) && keyring_key.as_ref() == Some(&key_vec) {
        return Ok(());
    }
    persist_master_key(key)
}

fn persist_master_key(key: &[u8]) -> AppResult<()> {
    let path = master_key_path()?;
    write_master_key_file(&path, key)?;
    if let Ok(entry) = keyring_entry() {
        let _ = entry.set_password(&STANDARD.encode(key));
    }
    Ok(())
}

fn read_master_key_file(path: &PathBuf) -> AppResult<Option<Vec<u8>>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|error| secret_error("read master key file", error))?;
    if bytes.len() == MASTER_KEY_LEN {
        return Ok(Some(bytes));
    }
    let _ = fs::remove_file(path);
    Ok(None)
}

fn write_master_key_file(path: &PathBuf, key: &[u8]) -> AppResult<()> {
    if key.len() != MASTER_KEY_LEN {
        return Err(secret_error(
            "write master key file",
            format!("expected {MASTER_KEY_LEN} bytes, got {}", key.len()),
        ));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| secret_error("write master key file", error))?;
    }
    fs::write(path, key).map_err(|error| secret_error("write master key file", error))
}

fn read_master_key_from_keyring() -> AppResult<Option<Vec<u8>>> {
    let entry = keyring_entry()?;
    let value = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(secret_error("read keyring", error)),
    };
    let decoded = STANDARD
        .decode(value.trim())
        .map_err(|error| secret_error("decode keyring master key", error))?;
    if decoded.len() == MASTER_KEY_LEN {
        return Ok(Some(decoded));
    }
    let _ = entry.delete_credential();
    Ok(None)
}

fn create_master_key() -> AppResult<Vec<u8>> {
    let key = Aes256Gcm::generate_key(&mut OsRng);
    let bytes = key.to_vec();
    persist_master_key(&bytes)?;
    remember_canonical_master_key(&bytes);
    Ok(bytes)
}

fn master_key_path() -> AppResult<PathBuf> {
    let dirs = ProjectDirs::from("local", "RePix", "RePixLocal").ok_or_else(|| {
        secret_error("resolve data dir", "cannot resolve application data directory")
    })?;
    Ok(dirs.data_dir().join(MASTER_KEY_FILE))
}

fn keyring_entry() -> AppResult<Entry> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|error| secret_error("keyring entry", error))
}

fn secret_error(context: &str, error: impl std::fmt::Display) -> AppError {
    AppError::Config(format!("secret storage unavailable ({context}): {error}"))
}

#[cfg(test)]
mod tests {
    use super::mask_secret;
    use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
    use aes_gcm::Aes256Gcm;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    #[test]
    fn mask_secret_hides_middle_chars() {
        assert_eq!(mask_secret("sk-abcdefghij"), "*********ghij");
    }

    #[test]
    fn mask_secret_short_value() {
        assert_eq!(mask_secret("ab"), "****");
    }

    #[test]
    fn aes_roundtrip_matches_storage_format() {
        let key = [7u8; 32];
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, b"sk-provider-test".as_ref()).unwrap();
        let encoded = format!(
            "{}:{}",
            STANDARD.encode(nonce),
            STANDARD.encode(ciphertext)
        );
        let (nonce_b64, ciphertext_b64) = encoded.split_once(':').unwrap();
        let nonce_bytes = STANDARD.decode(nonce_b64).unwrap();
        let ciphertext_bytes = STANDARD.decode(ciphertext_b64).unwrap();
        let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);
        let plaintext = cipher
            .decrypt(nonce, ciphertext_bytes.as_ref())
            .unwrap();
        assert_eq!(plaintext, b"sk-provider-test");
    }

    #[test]
    fn decrypt_falls_back_to_alternate_master_key() {
        use super::{try_decrypt_with_key, DecryptAttempt};

        let primary = [1u8; 32];
        let alternate = [2u8; 32];
        let cipher = Aes256Gcm::new_from_slice(&alternate).unwrap();
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, b"provider-secret".as_ref())
            .unwrap();

        assert!(matches!(
            try_decrypt_with_key(nonce.as_slice(), &ciphertext, &primary),
            Err(DecryptAttempt::KeyMismatch)
        ));
        let plaintext =
            try_decrypt_with_key(nonce.as_slice(), &ciphertext, &alternate).expect("decrypt");
        assert_eq!(plaintext, "provider-secret");
    }

    #[test]
    fn parse_encrypted_payload_rejects_invalid_nonce_length() {
        use super::parse_encrypted_payload;

        let err = parse_encrypted_payload("YQ==:Ym9keQ==").expect_err("short nonce");
        assert!(err.to_string().contains("12-byte nonce"));
    }
}
