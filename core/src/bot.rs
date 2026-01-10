use crate::state::AppState;
use teloxide::prelude::*;
use teloxide::types::ReactionType;
use sqlx::Row;

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
