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

    let source_chat_id: Option<i64> = None;
    let source_message_id: Option<i64> = None;

    let row = sqlx::query(
        r#"
        INSERT INTO tasks (bot_chat_id, bot_message_id, source_chat_id, source_message_id, status, payload)
        VALUES ($1, $2, $3, $4, 'pending', $5)
        ON CONFLICT DO NOTHING
        RETURNING id
        "#
    )
    .bind(bot_chat_id)
    .bind(bot_message_id)
    .bind(source_chat_id)
    .bind(source_message_id)
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
