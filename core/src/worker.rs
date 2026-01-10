use crate::state::AppState;
use sqlx::Row;
use teloxide::prelude::*;
use teloxide::net::Download;
use teloxide::types::{ReactionType, FileId};
use s3::Bucket;
use s3::creds::Credentials;
use s3::region::Region;

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
        let processed = process_next_task(&state, &bucket).await;
        match processed {
            Ok(true) => continue,
            Ok(false) => {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            },
            Err(e) => {
                tracing::error!("Worker error: {:?}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn process_next_task(state: &AppState, bucket: &Bucket) -> anyhow::Result<bool> {
    let mut tx = state.db.begin().await?;
    
    let row = sqlx::query(
        r#"
        SELECT id, bot_chat_id, bot_message_id, payload 
        FROM tasks 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT 1 
        FOR UPDATE SKIP LOCKED
        "#
    )
    .fetch_optional(&mut *tx)
    .await?;

    let (task_id, bot_chat_id, bot_message_id, payload) = match row {
        Some(r) => (
             r.get::<i64, _>("id"),
             r.get::<i64, _>("bot_chat_id"),
             r.get::<i64, _>("bot_message_id"),
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
    
    let result = perform_task(state, bucket, bot_chat_id, bot_message_id, payload).await;

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
            
            // 设置成功 Reaction
            let reaction = ReactionType::Emoji { emoji: "❤️".to_string() };
            let _ = bot.set_message_reaction(chat_id, message_id)
                .reaction(vec![reaction])
                .send()
                .await;
            
            // 删除之前的错误回复消息（如果有）
            if let Some(Some(reply_id)) = prev_error_reply {
                let _ = bot.delete_message(chat_id, teloxide::types::MessageId(reply_id as i32)).await;
            }
        },
        Err(e) => {
            tracing::error!("Task #{} failed: {}", task_id, e);
            
            // 设置失败 Reaction
            let reaction = ReactionType::Emoji { emoji: "👎".to_string() };
            let _ = bot.set_message_reaction(chat_id, message_id)
                .reaction(vec![reaction])
                .send()
                .await;
            
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

async fn perform_task(state: &AppState, bucket: &Bucket, _chat_id: i64, _message_id: i64, payload: serde_json::Value) -> anyhow::Result<i64> {
    let bot = Bot::new(&state.config.tg_bot_token);
    let file_id = payload["file_id"].as_str();
    let item_type = payload["item_type"].as_str().unwrap_or("text");
    let content_text = payload["content_text"].as_str().unwrap_or("").to_string();
    
    let mut s3_key: Option<String> = None;
    let mut file_bytes: Vec<u8> = Vec::new();

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
    
    let mut visual_embedding_str: Option<String> = None;
    let mut text_embedding_str: Option<String> = None;
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
                    tracing::info!("OCR extracted: {}", &ocr_text[..ocr_text.len().min(100)]);
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

    // 2. Visual Embedding (CLIP) for images
    if item_type == "image" && !file_bytes.is_empty() {
        let clip_url = format!("{}/embed", state.config.clip_api_url);
        let part = reqwest::multipart::Part::bytes(file_bytes.clone())
           .file_name("image.jpg")
           .mime_str("image/jpeg")?;
        let form = reqwest::multipart::Form::new().part("file", part);
        let res = state.http_client.post(&clip_url).multipart(form).send().await?;
        if res.status().is_success() {
             let json: serde_json::Value = res.json().await?;
             if let Some(arr) = json.get("embedding").and_then(|v| v.as_array()) {
                 let vec: Vec<f32> = arr.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect();
                 visual_embedding_str = Some(format!("[{}]", vec.iter().map(|f| f.to_string()).collect::<Vec<_>>().join(",")));
             }
        }
    }

    // 3. Text Embedding (BGE-M3 via OpenAI-compatible API) for searchable text
    if !searchable_text.is_empty() {
        let embedding_url = format!("{}/embeddings", state.config.embedding_api_base);
        let body = serde_json::json!({
            "model": state.config.embedding_model,
            "input": searchable_text
        });
        let res = state.http_client
            .post(&embedding_url)
            .header("Authorization", format!("Bearer {}", state.config.embedding_api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;
        
        if res.status().is_success() {
            let json: serde_json::Value = res.json().await?;
            // OpenAI format: {"data": [{"embedding": [...]}]}
            if let Some(arr) = json.get("data")
                .and_then(|d| d.get(0))
                .and_then(|d| d.get("embedding"))
                .and_then(|e| e.as_array()) 
            {
                let vec: Vec<f32> = arr.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect();
                text_embedding_str = Some(format!("[{}]", vec.iter().map(|f| f.to_string()).collect::<Vec<_>>().join(",")));
                tracing::info!("Generated text embedding with {} dimensions", vec.len());
            }
        } else {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            tracing::warn!("Embedding API error: {} - {}", status, text);
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
        INSERT INTO items (item_type, content_hash, s3_key, content_text, searchable_text, text_embedding, visual_embedding)
        VALUES ($1, $2, $3, $4, $5, $6::vector, $7::vector)
        RETURNING id
        "#
    )
    .bind(item_type)
    .bind(content_hash)
    .bind(s3_key)
    .bind(&content_text)
    .bind(&searchable_text)
    .bind(text_embedding_str)
    .bind(visual_embedding_str)
    .fetch_one(&state.db)
    .await?;

    Ok(rec.get("id"))
}
