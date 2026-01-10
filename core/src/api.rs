use crate::state::AppState;
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
}

async fn list_items(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Json<serde_json::Value> {
    let limit = params.limit.unwrap_or(20).min(100);
    let mode = params.mode.as_deref().unwrap_or("timeline");

    let rows = if mode == "random" {
        // 随机模式
        sqlx::query(
            r#"
            SELECT id, item_type, content_text, s3_key, created_at, meta
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
        // 时间线模式（游标分页）
        match params.cursor {
            Some(cursor) => {
                sqlx::query(
                    r#"
                    SELECT id, item_type, content_text, s3_key, created_at, meta
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
            None => {
                sqlx::query(
                    r#"
                    SELECT id, item_type, content_text, s3_key, created_at, meta
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
        let created_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("created_at").ok();
        let meta: serde_json::Value = row.try_get("meta").unwrap_or(json!({}));

        let s3_url = if let Some(key) = s3_key.as_ref() {
             state.s3_signing_client.presign_get(key, 3600, None).await.ok()
        } else {
             None
        };

        items.push(json!({
            "id": id,
            "type": item_type,
            "content": content_text,
            "s3_url": s3_url,
            "created_at": created_at,
            "width": meta.get("width"),
            "height": meta.get("height"),
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
                (Some(chat_id), Some(msg_id)) => {
                    // 私聊或群组链接格式
                    Some(format!("https://t.me/c/{}/{}", (-chat_id - 1000000000000_i64), msg_id))
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
    // 1. Fetch info for S3 cleanup
    let row = sqlx::query("SELECT s3_key, thumbnail_key FROM items WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch item for deletion: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let (s3_key, thumbnail_key) = match row {
        Some(r) => (
            r.try_get::<Option<String>, _>("s3_key").unwrap_or(None),
            r.try_get::<Option<String>, _>("thumbnail_key").unwrap_or(None)
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
