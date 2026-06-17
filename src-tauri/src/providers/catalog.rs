use crate::models::ProviderModelOption;

pub fn list_provider_models(provider: &str) -> Vec<ProviderModelOption> {
    match provider.to_uppercase().as_str() {
        "DEEPSEEK" => vec![
            model("deepseek-chat", "DeepSeek Chat"),
            model("deepseek-reasoner", "DeepSeek Reasoner"),
        ],
        "QWEN_VL" => vec![
            model("qwen-vl-max", "Qwen-VL Max"),
            model("qwen-vl-plus", "Qwen-VL Plus"),
        ],
        "TONGYI" => vec![
            model("wan2.1-t2i-turbo", "Wan 2.1 T2I Turbo"),
            model("wan2.1-t2i-plus", "Wan 2.1 T2I Plus"),
        ],
        "SEEDANCE" => vec![
            model("seedance-1.0-pro", "Seedance 1.0 Pro"),
            model("seedance-1.0-lite", "Seedance 1.0 Lite"),
        ],
        _ => Vec::new(),
    }
}

fn model(id: &str, name: &str) -> ProviderModelOption {
    ProviderModelOption {
        id: id.to_string(),
        name: name.to_string(),
    }
}