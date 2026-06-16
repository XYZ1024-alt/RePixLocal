use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::Aes256Gcm;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use keyring::Entry;

use crate::errors::{AppError, AppResult};

const KEYRING_SERVICE: &str = "repix-local";
const KEYRING_USER: &str = "provider-master-key";

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
