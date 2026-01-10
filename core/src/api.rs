use crate::state::AppState;
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

    let items: Vec<_> = rows
        .iter()
        .map(|row| {
            let id: i64 = row.get("id");
            let item_type: String = row.get("item_type");
            let content_text: Option<String> = row.get("content_text");
            let s3_key: Option<String> = row.get("s3_key");
            let created_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("created_at").ok();
            let meta: serde_json::Value = row.try_get("meta").unwrap_or(json!({}));

            let s3_url = s3_key.as_ref().map(|key| {
                format!("{}/{}/{}", state.config.s3_endpoint, state.config.s3_bucket, key)
            });

            json!({
                "id": id,
                "type": item_type,
                "content": content_text,
                "s3_url": s3_url,
                "created_at": created_at,
                "width": meta.get("width"),
                "height": meta.get("height"),
            })
        })
        .collect();

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

            let s3_url = s3_key.as_ref().map(|key| {
                format!("{}/{}/{}", state.config.s3_endpoint, state.config.s3_bucket, key)
            });

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
                "content_text": content_text,
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
    let result = sqlx::query("DELETE FROM items WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() > 0 {
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
        if let Some(key) = s3_key {
            // MVP: Redirect to MinIO directly (assuming localhost access works)
            let url = format!("{}/{}/{}", state.config.s3_endpoint, state.config.s3_bucket, key);
            return axum::response::Redirect::temporary(&url).into_response();
        }
    }

    axum::http::StatusCode::NOT_FOUND.into_response()
}
