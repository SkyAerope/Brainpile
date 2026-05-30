use crate::state::AppState;
use sqlx::Row;
use teloxide::prelude::*;
use teloxide::net::Download;
use teloxide::types::{ReactionType, FileId};
use s3::Bucket;
use s3::creds::Credentials;
use s3::region::Region;
use std::panic::AssertUnwindSafe;
use std::process::Stdio;
use futures::FutureExt;
use tokio::process::Command;

fn payload_group_id_str(payload: &serde_json::Value) -> Option<String> {
    payload.get("tg_group_id").and_then(|v| match v {
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    })
}

async fn update_album_reaction(
    state: &AppState,
    bot: &Bot,
    bot_chat_id: i64,
    group_id: &str,
) -> anyhow::Result<()> {
    let row = sqlx::query(
        r#"
        SELECT
            MIN(bot_message_id) AS leader_message_id,
            COUNT(*)::bigint AS cnt,
            BOOL_OR(status = 'failed') AS any_failed,
            BOOL_AND(status = 'completed') AS all_completed
        FROM tasks
        WHERE bot_chat_id = $1
          AND payload->>'tg_group_id' = $2
        "#,
    )
    .bind(bot_chat_id)
    .bind(group_id)
    .fetch_one(&state.db)
    .await?;

    let leader_message_id: Option<i64> = row.try_get("leader_message_id").ok();
    let cnt: i64 = row.try_get::<i64, _>("cnt").unwrap_or(0);
    let any_failed: bool = row.try_get::<Option<bool>, _>("any_failed").ok().flatten().unwrap_or(false);
    let all_completed: bool = row.try_get::<Option<bool>, _>("all_completed").ok().flatten().unwrap_or(false);

    let Some(leader_message_id) = leader_message_id else { return Ok(()); };
    if cnt <= 0 {
        return Ok(());
    }

    // Policy:
    // - Any failed => 👎 immediately
    // - All completed => ❤️
    // - Otherwise keep existing 👀 (do nothing)
    let emoji = if any_failed {
        Some("👎")
    } else if all_completed {
        Some("❤️")
    } else {
        None
    };

    let Some(emoji) = emoji else { return Ok(()); };
    let chat_id = teloxide::types::ChatId(bot_chat_id);
    let message_id = teloxide::types::MessageId(leader_message_id as i32);
    let reaction = ReactionType::Emoji { emoji: emoji.to_string() };
    let _ = bot
        .set_message_reaction(chat_id, message_id)
        .reaction(vec![reaction])
        .send()
        .await;

    Ok(())
}

fn payload_tag_ids(payload: &serde_json::Value) -> Vec<i32> {
    payload
        .get("tag_ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_i64().and_then(|n| i32::try_from(n).ok()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

async fn apply_tag_ids_to_item(state: &AppState, item_id: i64, tag_ids: &[i32]) -> anyhow::Result<()> {
    if tag_ids.is_empty() {
        return Ok(());
    }

    // Dedup in DB by constructing a distinct array.
    sqlx::query(
        r#"
        UPDATE items i
        SET tags = (
            SELECT ARRAY(
                SELECT DISTINCT t
                FROM unnest(COALESCE(i.tags, '{}'::int[]) || $1::int[]) AS t
            )
        )
        WHERE i.id = $2
        "#,
    )
    .bind(tag_ids)
    .bind(item_id)
    .execute(&state.db)
    .await?;

    Ok(())
}

pub async fn run_worker(state: AppState) {
    tracing::info!("Worker pipeline started.");

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

    loop {
        let result = AssertUnwindSafe(process_next_task(&state, &bucket)).catch_unwind().await;
        
        match result {
            Ok(Ok(true)) => continue,
            Ok(Ok(false)) => {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            },
            Ok(Err(e)) => {
                tracing::error!("Worker error: {:?}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            },
            Err(payload) => {
                tracing::error!("Worker panicked! Task processing failed due to internal panic.");
                if let Some(s) = payload.downcast_ref::<&str>() {
                    tracing::error!("Panic payload: {}", s);
                } else if let Some(s) = payload.downcast_ref::<String>() {
                    tracing::error!("Panic payload: {}", s);
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn process_next_task(state: &AppState, bucket: &Bucket) -> anyhow::Result<bool> {
    let mut tx = state.db.begin().await?;
    
    let row = sqlx::query(
        r#"
        SELECT id, bot_chat_id, bot_message_id, source_chat_id, source_message_id, source_user_id, payload 
        FROM tasks 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT 1 
        FOR UPDATE SKIP LOCKED
        "#
    )
    .fetch_optional(&mut *tx)
    .await?;

    let (task_id, bot_chat_id, bot_message_id, source_chat_id, source_message_id, source_user_id, payload) = match row {
        Some(r) => (
             r.get::<i64, _>("id"),
             r.get::<i64, _>("bot_chat_id"),
             r.get::<i64, _>("bot_message_id"),
             r.get::<Option<i64>, _>("source_chat_id"),
             r.get::<Option<i64>, _>("source_message_id"),
             r.get::<Option<i64>, _>("source_user_id"),
             r.get::<Option<serde_json::Value>, _>("payload").unwrap_or(serde_json::json!({}))
        ),
        None => return Ok(false),
    };

    sqlx::query("UPDATE tasks SET status = 'processing', updated_at = NOW() WHERE id = $1")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    
    tracing::info!("Processing task #{}", task_id);
    
    let result = match AssertUnwindSafe(perform_task(state, bucket, bot_chat_id, bot_message_id, source_chat_id, source_message_id, source_user_id, payload.clone())).catch_unwind().await {
        Ok(res) => res,
        Err(payload) => {
            let msg = if let Some(s) = payload.downcast_ref::<&str>() {
                format!("Internal Panic: {}", s)
            } else if let Some(s) = payload.downcast_ref::<String>() {
                format!("Internal Panic: {}", s)
            } else {
                "Internal Panic: Unknown cause".to_string()
            };
            Err(anyhow::anyhow!(msg))
        }
    };

    let bot = Bot::new(&state.config.tg_bot_token);
    let chat_id = teloxide::types::ChatId(bot_chat_id);
    let message_id = teloxide::types::MessageId(bot_message_id as i32);
    
    match result {
        Ok(item_id) => {
            // 查询是否有之前的错误回复消息需要删除
            let prev_error_reply: Option<Option<i64>> = sqlx::query_scalar(
                "SELECT error_reply_id FROM tasks WHERE id = $1"
            )
            .bind(task_id)
            .fetch_optional(&state.db)
            .await?;
            
            // 更新任务状态
            sqlx::query("UPDATE tasks SET status = 'completed', item_id = $1, error_reply_id = NULL, updated_at = NOW() WHERE id = $2")
                .bind(item_id)
                .bind(task_id)
                .execute(&state.db)
                .await?;
            
            // Reaction policy for albums:
            // - ❤️ only when the whole album has completed
            // - 👎 if any member failed
            // - otherwise keep 👀 (do nothing)
            if let Some(gid) = payload_group_id_str(&payload) {
                let _ = update_album_reaction(state, &bot, bot_chat_id, &gid).await;
            } else {
                let reaction = ReactionType::Emoji { emoji: "❤️".to_string() };
                let _ = bot
                    .set_message_reaction(chat_id, message_id)
                    .reaction(vec![reaction])
                    .send()
                    .await;
            }
            
            // 删除之前的错误回复消息（如果有）
            if let Some(Some(reply_id)) = prev_error_reply {
                let _ = bot.delete_message(chat_id, teloxide::types::MessageId(reply_id as i32)).await;
            }
        },
        Err(e) => {
            tracing::error!("Task #{} failed: {}", task_id, e);
            
            if let Some(gid) = payload_group_id_str(&payload) {
                let _ = update_album_reaction(state, &bot, bot_chat_id, &gid).await;
            } else {
                let reaction = ReactionType::Emoji { emoji: "👎".to_string() };
                let _ = bot
                    .set_message_reaction(chat_id, message_id)
                    .reaction(vec![reaction])
                    .send()
                    .await;
            }
            
            // 查询是否已有错误回复消息
            let prev_error_reply: Option<i64> = sqlx::query_scalar::<_, Option<i64>>(
                "SELECT error_reply_id FROM tasks WHERE id = $1"
            )
            .bind(task_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten();
            
            let error_msg = format!("❌ 处理失败：{}", e);
            
            let error_reply_id = if let Some(reply_id) = prev_error_reply {
                // 编辑已有的错误消息
                let _ = bot.edit_message_text(chat_id, teloxide::types::MessageId(reply_id as i32), &error_msg).await;
                reply_id
            } else {
                // 回复新的错误消息，使用 reply_parameters
                let reply_params = teloxide::types::ReplyParameters::new(message_id);
                match bot.send_message(chat_id, &error_msg)
                    .reply_parameters(reply_params)
                    .await 
                {
                    Ok(sent) => sent.id.0 as i64,
                    Err(_) => 0
                }
            };
            
            // 更新任务状态和错误回复 ID
            sqlx::query("UPDATE tasks SET status = 'failed', error_message = $1, error_reply_id = $2, updated_at = NOW() WHERE id = $3")
                .bind(e.to_string())
                .bind(if error_reply_id > 0 { Some(error_reply_id) } else { None })
                .bind(task_id)
                .execute(&state.db)
                .await?;
        }
    }

    Ok(true)
}

async fn perform_task(
    state: &AppState, 
    bucket: &Bucket, 
    _bot_chat_id: i64, 
    _bot_message_id: i64, 
    source_chat_id: Option<i64>,
    source_message_id: Option<i64>,
    source_user_id: Option<i64>,
    payload: serde_json::Value
) -> anyhow::Result<i64> {
    let bot = Bot::new(&state.config.tg_bot_token);
    let file_id = payload["file_id"].as_str();
    let item_type = payload["item_type"].as_str().unwrap_or("text");
    let content_text = payload["content_text"].as_str().unwrap_or("").to_string();

    let tg_group_id = payload.get("tg_group_id").and_then(|v| match v {
        serde_json::Value::Number(n) => n.as_i64(),
        serde_json::Value::String(s) => s.parse::<i64>().ok(),
        _ => None,
    });
    
    let mut s3_key: Option<String> = None;
    let mut thumbnail_key: Option<String> = None;
    let mut file_bytes: Vec<u8> = Vec::new();
    // 从 payload 中继承 meta 信息（如 forward_sender_name）
    let mut meta = payload.get("meta").cloned().unwrap_or_else(|| serde_json::json!({}));

    if let Some(fid) = file_id {
        if !fid.is_empty() {
             let file_info = bot.get_file(FileId(fid.to_string())).await?;
             let mut dst = Vec::new();
             bot.download_file(&file_info.path, &mut dst).await?;
             file_bytes = dst;
             
             let ext = file_info.path.split('.').last().unwrap_or("bin");
             let key = format!("{}/{}.{}", chrono::Utc::now().format("%Y/%m/%d"), uuid::Uuid::new_v4(), ext);
             
             bucket.put_object(&key, &file_bytes).await?;
             s3_key = Some(key);
        }
    }
    
    // 图片处理：宽高提取及缩略图生成
    if item_type == "image" && !file_bytes.is_empty() {
        if let Ok(img) = image::load_from_memory(&file_bytes) {
            meta["width"] = serde_json::json!(img.width());
            meta["height"] = serde_json::json!(img.height());
            meta["file_size"] = serde_json::json!(file_bytes.len());
            tracing::info!("Image dimensions: {}x{}", img.width(), img.height());

            // 生成缩略图 (限制最大宽度或高度为 800px)
            let thumbnail = img.thumbnail(800, 800);
            let mut thumb_buf = std::io::Cursor::new(Vec::new());
            if thumbnail.write_to(&mut thumb_buf, image::ImageFormat::Jpeg).is_ok() {
                let thumb_data = thumb_buf.into_inner();
                let thumb_key = format!(
                    "{}/{}_thumb.jpg",
                    chrono::Utc::now().format("%Y/%m/%d"),
                    uuid::Uuid::new_v4()
                );
                if bucket.put_object(&thumb_key, &thumb_data).await.is_ok() {
                    thumbnail_key = Some(thumb_key);
                    tracing::info!("Image thumbnail uploaded");
                }
            }
        }
    }
    
    // 视频处理：ffprobe 提取宽高/时长，ffmpeg 抽封面帧
    let mut cover_frame_bytes: Vec<u8> = Vec::new();
    if item_type == "video" && !file_bytes.is_empty() {
        // 写入临时文件供 ffprobe/ffmpeg 处理
        let temp_dir = tempfile::tempdir()?;
        let video_path = temp_dir.path().join("video.mp4");
        tokio::fs::write(&video_path, &file_bytes).await?;
        
        // ffprobe 提取元信息
        let probe_output = Command::new("ffprobe")
            .args([
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
            ])
            .arg(&video_path)
            .output()
            .await;
        
        if let Ok(output) = probe_output {
            if output.status.success() {
                if let Ok(probe_json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                    // 从 streams 中找 video 流提取宽高
                    if let Some(streams) = probe_json.get("streams").and_then(|s| s.as_array()) {
                        for stream in streams {
                            if stream.get("codec_type").and_then(|t| t.as_str()) == Some("video") {
                                if let Some(w) = stream.get("width").and_then(|v| v.as_i64()) {
                                    meta["width"] = serde_json::json!(w);
                                }
                                if let Some(h) = stream.get("height").and_then(|v| v.as_i64()) {
                                    meta["height"] = serde_json::json!(h);
                                }
                                break;
                            }
                        }
                    }
                    // 从 format 中提取时长
                    if let Some(duration_str) = probe_json.get("format")
                        .and_then(|f| f.get("duration"))
                        .and_then(|d| d.as_str())
                    {
                        if let Ok(duration) = duration_str.parse::<f64>() {
                            meta["duration"] = serde_json::json!(duration);
                        }
                    }
                    meta["file_size"] = serde_json::json!(file_bytes.len());
                    tracing::info!("Video meta: {:?}", meta);
                }
            }
        }
        
        // ffmpeg 提取封面帧（第1秒或第一帧）
        let cover_path = temp_dir.path().join("cover.jpg");
        let ffmpeg_result = Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
            ])
            .arg(&video_path)
            .args([
                "-ss", "00:00:01",
                "-vframes", "1",
                "-q:v", "2",
            ])
            .arg(&cover_path)
            .stderr(Stdio::null())
            .stdout(Stdio::null())
            .status()
            .await;
        
        // 如果 1s 位置失败，尝试第一帧
        if ffmpeg_result.is_err() || !cover_path.exists() {
            let _ = Command::new("ffmpeg")
                .args(["-y", "-i"])
                .arg(&video_path)
                .args(["-vframes", "1", "-q:v", "2"])
                .arg(&cover_path)
                .stderr(Stdio::null())
                .stdout(Stdio::null())
                .status()
                .await;
        }
        
        if cover_path.exists() {
            if let Ok(cover_data) = tokio::fs::read(&cover_path).await {
                cover_frame_bytes = cover_data.clone();
                // 上传封面到 S3
                let thumb_key = format!("{}/{}_thumb.jpg", chrono::Utc::now().format("%Y/%m/%d"), uuid::Uuid::new_v4());
                if bucket.put_object(&thumb_key, &cover_data).await.is_ok() {
                    thumbnail_key = Some(thumb_key);
                    tracing::info!("Video cover frame uploaded");
                }
            }
        }
    }
    
    let mut embedding_str: Option<String> = None;
    let mut searchable_text = content_text.clone();

    // 1. OCR via VLM for images
    if item_type == "image" && !file_bytes.is_empty() {
        let base64_image = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &file_bytes);
        let vlm_url = format!("{}/chat/completions", state.config.vlm_api_base);
        let body = serde_json::json!({
            "model": state.config.vlm_model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "请识别这张图片中的所有文字内容，只输出识别到的文字，不要任何解释。如果没有文字就输出空。"},
                    {"type": "image_url", "image_url": {"url": format!("data:image/jpeg;base64,{}", base64_image)}}
                ]
            }],
            "max_tokens": 2048
        });
        
        let res = state.http_client
            .post(&vlm_url)
            .header("Authorization", format!("Bearer {}", state.config.vlm_api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;
        
        if res.status().is_success() {
            let json: serde_json::Value = res.json().await?;
            if let Some(ocr_text) = json.get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
            {
                let ocr_text = ocr_text.trim();
                if !ocr_text.is_empty() && ocr_text != "空" {
                    let log_text: String = ocr_text.chars().take(50).collect();
                    tracing::info!("OCR extracted: {}...", log_text);
                    // Append OCR text to searchable_text
                    if searchable_text.is_empty() {
                        searchable_text = ocr_text.to_string();
                    } else {
                        searchable_text = format!("{}\n{}", searchable_text, ocr_text);
                    }
                }
            }
        } else {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            tracing::warn!("VLM OCR error: {} - {}", status, text);
        }
    }

    // 2. 统一嵌入（jina-v5-omni）：图片/视频封面走图片向量，否则走文档文本向量。
    //    文本/图片共享同一 768 维向量空间，因此只需写入单一 embedding 列。
    let visual_bytes = if item_type == "image" && !file_bytes.is_empty() {
        Some(file_bytes.clone())
    } else if item_type == "video" && !cover_frame_bytes.is_empty() {
        Some(cover_frame_bytes.clone())
    } else {
        None
    };

    if let Some(img_bytes) = visual_bytes {
        if let Some(vec) = crate::embedding::embed_image(state, &img_bytes).await {
            embedding_str = Some(crate::embedding::vec_to_pgvector(&vec));
            tracing::info!("Generated jina image embedding for {}", item_type);
        } else {
            tracing::warn!("jina image embedding failed for {}", item_type);
        }
    } else if !searchable_text.is_empty() {
        if let Some(vec) = crate::embedding::embed_document_text(state, &searchable_text).await {
            embedding_str = Some(crate::embedding::vec_to_pgvector(&vec));
            tracing::info!("Generated jina text embedding ({} dims)", vec.len());
        } else {
            tracing::warn!("jina text embedding failed");
        }
    }
    
    // 哈希计算：有文件和文本时是 md5(文件哈希 + 文本哈希)，否则单独计算
    let content_hash = if !file_bytes.is_empty() && !content_text.is_empty() {
        // 图+文: md5(md5(file) + md5(text))
        let file_hash = format!("{:x}", md5::compute(&file_bytes));
        let text_hash = format!("{:x}", md5::compute(content_text.as_bytes()));
        format!("{:x}", md5::compute(format!("{}{}", file_hash, text_hash)))
    } else if !file_bytes.is_empty() {
        // 纯文件
        format!("{:x}", md5::compute(&file_bytes))
    } else {
        // 纯文本
        format!("{:x}", md5::compute(content_text.as_bytes()))
    };

    let rec = sqlx::query(
        r#"
        INSERT INTO items (
            item_type, content_hash, s3_key, thumbnail_key, 
            content_text, searchable_text, 
            embedding, 
            meta, tg_chat_id, tg_message_id, tg_user_id, tg_group_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9, $10, $11, $12)
        RETURNING id
        "#
    )
    .bind(item_type)
    .bind(content_hash)
    .bind(s3_key)
    .bind(thumbnail_key)
    .bind(&content_text)
    .bind(&searchable_text)
    .bind(embedding_str)
    .bind(&meta)
    .bind(source_chat_id)
    .bind(source_message_id)
    .bind(source_user_id)
    .bind(tg_group_id)
    .fetch_one(&state.db)
    .await?;

    let item_id: i64 = rec.get("id");
    let tag_ids = payload_tag_ids(&payload);
    if let Err(e) = apply_tag_ids_to_item(state, item_id, &tag_ids).await {
        tracing::warn!("Failed to apply inherited tags to item {}: {}", item_id, e);
    }

    Ok(item_id)
}
