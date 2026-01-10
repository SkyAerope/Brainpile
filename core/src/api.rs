use crate::state::AppState;
use crate::db::{search_text_vec, search_visual_vec, search_fts, rrf_merge, fetch_items_by_ids};
use s3::{Bucket, creds::Credentials, region::Region};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

pub async fn run_server(state: AppState) {
    let app = Router::new()
        .route("/api/v1/items", get(list_items))
        .route("/api/v1/items/:id", get(get_item).delete(delete_item))
        .route("/api/v1/items/:id/raw", get(get_raw_item))
        .route("/api/v1/search", get(search_items))
        .route("/api/v1/entities", get(list_entities))
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 8080));
    tracing::info!("API Server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[derive(Deserialize)]
struct ListParams {
    cursor: Option<i64>,  // 游标：上一页最后一条的 id
    limit: Option<i64>,
    mode: Option<String>, // "timeline" (默认) 或 "random"
    entity_id: Option<i64>,
}

async fn list_entities(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rows = sqlx::query(
        r#"
        SELECT id, name, username, type, avatar_url, updated_at
        FROM entities
        ORDER BY updated_at DESC
        "#
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch entities: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut entities = Vec::new();
    for row in rows {
        let id: i64 = row.get("id");
        let name: String = row.get("name");
        let username: Option<String> = row.get("username");
        let entity_type: String = row.get("type");
        let avatar_url: Option<String> = row.get("avatar_url");

        let avatar_final_url = if let Some(url) = avatar_url {
            if url.starts_with("PROXY:") {
                let key = &url[6..];
                state.s3_signing_client.presign_get(key, 3600, None).await.ok()
            } else {
                Some(url)
            }
        } else {
            None
        };

        entities.push(json!({
            "id": id.to_string(),
            "name": name,
            "username": username,
            "type": entity_type,
            "avatar_url": avatar_final_url,
        }));
    }

    Ok(Json(json!(entities)))
}

async fn list_items(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Json<serde_json::Value> {
    let limit = params.limit.unwrap_or(20).min(100);
    let mode = params.mode.as_deref().unwrap_or("timeline");
    let entity_id = params.entity_id;

    let rows = if mode == "random" {
        // 随机模式
        sqlx::query(
            r#"
            SELECT id, item_type, content_text, s3_key, thumbnail_key, created_at, meta, tg_chat_id, tg_user_id, tg_message_id
            FROM items
            ORDER BY RANDOM()
            LIMIT $1
            "#
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    } else {
        // 时间线模式（游标分页 + 实体过滤）
        match (params.cursor, entity_id) {
            (Some(cursor), Some(eid)) => {
                sqlx::query(
                    r#"
                    SELECT id, item_type, content_text, s3_key, thumbnail_key, created_at, meta, tg_chat_id, tg_user_id, tg_message_id
                    FROM items
                    WHERE id < $1 AND (tg_chat_id = $2 OR tg_user_id = $2)
                    ORDER BY id DESC LIMIT $3
                    "#
                )
                .bind(cursor)
                .bind(eid)
                .bind(limit)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default()
            }
            (None, Some(eid)) => {
                sqlx::query(
                    r#"
                    SELECT id, item_type, content_text, s3_key, thumbnail_key, created_at, meta, tg_chat_id, tg_user_id, tg_message_id
                    FROM items
                    WHERE (tg_chat_id = $1 OR tg_user_id = $1)
                    ORDER BY id DESC LIMIT $2
                    "#
                )
                .bind(eid)
                .bind(limit)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default()
            }
            (Some(cursor), None) => {
                sqlx::query(
                    r#"
                    SELECT id, item_type, content_text, s3_key, thumbnail_key, created_at, meta, tg_chat_id, tg_user_id, tg_message_id
                    FROM items
                    WHERE id < $1
                    ORDER BY id DESC
                    LIMIT $2
                    "#
                )
                .bind(cursor)
                .bind(limit)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default()
            }
            (None, None) => {
                sqlx::query(
                    r#"
                    SELECT id, item_type, content_text, s3_key, thumbnail_key, created_at, meta, tg_chat_id, tg_user_id, tg_message_id
                    FROM items
                    ORDER BY id DESC
                    LIMIT $1
                    "#
                )
                .bind(limit)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default()
            }
        }
    };

    let mut items = Vec::new();

    for row in &rows {
        let id: i64 = row.get("id");
        let item_type: String = row.get("item_type");
        let content_text: Option<String> = row.get("content_text");
        let s3_key: Option<String> = row.get("s3_key");
        let thumbnail_key: Option<String> = row.try_get("thumbnail_key").ok();
        let created_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("created_at").ok();
        let meta: serde_json::Value = row.try_get("meta").unwrap_or(json!({}));
        let tg_chat_id: Option<i64> = row.try_get("tg_chat_id").ok();
        let tg_user_id: Option<i64> = row.try_get("tg_user_id").ok();
        let tg_message_id: Option<i64> = row.try_get("tg_message_id").ok();

        let s3_url = if let Some(key) = s3_key.as_ref() {
             state.s3_signing_client.presign_get(key, 3600, None).await.ok()
        } else {
             None
        };

        let thumbnail_url = if let Some(key) = thumbnail_key.as_ref() {
             state.s3_signing_client.presign_get(key, 3600, None).await.ok()
        } else {
             None
        };

        let source_url = if let Some(user_id) = tg_user_id {
            if user_id > 0 {
                Some(format!("tg://user?id={}", user_id))
            } else {
                None
            }
        } else {
            match (tg_chat_id, tg_message_id) {
                (Some(chat_id), Some(msg_id)) if chat_id <= -1000000000000 => {
                    Some(format!("https://t.me/c/{}/{}", (-chat_id - 1000000000000_i64), msg_id))
                }
                (Some(chat_id), _) if chat_id > 0 => {
                    Some(format!("tg://user?id={}", chat_id))
                }
                (Some(chat_id), None) if chat_id <= -1000000000000 => {
                    Some(format!("https://t.me/c/{}", (-chat_id - 1000000000000_i64)))
                }
                _ => None
            }
        };

        let _entity_avatar: Option<String> = None;

        items.push(json!({
            "id": id,
            "type": item_type,
            "content": content_text,
            "s3_url": s3_url,
            "thumbnail_url": thumbnail_url,
            "created_at": created_at,
            "width": meta.get("width"),
            "height": meta.get("height"),
            "source_url": source_url,
        }));
    }

    // 计算下一页游标
    let next_cursor = if mode != "random" && items.len() == limit as usize {
        rows.last().map(|r| r.get::<i64, _>("id"))
    } else {
        None
    };

    Json(json!({
        "items": items,
        "next_cursor": next_cursor
    }))
}

/// 获取单个 item 详情
async fn get_item(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let row = sqlx::query(
        r#"
        SELECT id, item_type, content_text, searchable_text, s3_key, 
               tg_chat_id, tg_message_id, created_at, processed_at, meta, tags
        FROM items 
        WHERE id = $1
        "#
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match row {
        Some(row) => {
            let id: i64 = row.get("id");
            let item_type: String = row.get("item_type");
            let content_text: Option<String> = row.get("content_text");
            let searchable_text: Option<String> = row.get("searchable_text");
            let s3_key: Option<String> = row.get("s3_key");
            let tg_chat_id: Option<i64> = row.get("tg_chat_id");
            let tg_message_id: Option<i64> = row.get("tg_message_id");
            let created_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("created_at").ok();
            let processed_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("processed_at").ok();
            let meta: serde_json::Value = row.try_get("meta").unwrap_or(json!({}));
            let tags: Vec<i32> = row.try_get("tags").unwrap_or_default();

            let s3_url = if let Some(key) = s3_key.as_ref() {
                state.s3_signing_client.presign_get(key, 3600, None).await.ok()
            } else {
                None
            };

            // 构建 TG 跳转链接
            let tg_link = match (tg_chat_id, tg_message_id) {
                // 频道/超级群组消息：https://t.me/c/ID/MSG_ID
                // ID 需要去掉 -100 前缀。例如 -1001234567890 -> 1234567890
                (Some(chat_id), Some(msg_id)) if chat_id <= -1000000000000 => {
                    Some(format!("https://t.me/c/{}/{}", (-chat_id - 1000000000000_i64), msg_id))
                }
                // 个人用户：tg://user?id=ID
                (Some(chat_id), _) if chat_id > 0 => {
                     Some(format!("tg://user?id={}", chat_id))
                }
                // 频道/超级群组（无具体消息）：https://t.me/c/ID
                (Some(chat_id), None) if chat_id <= -1000000000000 => {
                     Some(format!("https://t.me/c/{}", (-chat_id - 1000000000000_i64)))
                }
                _ => None
            };

            Ok(Json(json!({
                "id": id,
                "type": item_type,
                "content": content_text,
                "searchable_text": searchable_text,
                "s3_url": s3_url,
                "tg_link": tg_link,
                "created_at": created_at,
                "processed_at": processed_at,
                "meta": meta,
                "tags": tags,
            })))
        }
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// 删除 item
async fn delete_item(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // 1. Fetch info for S3 cleanup and Entity cleanup
    let row = sqlx::query("SELECT s3_key, thumbnail_key, tg_chat_id, tg_user_id FROM items WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch item for deletion: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let (s3_key, thumbnail_key, tg_chat_id, tg_user_id) = match row {
        Some(r) => (
            r.try_get::<Option<String>, _>("s3_key").unwrap_or(None),
            r.try_get::<Option<String>, _>("thumbnail_key").unwrap_or(None),
            r.try_get::<Option<i64>, _>("tg_chat_id").unwrap_or(None),
            r.try_get::<Option<i64>, _>("tg_user_id").unwrap_or(None),
        ),
        None => return Err(StatusCode::NOT_FOUND),
    };

    // 2. Database Transaction
    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to begin transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Delete tasks first (to satisfy FK)
    sqlx::query("DELETE FROM tasks WHERE item_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete tasks: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Delete item
    let result = sqlx::query("DELETE FROM items WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete item: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 2.5 Entity Cleanup: If this was the last item for these entities, delete them
    let mut entities_to_check = Vec::new();
    if let Some(cid) = tg_chat_id { entities_to_check.push(cid); }
    if let Some(uid) = tg_user_id { entities_to_check.push(uid); }

    for eid in entities_to_check {
        // Check if any other items remain for this entity
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE tg_chat_id = $1 OR tg_user_id = $1")
            .bind(eid)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to count remaining items: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        
        if count == 0 {
            tracing::info!("Entity {} has no more items. Deleting entity.", eid);
            sqlx::query("DELETE FROM entities WHERE id = $1")
                .bind(eid)
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    tracing::error!("Failed to delete entity: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        }
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // 3. S3 Cleanup
    if result.rows_affected() > 0 {
        // Init internal bucket for deletion
        let region = Region::Custom {
            region: "us-east-1".to_owned(),
            endpoint: state.config.s3_endpoint.clone(),
        };
        let credentials = Credentials::new(
            Some(&state.config.s3_access_key),
            Some(&state.config.s3_secret_key),
            None, None, None
        ).expect("Failed to create S3 credentials");
        
        let bucket = Bucket::new(
            &state.config.s3_bucket,
            region,
            credentials
        ).expect("Failed to create S3 bucket").with_path_style();

        if let Some(key) = s3_key {
            let _ = bucket.delete_object(&key).await
                .map_err(|e| tracing::warn!("Failed to delete S3 object {}: {}", key, e));
        }
        if let Some(key) = thumbnail_key {
            let _ = bucket.delete_object(&key).await
                .map_err(|e| tracing::warn!("Failed to delete S3 thumbnail {}: {}", key, e));
        }

        Ok(Json(json!({ "success": true })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn get_raw_item(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let row = sqlx::query("SELECT s3_key FROM items WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await;

    if let Ok(Some(row)) = row {
        let s3_key: Option<String> = row.get("s3_key");
            // Presigned URL
            if let Some(key) = s3_key {
                if let Ok(url) = state.s3_signing_client.presign_get(&key, 3600, None).await {
                    return axum::response::Redirect::temporary(&url).into_response();
                }
            }
    }

    axum::http::StatusCode::NOT_FOUND.into_response()
}

// ============ Search API ============

#[derive(Deserialize)]
struct SearchParams {
    q: Option<String>,           // 文本搜索词
    image_url: Option<String>,   // 以图搜图的图片 URL
    #[serde(rename = "type")]
    item_type: Option<String>,   // 类型过滤
    limit: Option<i64>,          // 返回数量
}

/// 混合检索 API
/// - q: 文本搜索（走 text_embedding + visual_embedding(text) + FTS）
/// - image_url: 以图搜图（走 visual_embedding KNN）
async fn search_items(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let limit = params.limit.unwrap_or(50).min(100);
    let per_channel = 100_i64;  // 每路召回数
    let rrf_k = 60.0;           // RRF 平滑常数
    
    // 至少需要 q 或 image_url 之一
    if params.q.is_none() && params.image_url.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }
    
    let mut channels: Vec<Vec<crate::db::SearchHit>> = Vec::new();
    
    // 文本搜索模式
    if let Some(ref query_text) = params.q {
        // 1. 获取文本向量（BGE-M3）用于 text_embedding 召回
        if let Some(text_vec) = get_text_embedding(&state, query_text).await {
            if let Ok(hits) = search_text_vec(&state.db, &text_vec, per_channel).await {
                tracing::info!("text_vec recall: {} hits", hits.len());
                channels.push(hits);
            }
        }
        
        // 2. 获取文本的视觉向量（CLIP text embedding）用于 visual_embedding 召回
        if let Some(visual_vec) = get_clip_text_embedding(&state, query_text).await {
            if let Ok(hits) = search_visual_vec(&state.db, &visual_vec, per_channel).await {
                tracing::info!("visual_vec (text) recall: {} hits", hits.len());
                channels.push(hits);
            }
        }
        
        // 3. 全文检索召回
        if let Ok(hits) = search_fts(&state.db, query_text, per_channel).await {
            tracing::info!("fts recall: {} hits", hits.len());
            channels.push(hits);
        }
    }
    
    // 以图搜图模式
    if let Some(ref image_url) = params.image_url {
        // 下载图片并获取 CLIP 视觉向量
        if let Some(visual_vec) = get_clip_image_embedding_from_url(&state, image_url).await {
            if let Ok(hits) = search_visual_vec(&state.db, &visual_vec, per_channel).await {
                tracing::info!("visual_vec (image) recall: {} hits", hits.len());
                channels.push(hits);
            }
        }
    }
    
    if channels.is_empty() {
        return Ok(Json(json!({ "items": [], "total": 0 })));
    }
    
    // RRF 融合
    let merged_ids = rrf_merge(channels, rrf_k, limit as usize);
    tracing::info!("RRF merged: {} items", merged_ids.len());
    
    // 批量获取详情
    let rows = fetch_items_by_ids(&state.db, &merged_ids)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch items: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    
    let mut items = Vec::new();
    for row in &rows {
        let id: i64 = row.get("id");
        let item_type: String = row.get("item_type");
        
        // 类型过滤
        if let Some(ref filter_type) = params.item_type {
            if &item_type != filter_type {
                continue;
            }
        }
        
        let content_text: Option<String> = row.get("content_text");
        let s3_key: Option<String> = row.get("s3_key");
        let thumbnail_key: Option<String> = row.get("thumbnail_key");
        let created_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("created_at").ok();
        let meta: serde_json::Value = row.try_get("meta").unwrap_or(json!({}));

        let s3_url = if let Some(key) = s3_key.as_ref() {
            state.s3_signing_client.presign_get(key, 3600, None).await.ok()
        } else {
            None
        };
        
        let thumbnail_url = if let Some(key) = thumbnail_key.as_ref() {
            state.s3_signing_client.presign_get(key, 3600, None).await.ok()
        } else {
            None
        };

        items.push(json!({
            "id": id,
            "type": item_type,
            "content": content_text,
            "s3_url": s3_url,
            "thumbnail_url": thumbnail_url,
            "created_at": created_at,
            "width": meta.get("width"),
            "height": meta.get("height"),
        }));
    }

    Ok(Json(json!({
        "items": items,
        "total": items.len()
    })))
}

/// 获取文本的 BGE-M3 向量（用于 text_embedding 召回）
async fn get_text_embedding(state: &AppState, text: &str) -> Option<Vec<f32>> {
    let embedding_url = format!("{}/embeddings", state.config.embedding_api_base);
    let body = serde_json::json!({
        "model": state.config.embedding_model,
        "input": text
    });
    
    let res = state.http_client
        .post(&embedding_url)
        .header("Authorization", format!("Bearer {}", state.config.embedding_api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .ok()?;
    
    if !res.status().is_success() {
        return None;
    }
    
    let json: serde_json::Value = res.json().await.ok()?;
    let arr = json.get("data")?.get(0)?.get("embedding")?.as_array()?;
    
    Some(arr.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect())
}

/// 获取文本的 CLIP 视觉向量（用于文本搜图）
async fn get_clip_text_embedding(state: &AppState, text: &str) -> Option<Vec<f32>> {
    let clip_url = format!("{}/embed_text", state.config.clip_api_url);
    
    let res = state.http_client
        .post(&clip_url)
        .query(&[("text", text)])
        .send()
        .await
        .ok()?;
    
    if !res.status().is_success() {
        tracing::warn!("CLIP text embedding failed: {}", res.status());
        return None;
    }
    
    let json: serde_json::Value = res.json().await.ok()?;
    let arr = json.get("embedding")?.as_array()?;
    
    Some(arr.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect())
}

/// 从 URL 下载图片并获取 CLIP 视觉向量（用于以图搜图）
async fn get_clip_image_embedding_from_url(state: &AppState, image_url: &str) -> Option<Vec<f32>> {
    // 下载图片
    let res = state.http_client.get(image_url).send().await.ok()?;
    if !res.status().is_success() {
        tracing::warn!("Failed to download image from {}", image_url);
        return None;
    }
    let image_bytes = res.bytes().await.ok()?;
    
    // 调用 CLIP embed
    let clip_url = format!("{}/embed", state.config.clip_api_url);
    let part = reqwest::multipart::Part::bytes(image_bytes.to_vec())
        .file_name("image.jpg")
        .mime_str("image/jpeg")
        .ok()?;
    let form = reqwest::multipart::Form::new().part("file", part);
    
    let res = state.http_client.post(&clip_url).multipart(form).send().await.ok()?;
    if !res.status().is_success() {
        tracing::warn!("CLIP image embedding failed: {}", res.status());
        return None;
    }
    
    let json: serde_json::Value = res.json().await.ok()?;
    let arr = json.get("embedding")?.as_array()?;
    
    Some(arr.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect())
}
