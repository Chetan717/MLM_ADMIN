import { useRef, useState } from "react";
import { uploadTemplateAssetToR2 } from "../../Utils/r2Upload";
import {
  normalizeNotificationImageUrl,
  prepareNotificationImage,
} from "./notificationImage";

export default function NotificationImageInput({
  value,
  onChange,
  disabled = false,
  onBusyChange,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  const locked = busy || disabled;

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || locked) return;

    setBusy(true);
    setError("");
    setProgress(null);
    onBusyChange?.(true);

    try {
      const blob = await prepareNotificationImage(file);

      const fileName = `notification-${Date.now()}-${crypto.randomUUID()}.jpg`;

      const imageUrl = await uploadTemplateAssetToR2({
        blob,
        storagePath: "notifications/media",
        fileName,
        contentType: "image/jpeg",
        onProgress: setProgress,
      });

      onChange(normalizeNotificationImageUrl(imageUrl));
    } catch (failure) {
      setError(failure?.message || "Image upload failed. Please retry.");
    } finally {
      setBusy(false);
      setProgress(null);
      onBusyChange?.(false);
    }
  };

  let previewUrl = "";

  try {
    previewUrl = normalizeNotificationImageUrl(value);
  } catch {
    previewUrl = "";
  }

  return (
    <div className="space-y-2 rounded-xl border border-dashed p-3 dark:border-gray-700">
      <label
        className="block text-sm font-semibold"
        htmlFor="notification-image-url"
      >
        Image (optional)
      </label>

      <input
        id="notification-image-url"
        type="url"
        value={value}
        maxLength={2048}
        disabled={locked}
        placeholder="https://cdn.example.com/notification.jpg"
        onChange={(event) => {
          setError("");
          onChange(event.target.value);
        }}
        className="w-full rounded-xl border p-3 text-sm dark:border-gray-700 dark:bg-gray-950"
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={locked}
        onChange={upload}
        className="hidden"
        aria-label="Choose notification image"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={locked}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-violet-100 px-3 py-2 text-sm font-semibold text-violet-700 disabled:opacity-50 dark:bg-violet-950/40 dark:text-violet-300"
        >
          {busy
            ? progress == null
              ? "Preparing image…"
              : `Uploading ${progress}%`
            : "Upload image"}
        </button>

        {value && (
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              setError("");
              onChange("");
            }}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
          >
            Remove image
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Uploads become JPEG, up to 1600 px and 1 MB. Pasted URLs must be
        publicly accessible JPEG/PNG images of 1 MB or less. Leave empty for
        text only.
      </p>

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Notification preview"
          className="max-h-56 w-full rounded-xl bg-gray-100 object-contain dark:bg-gray-950"
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
