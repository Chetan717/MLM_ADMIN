/* global Buffer, module */

const MAX_NOTIFICATION_IMAGE_BYTES = 1024 * 1024;

function normalizeNotificationImageUrl(value) {
  if (value == null || value === "") return "";

  if (typeof value !== "string" || value.trim().length > 2048) {
    throw new Error("Use a public HTTPS image URL up to 2048 characters.");
  }

  const text = value.trim();
  if (!text) return "";

  let url;

  try {
    url = new URL(text);
  } catch {
    throw new Error("Use a valid public HTTPS image URL.");
  }

  const host = url.hostname.toLowerCase();

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
  ) {
    throw new Error(
      "Use a public HTTPS image URL without credentials or a custom port.",
    );
  }

  url.hash = "";
  return url.href;
}

function buildExpoPushMessage({ token, title, body, url, imageUrl = "" }) {
  return {
    to: token,
    title,
    body,
    data: {
      url,
      ...(imageUrl ? { imageUrl } : {}),
    },
    priority: "high",
    sound: "default",
    channelId: "default",
    ...(imageUrl
      ? {
          richContent: { image: imageUrl },
          mutableContent: true,
        }
      : {}),
  };
}

function notificationPayloadError({ title, body, url, imageUrl = "" }) {
  const message = buildExpoPushMessage({
    token: "ExponentPushToken[00000000-0000-0000-0000-000000000000]",
    title,
    body,
    url,
    imageUrl,
  });

  return Buffer.byteLength(JSON.stringify(message), "utf8") > 4096
    ? "This notification is too large. Shorten the message or image/page links."
    : "";
}

function notificationImageUploadError({
  storagePath,
  fileName,
  contentType,
  size,
}) {
  if (storagePath !== "notifications/media") {
    return "Unsupported notification upload folder.";
  }

  const extensions = {
    "image/jpeg": /\.jpe?g$/i,
    "image/png": /\.png$/i,
  };

  if (!Object.hasOwn(extensions, contentType)) {
    return "Notification images must be JPEG or PNG.";
  }

  if (
    !/^[A-Za-z0-9._-]{1,180}$/.test(fileName) ||
    fileName.includes("..") ||
    !extensions[contentType].test(fileName)
  ) {
    return "Invalid notification image filename.";
  }

  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_NOTIFICATION_IMAGE_BYTES
  ) {
    return "Notification images must be 1 MB or smaller.";
  }

  return "";
}

module.exports = {
  MAX_NOTIFICATION_IMAGE_BYTES,
  normalizeNotificationImageUrl,
  buildExpoPushMessage,
  notificationPayloadError,
  notificationImageUploadError,
};
