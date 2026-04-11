/**
 * mediaHandler.js — Downloads and processes photos, documents, and voice messages
 * from Telegram for multimodal scam detection with Gemini Embedding 2.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Supported media types for Gemini Embedding 2
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const SUPPORTED_AUDIO_TYPES = ['audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/mp4'];
const SUPPORTED_DOC_TYPES = ['application/pdf'];

// Telegram file size limits (Bot API = 20MB download)
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Download a file from Telegram and return its buffer + metadata
 */
async function downloadTelegramFile(bot, fileId) {
  try {
    const file = await bot.getFile(fileId);
    const filePath = file.file_path;
    const fileSize = file.file_size || 0;

    if (fileSize > MAX_FILE_SIZE) {
      return { error: 'File too large (max 20MB)', data: null };
    }

    // Get the download URL
    const token = bot.token;
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return { error: `Download failed: ${response.status}`, data: null };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = guessMimeType(extension, filePath);

    return {
      error: null,
      data: {
        buffer,
        mimeType,
        extension,
        fileSize: buffer.length,
        filePath,
      },
    };
  } catch (err) {
    console.error('File download error:', err.message);
    return { error: err.message, data: null };
  }
}

/**
 * Extract the best file_id from a Telegram message based on media type
 */
function extractMediaInfo(msg) {
  // Photo — array of sizes, pick the largest
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    return {
      type: 'image',
      fileId: largest.file_id,
      caption: msg.caption || '',
    };
  }

  // Voice message
  if (msg.voice) {
    return {
      type: 'audio',
      fileId: msg.voice.file_id,
      duration: msg.voice.duration,
      caption: msg.caption || '',
    };
  }

  // Audio file
  if (msg.audio) {
    return {
      type: 'audio',
      fileId: msg.audio.file_id,
      duration: msg.audio.duration,
      caption: msg.caption || '',
    };
  }

  // Document (PDF, images sent as files)
  if (msg.document) {
    const mime = msg.document.mime_type || '';
    let type = 'unknown';

    if (SUPPORTED_IMAGE_TYPES.includes(mime)) type = 'image';
    else if (SUPPORTED_DOC_TYPES.includes(mime)) type = 'document';
    else if (SUPPORTED_AUDIO_TYPES.includes(mime)) type = 'audio';

    return {
      type,
      fileId: msg.document.file_id,
      fileName: msg.document.file_name || 'unknown',
      mimeType: mime,
      caption: msg.caption || '',
    };
  }

  // Video note (round video messages) — extract as image frame
  if (msg.video_note) {
    return {
      type: 'image',
      fileId: msg.video_note.file_id,
      caption: '',
    };
  }

  // Sticker — can sometimes contain scam imagery
  if (msg.sticker && !msg.sticker.is_animated && !msg.sticker.is_video) {
    return {
      type: 'image',
      fileId: msg.sticker.file_id,
      caption: '',
    };
  }

  return null;
}

/**
 * Convert a file buffer to base64 for the Gemini API
 */
function bufferToBase64(buffer) {
  return buffer.toString('base64');
}

/**
 * Check if a media type is supported for embedding
 */
function isSupportedForEmbedding(mediaInfo) {
  if (!mediaInfo) return false;
  return ['image', 'audio', 'document'].includes(mediaInfo.type);
}

/**
 * Guess MIME type from file extension
 */
function guessMimeType(extension, filePath) {
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
  };

  // Voice messages from Telegram are always OGG Opus
  if (filePath && filePath.includes('voice')) {
    return 'audio/ogg';
  }

  return map[extension] || 'application/octet-stream';
}

module.exports = {
  downloadTelegramFile,
  extractMediaInfo,
  bufferToBase64,
  isSupportedForEmbedding,
  MAX_FILE_SIZE,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_AUDIO_TYPES,
  SUPPORTED_DOC_TYPES,
};
