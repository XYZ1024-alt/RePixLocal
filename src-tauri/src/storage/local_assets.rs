use std::io::Cursor;
use std::path::{Path, PathBuf};

use chrono::Utc;
use image::{ImageFormat, ImageReader};
use serde_json::{json, Value};
use tokio::fs;
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::{Asset, AssetStatus, AssetType};
use crate::workspace::Workspace;

const MINIMAL_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
];

#[derive(Debug, Clone)]
pub struct AssetManager {
    workspace: Workspace,
}

impl AssetManager {
    pub fn new(workspace: Workspace) -> Self {
        Self { workspace }
    }

    pub fn workspace(&self) -> &Workspace {
        &self.workspace
    }

    pub async fn import_source_images(
        &self,
        task_id: &str,
        image_paths: &[String],
    ) -> AppResult<Vec<Asset>> {
        if image_paths.is_empty() {
            return Err(AppError::Workflow(
                "image_to_video task requires at least one image".into(),
            ));
        }
        self.workspace.create_task_layout(task_id).await?;
        let mut assets = Vec::with_capacity(image_paths.len());
        for (index, image_path) in image_paths.iter().enumerate() {
            let source = PathBuf::from(image_path);
            validate_readable_file(&source).await?;
            let target = self.source_image_path(task_id, index as i32);
            normalize_image_to_png(&source, &target).await?;
            assets.push(new_asset(
                task_id,
                None,
                AssetType::SourceImage,
                target,
                Some("image/png".to_string()),
                Some(index as i32),
            ));
        }
        Ok(assets)
    }

    pub async fn import_source_video(&self, task_id: &str, source_path: &str) -> AppResult<Asset> {
        let source = PathBuf::from(source_path);
        validate_readable_file(&source).await?;
        self.workspace.create_task_layout(task_id).await?;
        let target = self.source_target(task_id, &source)?;
        fs::copy(&source, &target).await?;
        Ok(new_asset(
            task_id,
            None,
            AssetType::SourceVideo,
            target,
            Some("video/*".to_string()),
            None,
        ))
    }

    pub fn audio_path(&self, task_id: &str) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("audio")
            .join("audio.wav")
    }

    pub fn narration_path(&self, task_id: &str) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("audio")
            .join("narration.wav")
    }

    pub fn tts_segment_path(&self, task_id: &str, index: i32) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("tts")
            .join(format!("scene_{index}.wav"))
    }

    pub fn source_image_path(&self, task_id: &str, index: i32) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("source")
            .join("images")
            .join(format!("image_{index}.png"))
    }

    pub fn keyframe_path(&self, task_id: &str, index: i32) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("keyframes")
            .join(format!("frame_{:03}.png", index + 1))
    }

    pub fn frame_path(&self, task_id: &str, index: i32) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("frames")
            .join(format!("scene_{index}.png"))
    }

    pub fn segment_path(&self, task_id: &str, index: i32) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("segments")
            .join(format!("scene_{index}.mp4"))
    }

    pub fn final_path(&self, task_id: &str) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("final")
            .join("output.mp4")
    }

    pub fn subtitle_path(&self, task_id: &str) -> PathBuf {
        self.workspace
            .task_dir(task_id)
            .join("subtitles")
            .join("transcript.json")
    }

    pub async fn find_source_video(&self, task_id: &str) -> AppResult<PathBuf> {
        let source_dir = self.workspace.task_dir(task_id).join("source");
        let mut entries = fs::read_dir(&source_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_file() {
                return Ok(entry.path());
            }
        }
        Err(AppError::Workflow(format!(
            "no source video found for task {task_id}"
        )))
    }

    pub async fn write_minimal_png(&self, path: &Path) -> AppResult<()> {
        ensure_parent(path).await?;
        fs::write(path, MINIMAL_PNG).await?;
        Ok(())
    }

    pub async fn write_mock_wav(&self, path: &Path) -> AppResult<()> {
        ensure_parent(path).await?;
        fs::write(path, minimal_wav_bytes()).await?;
        Ok(())
    }

    pub async fn write_subtitle_json(&self, path: &Path, segments: &Value) -> AppResult<()> {
        ensure_parent(path).await?;
        let body = serde_json::to_vec_pretty(segments)?;
        fs::write(path, body).await?;
        Ok(())
    }

    pub async fn copy_file(&self, source: &Path, target: &Path) -> AppResult<()> {
        ensure_parent(target).await?;
        fs::copy(source, target).await?;
        Ok(())
    }

    fn source_target(&self, task_id: &str, source: &Path) -> AppResult<PathBuf> {
        let file_name = source.file_name().ok_or_else(|| {
            AppError::Filesystem(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "source video path has no file name",
            ))
        })?;
        Ok(self
            .workspace
            .task_dir(task_id)
            .join("source")
            .join(file_name))
    }
}

async fn ensure_parent(path: &Path) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    Ok(())
}

async fn validate_readable_file(path: &Path) -> AppResult<()> {
    let metadata = fs::metadata(path).await?;
    if metadata.is_file() {
        return Ok(());
    }
    Err(AppError::Filesystem(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "source path is not a file",
    )))
}

async fn normalize_image_to_png(source: &Path, target: &Path) -> AppResult<()> {
    let source = source.to_path_buf();
    let source_display = source.display().to_string();
    let png = tokio::task::spawn_blocking(move || encode_image_as_png(&source))
        .await
        .map_err(|error| {
            AppError::Workflow(format!(
                "image conversion task failed for {source_display}: {error}"
            ))
        })?
        .map_err(|error| {
            AppError::Workflow(format!(
                "failed to convert source image {source_display} to PNG: {error}"
            ))
        })?;

    ensure_parent(target).await?;
    fs::write(target, png).await?;
    Ok(())
}

fn encode_image_as_png(source: &Path) -> Result<Vec<u8>, String> {
    let reader = ImageReader::open(source)
        .map_err(|error| error.to_string())?
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let format = reader
        .format()
        .ok_or_else(|| "unrecognized image format".to_string())?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err(format!("unsupported image format: {format:?}"));
    }

    let image = reader.decode().map_err(|error| error.to_string())?;
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(output.into_inner())
}

fn new_asset(
    task_id: &str,
    run_id: Option<&str>,
    asset_type: AssetType,
    path: PathBuf,
    mime_type: Option<String>,
    scene_index: Option<i32>,
) -> Asset {
    Asset {
        id: Uuid::new_v4().to_string(),
        task_id: task_id.to_string(),
        run_id: run_id.map(str::to_string),
        asset_type,
        path: path.to_string_lossy().to_string(),
        mime_type,
        scene_index,
        status: Some(AssetStatus::Ready),
        created_at: Utc::now(),
    }
}

pub fn asset_for_path(
    task_id: &str,
    run_id: &str,
    asset_type: AssetType,
    path: PathBuf,
    mime_type: &str,
    scene_index: Option<i32>,
) -> Asset {
    new_asset(
        task_id,
        Some(run_id),
        asset_type,
        path,
        Some(mime_type.to_string()),
        scene_index,
    )
}

pub fn mock_transcript_segments() -> Value {
    json!([
        {
            "startMs": 0,
            "endMs": 5000,
            "text": "Mock transcript line one."
        },
        {
            "startMs": 5000,
            "endMs": 10000,
            "text": "Mock transcript line two."
        },
        {
            "startMs": 10000,
            "endMs": 15000,
            "text": "Mock transcript line three."
        }
    ])
}

fn minimal_wav_bytes() -> Vec<u8> {
    let sample_rate = 16_000u32;
    let channels = 1u16;
    let bits_per_sample = 16u16;
    let num_samples = 1_600u32;
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;
    let data_size = num_samples * block_align as u32;
    let chunk_size = 36 + data_size;

    let mut bytes = Vec::with_capacity((44 + data_size) as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&chunk_size.to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&block_align.to_le_bytes());
    bytes.extend_from_slice(&bits_per_sample.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.resize(bytes.len() + data_size as usize, 0);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, GenericImageView, Rgb, RgbImage};

    fn write_test_image(path: &Path, format: ImageFormat) {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(3, 2, Rgb([12, 34, 56])));
        image.save_with_format(path, format).unwrap();
    }

    #[tokio::test]
    async fn imports_supported_images_as_real_png_files() {
        let root = std::env::temp_dir().join(format!("repix-image-import-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let manager = AssetManager::new(Workspace::from_root(root.clone()));
        let sources = [
            ("source.png", ImageFormat::Png),
            ("source.jpg", ImageFormat::Jpeg),
            ("source.webp", ImageFormat::WebP),
        ];
        let mut source_paths = Vec::new();
        for (name, format) in sources {
            let path = root.join(name);
            write_test_image(&path, format);
            source_paths.push(path.to_string_lossy().to_string());
        }

        let assets = manager
            .import_source_images("task-1", &source_paths)
            .await
            .unwrap();

        assert_eq!(assets.len(), source_paths.len());
        for (index, asset) in assets.iter().enumerate() {
            let target = manager.source_image_path("task-1", index as i32);
            let bytes = std::fs::read(&target).unwrap();
            let decoded = image::open(&target).unwrap();
            assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
            assert_eq!(decoded.dimensions(), (3, 2));
            assert_eq!(asset.path, target.to_string_lossy());
            assert_eq!(asset.mime_type.as_deref(), Some("image/png"));
            assert_eq!(asset.scene_index, Some(index as i32));
        }

        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn rejects_invalid_images_without_creating_a_target() {
        let root = std::env::temp_dir().join(format!(
            "repix-invalid-image-import-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("broken.jpg");
        std::fs::write(&source, b"not an image").unwrap();
        let manager = AssetManager::new(Workspace::from_root(root.clone()));

        let error = manager
            .import_source_images("task-1", &[source.to_string_lossy().to_string()])
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            AppError::Workflow(message)
                if message.contains("failed to convert source image")
                    && message.contains("broken.jpg")
        ));
        assert!(!manager.source_image_path("task-1", 0).exists());

        std::fs::remove_dir_all(root).unwrap();
    }
}
