use crate::state::AppState;
use base64::Engine;
use std::sync::Arc;
use tokio::sync::RwLock;

/// jina-embeddings-v5-omni 的统一多模态嵌入维度
pub const EMBEDDING_DIM: usize = 768;

/// 缓存 llama-server 的 media_marker。
///
/// llama-server 每次启动会随机生成一个 media_marker，图片嵌入时必须把它放进
/// prompt_string 占位。这里缓存住，避免每次嵌入都额外打一次 `/props`。
#[derive(Clone, Default)]
pub struct MediaMarker {
    inner: Arc<RwLock<Option<String>>>,
}

impl MediaMarker {
    pub fn new() -> Self {
        Self::default()
    }

    /// 获取 media_marker，缓存命中直接返回，否则向 llama-server 拉取。
    async fn get(&self, state: &AppState) -> Option<String> {
        if let Some(marker) = self.inner.read().await.clone() {
            return Some(marker);
        }

        let marker = fetch_media_marker(state).await?;
        *self.inner.write().await = Some(marker.clone());
        Some(marker)
    }

    /// 使缓存失效（marker 过期或 server 重启后调用）。
    async fn invalidate(&self) {
        *self.inner.write().await = None;
    }
}

/// 从 llama-server `/props` 读取 media_marker。
async fn fetch_media_marker(state: &AppState) -> Option<String> {
    let url = format!("{}/props", state.config.embedding_api_url);
    let res = state.http_client.get(&url).send().await.ok()?;
    if !res.status().is_success() {
        tracing::warn!("Failed to fetch media_marker: {}", res.status());
        return None;
    }
    let json: serde_json::Value = res.json().await.ok()?;
    json.get("media_marker")?.as_str().map(|s| s.to_string())
}

/// 从 llama-server `/embeddings` 的响应中解析出 768 维向量。
///
/// 兼容以下两种返回格式：
/// - `[{"index":0,"embedding":[[...]]}]`（OpenAI 风格的 batch 形式，embedding 可能再嵌套一层）
/// - `{"embedding":[...]}`
fn parse_embedding(json: &serde_json::Value) -> Option<Vec<f32>> {
    // 数组形式：取第一个元素的 embedding
    let embedding = if let Some(arr) = json.as_array() {
        arr.first()?.get("embedding")?
    } else {
        json.get("embedding")?
    };

    // embedding 可能是 [f32] 或 [[f32]]（pooling 后仍包一层）
    let flat = match embedding {
        serde_json::Value::Array(outer) => match outer.first() {
            Some(serde_json::Value::Array(_)) => outer.first()?.as_array()?,
            _ => outer,
        },
        _ => return None,
    };

    Some(flat.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect())
}

/// 调用 llama-server `/embeddings`，返回解析后的向量。
async fn request_embedding(
    state: &AppState,
    content: serde_json::Value,
) -> Option<Vec<f32>> {
    let url = format!("{}/embeddings", state.config.embedding_api_url);
    let body = serde_json::json!({ "content": [content] });

    let res = state
        .http_client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .ok()?;

    if !res.status().is_success() {
        tracing::warn!("jina embedding request failed: {}", res.status());
        return None;
    }

    let json: serde_json::Value = res.json().await.ok()?;
    let vec = parse_embedding(&json);
    if vec.is_none() {
        tracing::warn!("Failed to parse jina embedding response");
    }
    vec
}

/// 文本嵌入。`prefix` 用于区分查询/文档（"Query: " 或 "Document: "）。
async fn embed_text_with_prefix(
    state: &AppState,
    text: &str,
    prefix: &str,
) -> Option<Vec<f32>> {
    let prompt = format!("{}{}", prefix, text);
    request_embedding(
        state,
        serde_json::json!({ "prompt_string": prompt }),
    )
    .await
}

/// 查询文本嵌入（用于搜索时的 query 向量）。
pub async fn embed_query_text(state: &AppState, text: &str) -> Option<Vec<f32>> {
    embed_text_with_prefix(state, text, "Query: ").await
}

/// 文档文本嵌入（用于入库时的 item 向量）。
pub async fn embed_document_text(state: &AppState, text: &str) -> Option<Vec<f32>> {
    embed_text_with_prefix(state, text, "Document: ").await
}

/// 图片嵌入。图片字节会被 base64 编码后随 media_marker 一起发送。
///
/// 若因 media_marker 失效导致首次请求失败，会刷新 marker 后重试一次。
pub async fn embed_image(state: &AppState, image_bytes: &[u8]) -> Option<Vec<f32>> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(image_bytes);

    let marker = state.media_marker.get(state).await?;
    let content = serde_json::json!({
        "prompt_string": marker,
        "multimodal_data": [b64],
    });

    if let Some(vec) = request_embedding(state, content.clone()).await {
        return Some(vec);
    }

    // marker 可能因 server 重启失效，刷新后重试一次
    state.media_marker.invalidate().await;
    let marker = state.media_marker.get(state).await?;
    let content = serde_json::json!({
        "prompt_string": marker,
        "multimodal_data": [b64],
    });
    request_embedding(state, content).await
}

/// 从 URL 下载图片并嵌入（以图搜图）。
pub async fn embed_image_from_url(state: &AppState, image_url: &str) -> Option<Vec<f32>> {
    let res = state.http_client.get(image_url).send().await.ok()?;
    if !res.status().is_success() {
        tracing::warn!("Failed to download image from {}", image_url);
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    embed_image(state, &bytes).await
}

/// 把向量格式化为 pgvector 的字面量字符串 `[a,b,c]`。
pub fn vec_to_pgvector(vec: &[f32]) -> String {
    let parts: Vec<String> = vec.iter().map(|f| f.to_string()).collect();
    format!("[{}]", parts.join(","))
}
