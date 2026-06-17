use std::fs;
use std::path::PathBuf;

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

pub fn decrypt_secret(encrypted: &str) -> AppResult<String> {
    let key = load_or_create_master_key()?;
    let (nonce_b64, ciphertext_b64) = encrypted
        .split_once(':')
        .ok_or_else(|| secret_error("decrypt", "invalid encrypted secret format"))?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| secret_error("decrypt", error))?;
    let nonce_bytes = STANDARD
        .decode(nonce_b64.trim())
        .map_err(|error| secret_error("decrypt", error))?;
    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);
    let ciphertext = STANDARD
        .decode(ciphertext_b64.trim())
        .map_err(|error| secret_error("decrypt", error))?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|error| secret_error("decrypt", error))?;
    String::from_utf8(plaintext).map_err(|error| secret_error("decrypt", error))
}

pub fn mask_secret(secret: &str) -> String {
    if secret.chars().count() > 4 {
        let visible: String = secret.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
        let masked_len = secret.chars().count() - 4;
        format!("{}{}", "*".repeat(masked_len), visible)
    } else {
        "****".to_string()
    }
}

pub fn encrypt_secret(secret: &str) -> AppResult<String> {
    let key = load_or_create_master_key()?;
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

fn load_or_create_master_key() -> AppResult<Vec<u8>> {
    let path = master_key_path()?;
    if let Some(key) = read_master_key_file(&path)? {
        return Ok(key);
    }
    if let Some(key) = read_master_key_from_keyring()? {
        write_master_key_file(&path, &key)?;
        return Ok(key);
    }
    create_master_key(&path)
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

fn create_master_key(path: &PathBuf) -> AppResult<Vec<u8>> {
    let key = Aes256Gcm::generate_key(&mut OsRng);
    let bytes = key.to_vec();
    write_master_key_file(path, &bytes)?;
    if let Ok(entry) = keyring_entry() {
        let _ = entry.set_password(&STANDARD.encode(&bytes));
    }
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
}