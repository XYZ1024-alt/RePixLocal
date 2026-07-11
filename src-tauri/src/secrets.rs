use std::fs;
use std::path::Path;
use std::sync::OnceLock;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::Aes256Gcm;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use keyring::Entry;

use crate::errors::{AppError, AppResult};

const KEYRING_SERVICE: &str = "repix-local";
const KEYRING_USER: &str = "provider-master-key";
const MASTER_KEY_FILE: &str = "master.key";
const MASTER_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

type MasterKey = [u8; MASTER_KEY_LEN];

static SECRET_MANAGER: OnceLock<SecretManager> = OnceLock::new();

pub fn initialize_secret_storage(workspace_root: &Path) -> AppResult<()> {
    let backend = KeyringBackend::new()?;
    let manager = SecretManager::initialize(&workspace_root.join(MASTER_KEY_FILE), &backend)?;
    SECRET_MANAGER
        .set(manager)
        .map_err(|_| secret_error("initialize", "secret storage was already initialized"))
}

pub fn decrypt_secret(encrypted: &str) -> AppResult<String> {
    secret_manager()?.decrypt(encrypted)
}

pub fn encrypt_secret(secret: &str) -> AppResult<String> {
    secret_manager()?.encrypt(secret)
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

fn secret_manager() -> AppResult<&'static SecretManager> {
    SECRET_MANAGER
        .get()
        .ok_or_else(|| secret_error("access", "secret storage is not initialized"))
}

#[derive(Debug)]
struct SecretManager {
    key: MasterKey,
}

impl SecretManager {
    fn initialize<B: MasterKeyBackend + ?Sized>(
        legacy_path: &Path,
        backend: &B,
    ) -> AppResult<Self> {
        let legacy_key = read_legacy_master_key(legacy_path)?;
        let keyring_key = backend.load()?;

        let key = match (legacy_key, keyring_key) {
            (None, Some(key)) => key,
            (None, None) => {
                let key = generate_master_key();
                store_and_verify_key(backend, &key)?;
                key
            }
            (Some(legacy), None) => {
                store_and_verify_key(backend, &legacy)?;
                remove_legacy_master_key(legacy_path)?;
                legacy
            }
            (Some(legacy), Some(keyring)) if legacy == keyring => {
                store_and_verify_key(backend, &legacy)?;
                remove_legacy_master_key(legacy_path)?;
                keyring
            }
            (Some(_), Some(_)) => {
                return Err(secret_error(
                    "migrate legacy master key",
                    "legacy master key conflicts with OS credential; no key was changed",
                ));
            }
        };

        Ok(Self { key })
    }

    fn decrypt(&self, encrypted: &str) -> AppResult<String> {
        let (nonce_bytes, ciphertext) = parse_encrypted_payload(encrypted)?;
        match try_decrypt_with_key(&nonce_bytes, &ciphertext, &self.key) {
            Ok(plaintext) => Ok(plaintext),
            Err(DecryptAttempt::KeyMismatch) => Err(secret_error(
                "decrypt",
                "encryption key mismatch - restore the original OS credential or re-enter API keys",
            )),
            Err(DecryptAttempt::InvalidPlaintext(error)) => Err(secret_error("decrypt", error)),
        }
    }

    fn encrypt(&self, secret: &str) -> AppResult<String> {
        let cipher =
            Aes256Gcm::new_from_slice(&self.key).map_err(|error| secret_error("encrypt", error))?;
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
}

trait MasterKeyBackend {
    fn load(&self) -> AppResult<Option<MasterKey>>;
    fn store(&self, key: &MasterKey) -> AppResult<()>;
}

struct KeyringBackend {
    entry: Entry,
}

impl KeyringBackend {
    fn new() -> AppResult<Self> {
        let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|error| secret_error("create keyring entry", error))?;
        Ok(Self { entry })
    }
}

impl MasterKeyBackend for KeyringBackend {
    fn load(&self) -> AppResult<Option<MasterKey>> {
        let value = match self.entry.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(error) => return Err(secret_error("read keyring", error)),
        };
        decode_keyring_master_key(&value).map(Some)
    }

    fn store(&self, key: &MasterKey) -> AppResult<()> {
        self.entry
            .set_password(&STANDARD.encode(key))
            .map_err(|error| secret_error("write keyring", error))
    }
}

fn store_and_verify_key<B: MasterKeyBackend + ?Sized>(
    backend: &B,
    key: &MasterKey,
) -> AppResult<()> {
    backend.store(key)?;
    let stored = backend.load()?.ok_or_else(|| {
        secret_error(
            "verify keyring",
            "OS credential was missing immediately after it was written",
        )
    })?;
    if stored != *key {
        return Err(secret_error(
            "verify keyring",
            "OS credential did not match the master key that was written",
        ));
    }
    Ok(())
}

fn read_legacy_master_key(path: &Path) -> AppResult<Option<MasterKey>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(secret_error("read legacy master key", error)),
    };
    decode_master_key_bytes("read legacy master key", bytes).map(Some)
}

fn remove_legacy_master_key(path: &Path) -> AppResult<()> {
    fs::remove_file(path).map_err(|error| secret_error("remove legacy master key", error))
}

fn decode_keyring_master_key(value: &str) -> AppResult<MasterKey> {
    let decoded = STANDARD
        .decode(value.trim())
        .map_err(|error| secret_error("decode keyring master key", error))?;
    decode_master_key_bytes("decode keyring master key", decoded)
}

fn decode_master_key_bytes(context: &str, bytes: Vec<u8>) -> AppResult<MasterKey> {
    let actual_len = bytes.len();
    bytes.try_into().map_err(|_| {
        secret_error(
            context,
            format!("expected {MASTER_KEY_LEN} bytes, got {actual_len}"),
        )
    })
}

fn generate_master_key() -> MasterKey {
    let generated = Aes256Gcm::generate_key(&mut OsRng);
    generated
        .as_slice()
        .try_into()
        .expect("AES-256-GCM generated a key with an invalid length")
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
    key: &MasterKey,
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

fn secret_error(context: &str, error: impl std::fmt::Display) -> AppError {
    AppError::Config(format!("secret storage unavailable ({context}): {error}"))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use uuid::Uuid;

    use super::*;

    const LEGACY_KEY: MasterKey = [7; MASTER_KEY_LEN];
    const OTHER_KEY: MasterKey = [9; MASTER_KEY_LEN];

    #[derive(Default)]
    struct FakeBackend {
        state: Mutex<FakeBackendState>,
    }

    #[derive(Default)]
    struct FakeBackendState {
        key: Option<MasterKey>,
        load_error: Option<String>,
        store_error: Option<String>,
        load_error_after_store: Option<String>,
        discard_stored_key: bool,
        stored_override: Option<MasterKey>,
        store_count: usize,
    }

    impl FakeBackend {
        fn with_key(key: MasterKey) -> Self {
            Self {
                state: Mutex::new(FakeBackendState {
                    key: Some(key),
                    ..Default::default()
                }),
            }
        }

        fn key(&self) -> Option<MasterKey> {
            self.state.lock().expect("fake backend lock").key
        }

        fn store_count(&self) -> usize {
            self.state.lock().expect("fake backend lock").store_count
        }
    }

    impl MasterKeyBackend for FakeBackend {
        fn load(&self) -> AppResult<Option<MasterKey>> {
            let state = self.state.lock().expect("fake backend lock");
            if let Some(error) = &state.load_error {
                return Err(secret_error("fake keyring read", error));
            }
            if state.store_count > 0 {
                if let Some(error) = &state.load_error_after_store {
                    return Err(secret_error("fake keyring verify", error));
                }
            }
            Ok(state.key)
        }

        fn store(&self, key: &MasterKey) -> AppResult<()> {
            let mut state = self.state.lock().expect("fake backend lock");
            if let Some(error) = &state.store_error {
                return Err(secret_error("fake keyring write", error));
            }
            state.store_count += 1;
            if !state.discard_stored_key {
                state.key = Some(state.stored_override.unwrap_or(*key));
            }
            Ok(())
        }
    }

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("repix-secret-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create secret test dir");
            Self(path)
        }

        fn legacy_path(&self) -> PathBuf {
            self.0.join(MASTER_KEY_FILE)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn mask_secret_hides_middle_chars() {
        assert_eq!(mask_secret("sk-abcdefghij"), "*********ghij");
    }

    #[test]
    fn mask_secret_short_value() {
        assert_eq!(mask_secret("ab"), "****");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn default_keyring_backend_persists_until_deleted() {
        use keyring::credential::CredentialPersistence;

        assert!(matches!(
            keyring::default::default_credential_builder().persistence(),
            CredentialPersistence::UntilDelete
        ));
    }

    #[test]
    fn new_install_persists_and_verifies_keyring_key() {
        let dir = TestDir::new();
        let backend = FakeBackend::default();

        let manager = SecretManager::initialize(&dir.legacy_path(), &backend).expect("initialize");

        assert_eq!(backend.key(), Some(manager.key));
        assert_eq!(backend.store_count(), 1);
        assert!(!dir.legacy_path().exists());
    }

    #[test]
    fn legacy_key_migrates_without_reencrypting_existing_payload() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), LEGACY_KEY).expect("write legacy key");
        let encrypted = SecretManager { key: LEGACY_KEY }
            .encrypt("sk-provider-test")
            .expect("encrypt legacy payload");
        let backend = FakeBackend::default();

        let manager = SecretManager::initialize(&dir.legacy_path(), &backend).expect("migrate");

        assert_eq!(backend.key(), Some(LEGACY_KEY));
        assert!(!dir.legacy_path().exists());
        assert_eq!(
            manager.decrypt(&encrypted).expect("decrypt"),
            "sk-provider-test"
        );
    }

    #[test]
    fn matching_legacy_and_keyring_keys_remove_legacy_file() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), LEGACY_KEY).expect("write legacy key");
        let backend = FakeBackend::with_key(LEGACY_KEY);

        SecretManager::initialize(&dir.legacy_path(), &backend).expect("initialize");

        assert!(!dir.legacy_path().exists());
        assert_eq!(backend.store_count(), 1);
    }

    #[test]
    fn conflicting_keys_fail_without_changing_either_key() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), LEGACY_KEY).expect("write legacy key");
        let backend = FakeBackend::with_key(OTHER_KEY);

        let error = SecretManager::initialize(&dir.legacy_path(), &backend)
            .expect_err("conflict must fail");

        assert!(error.to_string().contains("conflicts with OS credential"));
        assert_eq!(fs::read(dir.legacy_path()).expect("legacy key"), LEGACY_KEY);
        assert_eq!(backend.key(), Some(OTHER_KEY));
        assert_eq!(backend.store_count(), 0);
    }

    #[test]
    fn keyring_write_failure_preserves_legacy_file() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), LEGACY_KEY).expect("write legacy key");
        let backend = FakeBackend::default();
        backend.state.lock().expect("fake backend lock").store_error = Some("denied".into());

        let error = SecretManager::initialize(&dir.legacy_path(), &backend)
            .expect_err("write failure must fail");

        assert!(error.to_string().contains("denied"));
        assert_eq!(fs::read(dir.legacy_path()).expect("legacy key"), LEGACY_KEY);
    }

    #[test]
    fn keyring_readback_failure_preserves_legacy_file() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), LEGACY_KEY).expect("write legacy key");
        let backend = FakeBackend::default();
        backend
            .state
            .lock()
            .expect("fake backend lock")
            .load_error_after_store = Some("readback failed".into());

        let error = SecretManager::initialize(&dir.legacy_path(), &backend)
            .expect_err("readback failure must fail");

        assert!(error.to_string().contains("readback failed"));
        assert_eq!(fs::read(dir.legacy_path()).expect("legacy key"), LEGACY_KEY);
    }

    #[test]
    fn keyring_readback_mismatch_preserves_legacy_file() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), LEGACY_KEY).expect("write legacy key");
        let backend = FakeBackend::default();
        backend
            .state
            .lock()
            .expect("fake backend lock")
            .stored_override = Some(OTHER_KEY);

        let error = SecretManager::initialize(&dir.legacy_path(), &backend)
            .expect_err("readback mismatch must fail");

        assert!(error.to_string().contains("did not match"));
        assert_eq!(fs::read(dir.legacy_path()).expect("legacy key"), LEGACY_KEY);
    }

    #[test]
    fn missing_keyring_readback_preserves_legacy_file() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), LEGACY_KEY).expect("write legacy key");
        let backend = FakeBackend::default();
        backend
            .state
            .lock()
            .expect("fake backend lock")
            .discard_stored_key = true;

        let error = SecretManager::initialize(&dir.legacy_path(), &backend)
            .expect_err("missing readback must fail");

        assert!(error.to_string().contains("missing immediately"));
        assert_eq!(fs::read(dir.legacy_path()).expect("legacy key"), LEGACY_KEY);
    }

    #[test]
    fn invalid_legacy_key_fails_without_deleting_file() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), b"too-short").expect("write invalid legacy key");
        let backend = FakeBackend::default();

        let error = SecretManager::initialize(&dir.legacy_path(), &backend)
            .expect_err("invalid legacy key must fail");

        assert!(error.to_string().contains("expected 32 bytes"));
        assert_eq!(
            fs::read(dir.legacy_path()).expect("legacy key"),
            b"too-short"
        );
        assert_eq!(backend.store_count(), 0);
    }

    #[test]
    fn keyring_read_failure_preserves_legacy_file() {
        let dir = TestDir::new();
        fs::write(dir.legacy_path(), LEGACY_KEY).expect("write legacy key");
        let backend = FakeBackend::default();
        backend.state.lock().expect("fake backend lock").load_error = Some("locked".into());

        let error = SecretManager::initialize(&dir.legacy_path(), &backend)
            .expect_err("keyring read failure must fail");

        assert!(error.to_string().contains("locked"));
        assert_eq!(fs::read(dir.legacy_path()).expect("legacy key"), LEGACY_KEY);
        assert_eq!(backend.store_count(), 0);
    }

    #[test]
    fn malformed_keyring_values_are_rejected() {
        let invalid_base64 = decode_keyring_master_key("not-base64").expect_err("invalid base64");
        assert!(invalid_base64
            .to_string()
            .contains("decode keyring master key"));

        let invalid_length =
            decode_keyring_master_key(&STANDARD.encode([1u8; 8])).expect_err("invalid length");
        assert!(invalid_length.to_string().contains("expected 32 bytes"));
    }

    #[test]
    fn parse_encrypted_payload_rejects_invalid_nonce_length() {
        let error = parse_encrypted_payload("YQ==:Ym9keQ==").expect_err("short nonce");
        assert!(error.to_string().contains("12-byte nonce"));
    }
}
