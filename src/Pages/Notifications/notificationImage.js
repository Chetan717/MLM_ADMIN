export const MAX_NOTIFICATION_IMAGE_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export function normalizeNotificationImageUrl(value) {
  if (value == null || value === "") return "";

  if (typeof value !== "string") {
    throw new Error("Use a valid public HTTPS image URL.");
  }

  const text = value.trim();
  if (!text) return "";

  if (text.length > 2048) {
    throw new Error("Use an image URL up to 2048 characters.");
  }

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

export async function prepareNotificationImage(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG or WebP photo.");
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose a photo smaller than 20 MB.");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();

      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error("This photo could not be opened."));

      element.src = objectUrl;
    });

    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("This photo has no image dimensions.");
    }

    let maxSide = 1600;

    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(
        1,
        maxSide / Math.max(image.naturalWidth, image.naturalHeight),
      );

      const canvas = document.createElement("canvas");

      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));

      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Image conversion is unavailable in this browser.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.86 - attempt * 0.07);
      });

      if (
        blob?.type === "image/jpeg" &&
        blob.size > 0 &&
        blob.size <= MAX_NOTIFICATION_IMAGE_BYTES
      ) {
        return blob;
      }

      maxSide = Math.floor(maxSide * 0.8);
    }

    throw new Error(
      "Could not reduce this photo below 1 MB. Choose a smaller photo.",
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
