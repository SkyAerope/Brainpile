use crate::state::AppState;
use teloxide::prelude::*;
use teloxide::types::{ReactionType, ChatId};
use teloxide::net::Download;
use sqlx::Row;
use s3::Bucket;
use s3::creds::Credentials;
use s3::region::Region;

pub async fn run_bot(state: AppState) {
    tracing::info!("Starting Telegram Bot...");
    let bot = Bot::new(&state.config.tg_bot_token);
    
    let handler = Update::filter_message()
        .branch(
            dptree::filter(|msg: Message| {
                msg.photo().is_some() || msg.video().is_some() || msg.text().is_some()
            })
            .endpoint(process_message)
        );

    Dispatcher::builder(bot, handler)
        .dependencies(dptree::deps![state])
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;
}

async fn process_message(bot: Bot, msg: Message, state: AppState) -> ResponseResult<()> {
    tracing::info!("Received message: {} from chat {}", msg.id, msg.chat.id);

    // 1. React with eyes 👀 (processing)
    let reaction = ReactionType::Emoji { emoji: "👀".to_string() };
    if let Err(e) = bot.set_message_reaction(msg.chat.id, msg.id)
        .reaction(vec![reaction])
        .send()
        .await 
    {
        tracing::warn!("Failed to set reaction: {}", e);
    }
    
    // 如果是转发消息，尝试获取并更新来源实体的头像
    if let Some(origin) = msg.forward_origin() {
        let origin = origin.clone();
        let state_clone = state.clone();
        let bot_clone = bot.clone();
        tokio::spawn(async move {
            let (eid, ename) = match &origin {
                teloxide::types::MessageOrigin::User { sender_user, .. } => (Some(sender_user.id.0 as i64), format!("{} {}", sender_user.first_name, sender_user.last_name.as_deref().unwrap_or(""))),
                teloxide::types::MessageOrigin::Chat { sender_chat, .. } => (Some(sender_chat.id.0), sender_chat.title().unwrap_or("Chat").to_string()),
                teloxide::types::MessageOrigin::Channel { chat, .. } => (Some(chat.id.0), chat.title().map(|s| s.to_string()).unwrap_or_default()),
                _ => (None, String::new()),
            };

            if let Some(id) = eid {
                // 检查是否需要更新头像（简单起见，如果 NULL 则更新，或者定期更新）
                let needs_update: bool = sqlx::query_scalar("SELECT avatar_url IS NULL FROM entities WHERE id = $1")
                    .bind(id)
                    .fetch_optional(&state_clone.db)
                    .await
                    .unwrap_or(Some(true))
                    .unwrap_or(true);
                
                if needs_update {
                    if let Ok(chat) = bot_clone.get_chat(ChatId(id)).await {
                        if let Some(photo) = chat.photo {
                            if let Ok(file) = bot_clone.get_file(photo.small_file_id).await {
                                let mut dst = Vec::new();
                                if bot_clone.download_file(&file.path, &mut dst).await.is_ok() {
                                    let ext = file.path.split('.').last().unwrap_or("jpg");
                                    let key = format!("avatars/{}.{}", id, ext);
                                    
                                    // 复用 worker 中的 S3 逻辑（这里简单处理）
                                    let region = Region::Custom {
                                        region: "us-east-1".to_owned(),
                                        endpoint: state_clone.config.s3_endpoint.clone(),
                                    };
                                    let credentials = Credentials::new(
                                        Some(&state_clone.config.s3_access_key),
                                        Some(&state_clone.config.s3_secret_key),
                                        None, None, None
                                    ).ok();
                                    
                                    if let (Some(creds), Some(bucket_name)) = (credentials, Some(&state_clone.config.s3_bucket)) {
                                        let bucket = Bucket::new(bucket_name, region, creds).ok().map(|b| b.with_path_style());
                                        if let Some(bucket) = bucket {
                                            if bucket.put_object(&key, &dst).await.is_ok() {
                                                // 获取签名 URL 并存入 DB
                                                // 签名 URL 有效期限制，更好的做法是存 key，在 api 层面动态签名
                                                // 这里为了简单先存 key
                                                let avatar_url = format!("PROXY:{}", key); 
                                                let _ = sqlx::query("UPDATE entities SET avatar_url = $1 WHERE id = $2")
                                                    .bind(avatar_url)
                                                    .bind(id)
                                                    .execute(&state_clone.db)
                                                    .await;
                                                tracing::info!("Updated avatar for entity {}: {}", id, ename);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    // 2. Insert into DB (Task Queue)
    let bot_chat_id = msg.chat.id.0;
    let bot_message_id = msg.id.0 as i64; 

    // Extract content
    let (file_id, item_type, content_text) = if let Some(photos) = msg.photo() {
        let photo = photos.last().unwrap();
        (Some(photo.file.id.clone()), "image", msg.caption().map(|s| s.to_string()).unwrap_or_default())
    } else if let Some(video) = msg.video() {
         (Some(video.file.id.clone()), "video", msg.caption().map(|s| s.to_string()).unwrap_or_default())
    } else if let Some(text) = msg.text() {
         (None, "text", text.to_string())
    } else {
        return Ok(());
    };

    let payload = serde_json::json!({
        "file_id": file_id,
        "item_type": item_type,
        "content_text": content_text
    });

    // 从 forward_origin 提取来源信息并保存到 entities 表
    let (source_chat_id, source_message_id, source_user_id) = match msg.forward_origin() {
        Some(origin) => {
            let (eid, ename, eusername, etype) = match origin {
                teloxide::types::MessageOrigin::User { sender_user, .. } => {
                    let name = format!("{}{}", 
                        sender_user.first_name, 
                        sender_user.last_name.as_ref().map(|s| format!(" {}", s)).unwrap_or_default()
                    );
                    let type_str = if sender_user.is_bot { "bot" } else { "user" };
                    (Some(sender_user.id.0 as i64), name, sender_user.username.clone(), type_str.to_string())
                }
                teloxide::types::MessageOrigin::Chat { sender_chat, .. } => {
                    let name = sender_chat.title().unwrap_or("Unknown").to_string();
                    let type_str = match &sender_chat.kind {
                        teloxide::types::ChatKind::Public(p) => match p.kind {
                            teloxide::types::PublicChatKind::Channel(_) => "channel",
                            teloxide::types::PublicChatKind::Group => "group",
                            teloxide::types::PublicChatKind::Supergroup(_) => "supergroup",
                        },
                        teloxide::types::ChatKind::Private(_) => "private",
                    };
                    (Some(sender_chat.id.0), name, sender_chat.username().map(|s| s.to_string()), type_str.to_string())
                }
                teloxide::types::MessageOrigin::Channel { chat, .. } => {
                    (Some(chat.id.0), chat.title().map(|s| s.to_string()).unwrap_or_default(), chat.username().map(|s| s.to_string()), "channel".to_string())
                }
                teloxide::types::MessageOrigin::HiddenUser { .. } => (None, String::new(), None, String::new()),
            };

            if let Some(id) = eid {
                tracing::info!("Upserting entity: id={}, name={}, username={:?}, type={}", id, ename, eusername, etype);
                let _ = sqlx::query(
                    r#"
                    INSERT INTO entities (id, name, username, type, updated_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (id) DO UPDATE SET 
                        name = EXCLUDED.name,
                        username = EXCLUDED.username,
                        type = EXCLUDED.type,
                        updated_at = NOW()
                    "#
                )
                .bind(id)
                .bind(ename)
                .bind(eusername)
                .bind(etype)
                .execute(&state.db)
                .await;
            }

            match origin {
                teloxide::types::MessageOrigin::Channel { chat, message_id, .. } => {
                    tracing::info!("Forward from Channel: chat_id={}, msg_id={}", chat.id, message_id.0);
                    (Some(chat.id.0), Some(message_id.0 as i64), None)
                }
                teloxide::types::MessageOrigin::Chat { sender_chat, .. } => {
                    tracing::info!("Forward from Chat: sender_chat_id={}", sender_chat.id);
                    (Some(sender_chat.id.0), None, None)
                }
                teloxide::types::MessageOrigin::User { sender_user, .. } => {
                    tracing::info!("Forward from User: user_id={}", sender_user.id);
                    (None, None, Some(sender_user.id.0 as i64))
                }
                teloxide::types::MessageOrigin::HiddenUser { sender_user_name, .. } => {
                    tracing::info!("Forward from HiddenUser: name={}", sender_user_name);
                    (None, None, None)
                }
            }
        }
        None => {
            tracing::info!("Not a forwarded message");
            (None, None, None)
        }
    };
    
    tracing::info!(
        "Forward info: source_chat_id={:?}, source_message_id={:?}, source_user_id={:?}", 
        source_chat_id, 
        source_message_id,
        source_user_id
    );

    let row = sqlx::query(
        r#"
        INSERT INTO tasks (bot_chat_id, bot_message_id, source_chat_id, source_message_id, source_user_id, status, payload)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        ON CONFLICT DO NOTHING
        RETURNING id
        "#
    )
    .bind(bot_chat_id)
    .bind(bot_message_id)
    .bind(source_chat_id)
    .bind(source_message_id)
    .bind(source_user_id)
    .bind(payload)
    .fetch_optional(&state.db)
    .await;

    match row {
        Ok(Some(rec)) => {
            let id: i64 = rec.get("id");
            tracing::info!("Task #{} queued for message {}", id, bot_message_id);
        },
        Ok(None) => {
            tracing::info!("Task already exists for message {}", bot_message_id);
        },
        Err(e) => {
            tracing::error!("Failed to persist task: {}", e);
            let _ = bot.send_message(msg.chat.id, "System Error: Failed to queue task.").await;
        }
    }

    Ok(())
}
