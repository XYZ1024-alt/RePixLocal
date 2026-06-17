use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::Aes256Gcm;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use keyring::Entry;

use crate::errors::{AppError, AppResult};

const KEYRING_SERVICE: &str = "repix-local";
const KEYRING_USER: &str = "provider-master-key";

pub fn decrypt_secret(encrypted: &str) -> AppResult<String> {
    let key = load_or_create_master_key()?;
    let (nonce_b64, ciphertext_b64) = encrypted
        .split_once(':')
        .ok_or_else(|| secret_error("invalid encrypted secret format"))?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(secret_error)?;
    let nonce_bytes = STANDARD.decode(nonce_b64).map_err(secret_error)?;
    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);
    let ciphertext = STANDARD.decode(ciphertext_b64).map_err(secret_error)?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(secret_error)?;
    String::from_utf8(plaintext).map_err(secret_error)
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
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(secret_error)?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, secret.as_bytes())
        .map_err(secret_error)?;
    Ok(format!(
        "{}:{}",
        STANDARD.encode(nonce),
        STANDARD.encode(ciphertext)
    ))
}

fn load_or_create_master_key() -> AppResult<Vec<u8>> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(value) => STANDARD.decode(value).map_err(secret_error),
        Err(keyring::Error::NoEntry) => create_master_key(&entry),
        Err(error) => Err(secret_error(error)),
    }
}

fn create_master_key(entry: &Entry) -> AppResult<Vec<u8>> {
    let key = Aes256Gcm::generate_key(&mut OsRng);
    entry
        .set_password(&STANDARD.encode(key))
        .map_err(secret_error)?;
    Ok(key.to_vec())
}

fn keyring_entry() -> AppResult<Entry> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(secret_error)
}

fn secret_error(error: impl std::fmt::Display) -> AppError {
    AppError::Config(format!("secret storage unavailable: {error}"))
}
