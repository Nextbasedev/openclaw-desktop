import crypto from "node:crypto"
import { getDb } from "../db/connection.js"

export type FeedbackInput = {
  conversation_id: string
  message_id: string
  rating: "thumbsUp" | "thumbsDown"
  tags?: string[]
  details?: string
}

export async function messageFeedback(input: FeedbackInput) {
  const db = getDb()
  const now = new Date().toISOString()
  
  const existing = db
    .prepare("SELECT id FROM message_feedback WHERE conversation_id = ? AND message_id = ?")
    .get(input.conversation_id, input.message_id) as { id: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE message_feedback 
      SET rating = ?, tags_json = ?, details = ?, updated_at = ? 
      WHERE id = ?
    `).run(
      input.rating,
      input.tags ? JSON.stringify(input.tags) : null,
      input.details || null,
      now,
      existing.id
    )
    return { 
      id: existing.id, 
      conversation_id: input.conversation_id,
      message_id: input.message_id,
      rating: input.rating,
      status: "updated" 
    }
  } else {
    const id = `fb_${crypto.randomUUID().replace(/-/g, "")}`
    db.prepare(`
      INSERT INTO message_feedback (id, conversation_id, message_id, rating, tags_json, details, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.conversation_id,
      input.message_id,
      input.rating,
      input.tags ? JSON.stringify(input.tags) : null,
      input.details || null,
      now,
      now
    )
    return { 
      id, 
      conversation_id: input.conversation_id,
      message_id: input.message_id,
      rating: input.rating,
      status: "created" 
    }
  }
}

export async function deleteMessageFeedback(input: { conversation_id: string; message_id: string }) {
  const db = getDb()
  db.prepare("DELETE FROM message_feedback WHERE conversation_id = ? AND message_id = ?")
    .run(input.conversation_id, input.message_id)
  return { ok: true }
}
