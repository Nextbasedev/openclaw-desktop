type ChatSendAttachment = {
  name?: string;
  mimeType?: string;
  content?: string;
  encoding?: "utf-8" | "base64";
  size?: number;
};

type GatewayAttachment = {
  type: "image";
  fileName: string;
  mimeType: string;
  content: string;
};

const TEXT_ATTACHMENT_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "image/svg+xml",
]);

const MAX_EMBEDDED_ATTACHMENT_CHARS = 120_000;
const MAX_TOTAL_EMBEDDED_ATTACHMENT_CHARS = 300_000;

function isTextAttachment(mimeType: string) {
  return mimeType.startsWith("text/") || TEXT_ATTACHMENT_MIME_TYPES.has(mimeType);
}

function decodeAttachmentText(attachment: ChatSendAttachment): string | null {
  if (!attachment.content) return null;
  try {
    if (attachment.encoding === "base64") {
      return Buffer.from(attachment.content, "base64").toString("utf8");
    }
    return attachment.content;
  } catch {
    return null;
  }
}

export function prepareMessageAndAttachments(message: string, raw: unknown): { message: string; attachments?: GatewayAttachment[] } {
  if (!Array.isArray(raw) || raw.length === 0) return { message };

  const gatewayAttachments: GatewayAttachment[] = [];
  const embedded: string[] = [];
  let embeddedChars = 0;
  const imageNames: string[] = [];

  for (const item of raw) {
    const attachment = item as ChatSendAttachment;
    const mimeType = attachment.mimeType ?? "";
    const name = attachment.name ?? "attachment";

    if (mimeType.startsWith("image/") && attachment.content) {
      gatewayAttachments.push({ type: "image", fileName: name, mimeType, content: attachment.content });
      imageNames.push(name);
      continue;
    }

    if (mimeType && isTextAttachment(mimeType)) {
      const decoded = decodeAttachmentText(attachment);
      if (decoded !== null) {
        const remaining = MAX_TOTAL_EMBEDDED_ATTACHMENT_CHARS - embeddedChars;
        const clipped = decoded.slice(0, Math.max(0, Math.min(MAX_EMBEDDED_ATTACHMENT_CHARS, remaining)));
        embeddedChars += clipped.length;
        embedded.push(`<attached-file name="${name}" mime="${mimeType}">\n${clipped}${decoded.length > clipped.length ? "\n[Attachment truncated]" : ""}\n</attached-file>`);
        continue;
      }
    }

    embedded.push(`[Attached file: ${name} (${mimeType || "unknown mime"}, ${attachment.size ?? "unknown"} bytes). This file type is not directly readable by the current gateway.]`);
  }

  if (imageNames.length > 0) {
    embedded.unshift(imageNames.length === 1 ? `[Attached image: ${imageNames[0]}]` : `[Attached images: ${imageNames.join(", ")}]`);
  }

  return {
    message: embedded.length > 0 ? `${message}\n\n${embedded.join("\n\n")}` : message,
    attachments: gatewayAttachments.length > 0 ? gatewayAttachments : undefined,
  };
}
