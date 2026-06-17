use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let target = env::var("TARGET").expect("TARGET must be set by Cargo");
    println!("cargo:rustc-env=TARGET_TRIPLE={target}");

    copy_whisper_runtime_to_target();

    tauri_build::build();
}

fn copy_whisper_runtime_to_target() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let runtime_dir = manifest_dir.join("binaries").join("whisper-runtime");
    if !runtime_dir.is_dir() {
        return;
    }

    let target_dir = manifest_dir.join("..").join("target").join(&profile);
    if !target_dir.is_dir() {
        return;
    }

    println!("cargo:rerun-if-changed={}", runtime_dir.display());
    if let Ok(entries) = fs::read_dir(&runtime_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let dest = target_dir.join(entry.file_name());
            if let Err(error) = fs::copy(&path, &dest) {
                println!(
                    "cargo:warning=failed to copy whisper runtime {}: {error}",
                    path.display()
                );
            }
        }
    }
}