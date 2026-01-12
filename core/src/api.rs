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
use sqlx::{Postgres, QueryBuilder};
use sqlx::postgres::PgRow;
use std::collections::{HashMap, HashSet};

#[derive(Deserialize)]
struct ListEntitiesParams {
    // Cursor format: "<rfc3339>|<id>" where id is BIGINT.
    cursor: Option<String>,
    limit: Option<i64>,
}

pub async fn run_server(state: AppState) {
    let app = Router::new()
        .route("/api/v1/items", get(list_items))
        .route("/api/v1/items/:id", get(get_item).delete(delete_item))
        .route("/api/v1/items/:id/raw", get(get_raw_item))
        .route("/api/v1/search", get(search_items))
        .route("/api/v1/entities", get(list_entities))
        .route("/api/v1/tags", get(list_tags).post(create_tag))
        .route("/api/v1/tags/:id", axum::routing::patch(update_tag).delete(delete_tag))
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
    tag_id: Option<i32>,
}

#[derive(Deserialize)]
struct CreateTagRequest {
    icon_type: String,  // "emoji" | "tmoji"
    icon_value: String,
    label: Option<String>,
}

#[derive(Deserialize)]
struct UpdateTagRequest {
    label: Option<String>,
}

fn resolve_proxy_url(state: &AppState, raw: Option<String>) -> impl std::future::Future<Output = Option<String>> + '_ {
    async move {
        let Some(url) = raw else { return None; };
        if url.starts_with("PROXY:") {
            let key = &url[6..];
            state.s3_signing_client.presign_get(key, 3600, None).await.ok()
        } else {
            Some(url)
        }
    }
}

async fn fetch_tags_map(state: &AppState, tag_ids: &[i32]) -> HashMap<i32, serde_json::Value> {
    if tag_ids.is_empty() {
        return HashMap::new();
    }

    let rows = sqlx::query(
        r#"
        SELECT id, icon_type, icon_value, label, asset_url, asset_mime
        FROM tags
        WHERE id = ANY($1)
        "#,
    )
    .bind(tag_ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut map = HashMap::new();
    for row in rows {
        let id: i32 = row.get("id");
        let icon_type: String = row.get("icon_type");
        let icon_value: String = row.get("icon_value");
        let label: Option<String> = row.try_get("label").ok();
        let asset_url_raw: Option<String> = row.try_get("asset_url").ok();
        let asset_mime: Option<String> = row.try_get("asset_mime").ok();

        let asset_url = resolve_proxy_url(state, asset_url_raw).await;
        map.insert(
            id,
            json!({
                "id": id,
                "icon_type": icon_type,
                "icon_value": icon_value,
                "label": label,
                "asset_url": asset_url,
                "asset_mime": asset_mime,
            }),
        );
    }

    map
}

async fn list_entities(
    State(state): State<AppState>,
    Query(params): Query<ListEntitiesParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let limit = params.limit.unwrap_or(10).clamp(1, 100);

    let (cursor_ts, cursor_id): (Option<chrono::DateTime<chrono::Utc>>, Option<i64>) =
        match params.cursor.as_deref() {
            None => (None, None),
            Some(raw) => {
                let mut parts = raw.splitn(2, '|');
                let ts_str = parts.next();
                let id_str = parts.next();
                match (ts_str, id_str) {
                    (Some(ts), Some(id)) => {
                        let parsed_ts = chrono::DateTime::parse_from_rfc3339(ts)
                            .map(|dt| dt.with_timezone(&chrono::Utc))
                            .ok();
                        let parsed_id = id.parse::<i64>().ok();
                        (parsed_ts, parsed_id)
                    }
                    _ => (None, None),
                }
            }
        };

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM entities")
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to count entities: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let rows = if let (Some(ts), Some(id)) = (cursor_ts, cursor_id) {
        sqlx::query(
            r#"
            SELECT id, name, username, type, avatar_url, updated_at
            FROM entities
            WHERE updated_at < $1 OR (updated_at = $1 AND id < $2)
            ORDER BY updated_at DESC, id DESC
            LIMIT $3
            "#,
        )
        .bind(ts)
        .bind(id)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT id, name, username, type, avatar_url, updated_at
            FROM entities
            ORDER BY updated_at DESC, id DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| {
        tracing::error!("Failed to fetch entities: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut entities = Vec::new();
    let mut next_cursor: Option<String> = None;

    for row in rows.iter() {
        let id: i64 = row.get("id");
        let name: String = row.get("name");
        let username: Option<String> = row.get("username");
        let entity_type: String = row.get("type");
        let avatar_url: Option<String> = row.get("avatar_url");
        let updated_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("updated_at").ok();

        let avatar_final_url = if let Some(url) = avatar_url {
            if url.starts_with("PROXY:") {
                let key = &url[6..];
                state
                    .s3_signing_client
                    .presign_get(key, 3600, None)
                    .await
                    .ok()
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
            "updated_at": updated_at,
        }));
    }

    if entities.len() == limit as usize {
        if let Some(last) = rows.last() {
            let last_id: i64 = last.get("id");
            let last_ts: Option<chrono::DateTime<chrono::Utc>> = last.try_get("updated_at").ok();
            if let Some(ts) = last_ts {
                next_cursor = Some(format!("{}|{}", ts.to_rfc3339(), last_id));
            }
        }
    }

    Ok(Json(json!({
        "entities": entities,
        "next_cursor": next_cursor,
        "total": total
    })))
}

async fn list_items(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Json<serde_json::Value> {
    let limit = params.limit.unwrap_or(20).min(100);
    let mode = params.mode.as_deref().unwrap_or("timeline");
    let entity_id = params.entity_id;
    let tag_id = params.tag_id;

    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT id, item_type, content_text, s3_key, thumbnail_key, created_at, meta, tg_chat_id, tg_user_id, tg_message_id, tg_group_id, tags FROM items",
    );

    let mut has_where = false;
    let mut push_where = |qb: &mut QueryBuilder<Postgres>, clause: &str| {
        if !has_where {
            qb.push(" WHERE ");
            has_where = true;
        } else {
            qb.push(" AND ");
        }
        qb.push(clause);
    };

    if mode != "random" {
        if let Some(cursor) = params.cursor {
            push_where(&mut qb, "id < ");
            qb.push_bind(cursor);
        }
    }

    if let Some(eid) = entity_id {
        push_where(&mut qb, "(tg_chat_id = ");
        qb.push_bind(eid);
        qb.push(" OR tg_user_id = ");
        qb.push_bind(eid);
        qb.push(")");
    }

    if let Some(tid) = tag_id {
        // When filtering by tag, include full Telegram albums (same tg_group_id)
        // if any member of the album matches the tag.
        push_where(&mut qb, "(");
        qb.push("tags @> ARRAY[");
        qb.push_bind(tid);
        qb.push("]::int[]");
        qb.push(" OR (tg_group_id IS NOT NULL AND tg_group_id IN (");
        qb.push("SELECT tg_group_id FROM items WHERE tg_group_id IS NOT NULL AND tags @> ARRAY[");
        qb.push_bind(tid);
        qb.push("]::int[]" );
        qb.push("))");
        qb.push(")");
    }

    if mode == "random" {
        qb.push(" ORDER BY RANDOM() ");
        qb.push(" LIMIT ");
        qb.push_bind(limit);
    } else {
        qb.push(" ORDER BY id DESC ");
        qb.push(" LIMIT ");
        qb.push_bind(limit);
    }

    let base_rows: Vec<PgRow> = qb.build().fetch_all(&state.db).await.unwrap_or_default();

    // Random mode: if a random pick hits a Telegram album member (same tg_group_id),
    // expand the response to include the full album.
    let extra_rows: Vec<PgRow> = if mode == "random" {
        let mut group_ids: Vec<i64> = Vec::new();
        let mut seen: HashSet<i64> = HashSet::new();

        for row in &base_rows {
            let tg_group_id: Option<i64> = row.try_get("tg_group_id").ok();
            if let Some(gid) = tg_group_id {
                if seen.insert(gid) {
                    group_ids.push(gid);
                }
            }
        }

        if group_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query(
                "SELECT id, item_type, content_text, s3_key, thumbnail_key, created_at, meta, tg_chat_id, tg_user_id, tg_message_id, tg_group_id, tags FROM items WHERE tg_group_id = ANY($1)"
            )
            .bind(&group_ids)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
        }
    } else {
        Vec::new()
    };

    let mut items = Vec::new();

    let mut unique_tag_ids: HashSet<i32> = HashSet::new();
    for row in base_rows.iter().chain(extra_rows.iter()) {
        let ids: Vec<i32> = row.try_get("tags").unwrap_or_default();
        for id in ids {
            unique_tag_ids.insert(id);
        }
    }
    let mut unique_tag_ids_vec: Vec<i32> = unique_tag_ids.into_iter().collect();
    unique_tag_ids_vec.sort_unstable();
    let tags_map = fetch_tags_map(&state, &unique_tag_ids_vec).await;

    let mut seen_item_ids: HashSet<i64> = HashSet::new();
    for row in base_rows.iter().chain(extra_rows.iter()) {
        let id: i64 = row.get("id");
        if !seen_item_ids.insert(id) {
            continue;
        }
        let item_type: String = row.get("item_type");
        let content_text: Option<String> = row.get("content_text");
        let s3_key: Option<String> = row.get("s3_key");
        let thumbnail_key: Option<String> = row.try_get("thumbnail_key").ok();
        let created_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("created_at").ok();
        let meta: serde_json::Value = row.try_get("meta").unwrap_or(json!({}));
        let tg_chat_id: Option<i64> = row.try_get("tg_chat_id").ok();
        let tg_user_id: Option<i64> = row.try_get("tg_user_id").ok();
        let tg_message_id: Option<i64> = row.try_get("tg_message_id").ok();
        let tg_group_id: Option<i64> = row.try_get("tg_group_id").ok();
        let tags: Vec<i32> = row.try_get("tags").unwrap_or_default();
        let tag_objects: Vec<serde_json::Value> = tags
            .iter()
            .filter_map(|id| tags_map.get(id).cloned())
            .collect();

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
            "tg_group_id": tg_group_id.map(|v| v.to_string()),
            "tags": tags,
            "tag_objects": tag_objects,
        }));
    }

    // 计算下一页游标
    let next_cursor = if mode != "random" && items.len() == limit as usize {
        base_rows.last().map(|r| r.get::<i64, _>("id"))
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
            let tags_map = fetch_tags_map(&state, &tags).await;
            let tag_objects: Vec<serde_json::Value> = tags
                .iter()
                .filter_map(|id| tags_map.get(id).cloned())
                .collect();

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
                "tag_objects": tag_objects,
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

    let mut unique_tag_ids: HashSet<i32> = HashSet::new();
    for row in &rows {
        let ids: Vec<i32> = row.try_get("tags").unwrap_or_default();
        for id in ids {
            unique_tag_ids.insert(id);
        }
    }
    let mut unique_tag_ids_vec: Vec<i32> = unique_tag_ids.into_iter().collect();
    unique_tag_ids_vec.sort_unstable();
    let tags_map = fetch_tags_map(&state, &unique_tag_ids_vec).await;

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
        let tg_group_id: Option<i64> = row.try_get("tg_group_id").ok();
        let tags: Vec<i32> = row.try_get("tags").unwrap_or_default();
        let tag_objects: Vec<serde_json::Value> = tags
            .iter()
            .filter_map(|id| tags_map.get(id).cloned())
            .collect();

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
            "tg_group_id": tg_group_id.map(|v| v.to_string()),
            "tags": tags,
            "tag_objects": tag_objects,
        }));
    }

    Ok(Json(json!({
        "items": items,
        "total": items.len()
    })))
}

// ============ Tags API ============

async fn list_tags(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rows = sqlx::query(
        r#"
        SELECT id, icon_type, icon_value, label, asset_url, asset_mime
        FROM tags
        ORDER BY id ASC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list tags: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut tags = Vec::with_capacity(rows.len());
    for row in rows {
        let id: i32 = row.get("id");
        let icon_type: String = row.get("icon_type");
        let icon_value: String = row.get("icon_value");
        let label: Option<String> = row.try_get("label").ok();
        let asset_url_raw: Option<String> = row.try_get("asset_url").ok();
        let asset_mime: Option<String> = row.try_get("asset_mime").ok();

        let asset_url = resolve_proxy_url(&state, asset_url_raw).await;

        tags.push(json!({
            "id": id,
            "icon_type": icon_type,
            "icon_value": icon_value,
            "label": label,
            "asset_url": asset_url,
            "asset_mime": asset_mime,
        }));
    }

    Ok(Json(json!({ "tags": tags })))
}

async fn create_tag(
    State(state): State<AppState>,
    Json(req): Json<CreateTagRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let icon_type = req.icon_type.trim().to_string();
    let icon_value = req.icon_value.trim().to_string();

    if icon_type != "emoji" && icon_type != "tmoji" {
        return Err(StatusCode::BAD_REQUEST);
    }
    if icon_value.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let row = sqlx::query(
        r#"
        INSERT INTO tags (icon_type, icon_value, label)
        VALUES ($1, $2, $3)
        ON CONFLICT (icon_type, icon_value)
        DO UPDATE SET label = COALESCE(EXCLUDED.label, tags.label)
        RETURNING id
        "#,
    )
    .bind(&icon_type)
    .bind(&icon_value)
    .bind(req.label.as_deref())
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create tag: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let id: i32 = row.get("id");
    Ok(Json(json!({ "id": id })))
}

async fn update_tag(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateTagRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    sqlx::query("UPDATE tags SET label = $1 WHERE id = $2")
        .bind(req.label.as_deref())
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to update tag {}: {}", id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(json!({ "success": true })))
}

async fn delete_tag(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query(
        r#"
        UPDATE items
        SET tags = array_remove(tags, $1)
        WHERE tags @> ARRAY[$1]::int[]
        "#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to detach tag {}: {}", id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let result = sqlx::query("DELETE FROM tags WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete tag {}: {}", id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(Json(json!({ "success": true })))
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
