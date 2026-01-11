use crate::state::AppState;
use teloxide::prelude::*;
use teloxide::types::{ChatId, CustomEmojiId, MessageReactionUpdated, ReactionType};
use teloxide::net::Download;
use sqlx::Row;
use s3::Bucket;
use s3::creds::Credentials;
use s3::region::Region;
use std::collections::HashSet;
use std::io::Read;
use flate2::read::GzDecoder;

pub async fn run_bot(state: AppState) {
    tracing::info!("Starting Telegram Bot...");
    let bot = Bot::new(&state.config.tg_bot_token);
    
    let handler = dptree::entry()
        .branch(
            Update::filter_message().branch(
                dptree::filter(|msg: Message| {
                    msg.photo().is_some() || msg.video().is_some() || msg.text().is_some()
                })
                .endpoint(process_message),
            ),
        )
        .branch(Update::filter_message_reaction_updated().endpoint(process_message_reaction));

    Dispatcher::builder(bot, handler)
        .dependencies(dptree::deps![state])
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;
}

fn reaction_key(reaction: &ReactionType) -> Option<(String, String)> {
    match reaction {
        ReactionType::Emoji { emoji } => Some(("emoji".to_string(), emoji.to_string())),
        ReactionType::CustomEmoji { custom_emoji_id } => {
            Some(("tmoji".to_string(), custom_emoji_id.0.to_string()))
        }
        _ => None,
    }
}

fn diff_reactions(old_reaction: &[ReactionType], new_reaction: &[ReactionType]) -> (Vec<ReactionType>, Vec<ReactionType>) {
    let old_set: HashSet<ReactionType> = old_reaction.iter().cloned().collect();
    let new_set: HashSet<ReactionType> = new_reaction.iter().cloned().collect();

    let added = new_set.difference(&old_set).cloned().collect::<Vec<_>>();
    let removed = old_set.difference(&new_set).cloned().collect::<Vec<_>>();
    (added, removed)
}

async fn resolve_item_id_by_bot_message(
    state: &AppState,
    chat_id: i64,
    message_id: i64,
) -> anyhow::Result<Option<i64>> {
    let item_id: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT item_id
        FROM tasks
        WHERE bot_chat_id = $1
          AND bot_message_id = $2
          AND item_id IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
        "#,
    )
    .bind(chat_id)
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    Ok(item_id)
}

async fn upsert_tag_id(
    state: &AppState,
    icon_type: &str,
    icon_value: &str,
) -> anyhow::Result<i32> {
    let row = sqlx::query(
        r#"
        INSERT INTO tags (icon_type, icon_value)
        VALUES ($1, $2)
        ON CONFLICT (icon_type, icon_value)
        DO UPDATE SET icon_value = EXCLUDED.icon_value
        RETURNING id
        "#,
    )
    .bind(icon_type)
    .bind(icon_value)
    .fetch_one(&state.db)
    .await?;

    Ok(row.get::<i32, _>("id"))
}

async fn ensure_custom_emoji_asset(
    bot: &Bot,
    state: &AppState,
    tag_id: i32,
    custom_emoji_id: &str,
) -> anyhow::Result<()> {
    let existing: Option<String> = sqlx::query_scalar("SELECT asset_url FROM tags WHERE id = $1")
        .bind(tag_id)
        .fetch_optional(&state.db)
        .await?
        .flatten();

    if existing.is_some() {
        return Ok(());
    }

    let stickers = bot
        .get_custom_emoji_stickers(vec![CustomEmojiId(custom_emoji_id.to_string())])
        .send()
        .await?;

    let sticker = match stickers.first() {
        Some(s) => s,
        None => return Ok(()),
    };

    let file = bot.get_file(sticker.file.id.clone()).await?;
    let mut raw = Vec::new();
    bot.download_file(&file.path, &mut raw).await?;

    let ext = file.path.split('.').last().unwrap_or("bin").to_ascii_lowercase();
    let (bytes, ext, mime) = match ext.as_str() {
        "tgs" => {
            let mut decoder = GzDecoder::new(&raw[..]);
            let mut json = Vec::new();
            decoder.read_to_end(&mut json)?;
            (json, "json".to_string(), "application/json+lottie".to_string())
        }
        "webp" => (raw, "webp".to_string(), "image/webp".to_string()),
        "webm" => (raw, "webm".to_string(), "video/webm".to_string()),
        _ => (raw, ext, "application/octet-stream".to_string()),
    };

    let region = Region::Custom {
        region: "us-east-1".to_owned(),
        endpoint: state.config.s3_endpoint.clone(),
    };
    let credentials = Credentials::new(
        Some(&state.config.s3_access_key),
        Some(&state.config.s3_secret_key),
        None,
        None,
        None,
    )
    .ok();

    let bucket = match credentials {
        Some(creds) => Bucket::new(&state.config.s3_bucket, region, creds)
            .ok()
            .map(|b| b.with_path_style()),
        None => None,
    };

    let Some(bucket) = bucket else { return Ok(()); };

    let key = format!("tags/custom_emoji/{}.{}", custom_emoji_id, ext);
    bucket.put_object(&key, &bytes).await?;

    let asset_url = format!("PROXY:{}", key);
    sqlx::query("UPDATE tags SET asset_url = $1, asset_mime = $2 WHERE id = $3")
        .bind(asset_url)
        .bind(mime)
        .bind(tag_id)
        .execute(&state.db)
        .await?;

    Ok(())
}

async fn attach_tag_to_item(state: &AppState, item_id: i64, tag_id: i32) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        UPDATE items
        SET tags = CASE
            WHEN tags @> ARRAY[$1]::int[] THEN tags
            ELSE array_append(tags, $1)
        END
        WHERE id = $2
        "#,
    )
    .bind(tag_id)
    .bind(item_id)
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn detach_tag_from_item(state: &AppState, item_id: i64, tag_id: i32) -> anyhow::Result<()> {
    sqlx::query("UPDATE items SET tags = array_remove(tags, $1) WHERE id = $2")
        .bind(tag_id)
        .bind(item_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

async fn process_message_reaction(
    bot: Bot,
    reaction: MessageReactionUpdated,
    state: AppState,
) -> ResponseResult<()> {
    tracing::debug!(
        "MessageReactionUpdated: chat_id={}, message_id={}, old_len={}, new_len={}",
        reaction.chat.id.0,
        reaction.message_id.0,
        reaction.old_reaction.len(),
        reaction.new_reaction.len()
    );

    let chat_id = reaction.chat.id.0;
    let message_id = reaction.message_id.0 as i64;

    let Some(item_id) = resolve_item_id_by_bot_message(&state, chat_id, message_id)
        .await
        .ok()
        .flatten() else {
        tracing::debug!(
            "No item_id mapped for reaction chat_id={}, message_id={} (task missing or item not ready)",
            chat_id,
            message_id
        );
        return Ok(());
    };

    let (added, removed) = diff_reactions(&reaction.old_reaction, &reaction.new_reaction);

    for r in added {
        let Some((icon_type, icon_value)) = reaction_key(&r) else { continue; };
        let tag_id = match upsert_tag_id(&state, &icon_type, &icon_value).await {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!("Failed to upsert tag: {}", e);
                continue;
            }
        };

        if icon_type == "tmoji" {
            if let Err(e) = ensure_custom_emoji_asset(&bot, &state, tag_id, &icon_value).await {
                tracing::warn!("Failed to fetch custom emoji asset: {}", e);
            }
        }

        if let Err(e) = attach_tag_to_item(&state, item_id, tag_id).await {
            tracing::warn!("Failed to attach tag {} to item {}: {}", tag_id, item_id, e);
        }
    }

    for r in removed {
        let Some((icon_type, icon_value)) = reaction_key(&r) else { continue; };
        let tag_id: Option<i32> = sqlx::query_scalar(
            "SELECT id FROM tags WHERE icon_type = $1 AND icon_value = $2",
        )
        .bind(icon_type)
        .bind(icon_value)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let Some(tag_id) = tag_id else { continue; };
        if let Err(e) = detach_tag_from_item(&state, item_id, tag_id).await {
            tracing::warn!("Failed to detach tag {} from item {}: {}", tag_id, item_id, e);
        }
    }

    Ok(())
}

async fn update_entity_avatar(bot: Bot, state: AppState, id: i64, name: String) {
    // 检查是否需要更新头像（简单起见，如果 NULL 则更新，或者定期更新）
    let needs_update: bool = sqlx::query_scalar("SELECT avatar_url IS NULL FROM entities WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(Some(true))
        .unwrap_or(true);
    
    if !needs_update {
        return;
    }

    if let Ok(chat) = bot.get_chat(ChatId(id)).await {
        if let Some(photo) = chat.photo {
            if let Ok(file) = bot.get_file(photo.small_file_id).await {
                let mut dst = Vec::new();
                if bot.download_file(&file.path, &mut dst).await.is_ok() {
                    let ext = file.path.split('.').last().unwrap_or("jpg");
                    let key = format!("avatars/{}.{}", id, ext);
                    
                    let region = Region::Custom {
                        region: "us-east-1".to_owned(),
                        endpoint: state.config.s3_endpoint.clone(),
                    };
                    let credentials = Credentials::new(
                        Some(&state.config.s3_access_key),
                        Some(&state.config.s3_secret_key),
                        None, None, None
                    ).ok();
                    
                    if let (Some(creds), Some(bucket_name)) = (credentials, Some(&state.config.s3_bucket)) {
                        let bucket = Bucket::new(bucket_name, region, creds).ok().map(|b| b.with_path_style());
                        if let Some(bucket) = bucket {
                            if bucket.put_object(&key, &dst).await.is_ok() {
                                let avatar_url = format!("PROXY:{}", key); 
                                let _ = sqlx::query("UPDATE entities SET avatar_url = $1 WHERE id = $2")
                                    .bind(avatar_url)
                                    .bind(id)
                                    .execute(&state.db)
                                    .await;
                                tracing::info!("Updated avatar for entity {}: {}", id, name);
                            }
                        }
                    }
                }
            }
        }
    }
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
                update_entity_avatar(bot_clone, state_clone, id, ename).await;
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

    let mut payload = serde_json::json!({
        "file_id": file_id,
        "item_type": item_type,
        "content_text": content_text,
        "meta": {}
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
                teloxide::types::MessageOrigin::HiddenUser { sender_user_name, .. } => {
                    // HiddenUser 没有 ID，但我们可以记录名字到 meta
                    (None, sender_user_name.clone(), None, "hidden_user".to_string())
                }
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
            } else if etype == "hidden_user" {
                // 为 Hidden User 创建一个特殊的实体项，ID 定为 0
                let _ = sqlx::query(
                    r#"
                    INSERT INTO entities (id, name, username, type, updated_at)
                    VALUES (0, 'Hidden Users', NULL, 'hidden', NOW())
                    ON CONFLICT (id) DO UPDATE SET 
                        updated_at = NOW()
                    "#
                )
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
                    // 记录 HiddenUser 的名字到 payload 的 meta 中
                    payload["meta"]["forward_sender_name"] = serde_json::Value::String(sender_user_name.clone());
                    (None, None, Some(0)) // Hidden User 的 tg_user_id 设为 0
                }
            }
        }
        None => {
            tracing::info!("Not a forwarded message, recording sender as source_user_id");
            let sender_id = msg.from.as_ref().map(|u| u.id.0 as i64).unwrap_or(0);
            
            // 自动将发送者存入 entities 表
            if let Some(user) = msg.from.as_ref() {
                let name = format!("{}{}", 
                    user.first_name, 
                    user.last_name.as_ref().map(|s| format!(" {}", s)).unwrap_or_default()
                );
                let _ = sqlx::query(
                    r#"
                    INSERT INTO entities (id, name, username, type, updated_at)
                    VALUES ($1, $2, $3, 'user', NOW())
                    ON CONFLICT (id) DO UPDATE SET 
                        name = EXCLUDED.name,
                        username = EXCLUDED.username,
                        updated_at = NOW()
                    "#
                )
                .bind(user.id.0 as i64)
                .bind(name.clone())
                .bind(user.username.clone())
                .execute(&state.db)
                .await;

                // 异步抓取发送者头像
                let bot_clone = bot.clone();
                let state_clone = state.clone();
                let user_id = user.id.0 as i64;
                tokio::spawn(async move {
                    update_entity_avatar(bot_clone, state_clone, user_id, name).await;
                });
            }
            
            (None, None, Some(sender_id))
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
