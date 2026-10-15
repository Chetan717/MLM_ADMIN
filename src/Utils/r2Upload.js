import { httpsCallable } from "firebase/functions";
import { functions } from "../../Firebase";

const createTemplateUpload = httpsCallable(functions, "panelCreateR2AdminMediaUpload");

function uploadWithProgress({ uploadUrl, blob, contentType, cacheControl, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("Cache-Control", cacheControl);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("R2 upload failed. Check network/CORS and try again."));
    xhr.onabort = () => reject(new Error("R2 upload was cancelled."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 upload failed (${xhr.status}).`));
    };
    xhr.send(blob);
  });
}

export async function uploadTemplateAssetToR2({
  blob,
  storagePath,
  fileName,
  contentType,
  onProgress,
}) {
  if (!blob) throw new Error("Missing upload file.");
  if (!storagePath) throw new Error("Missing R2 storage path.");

  const cacheControl = "public,max-age=31536000,immutable";
  const normalizedContentType = String(contentType || "application/octet-stream").trim().toLowerCase();
  const result = await createTemplateUpload({
    storagePath,
    fileName,
    contentType: normalizedContentType,
    size: Number(blob.size || 0),
    cacheControl,
  });

  const uploadUrl = result?.data?.uploadUrl;
  const publicUrl = result?.data?.publicUrl;
  if (!uploadUrl || !publicUrl) {
    throw new Error("R2 upload service returned an invalid response.");
  }

  await uploadWithProgress({
    uploadUrl,
    blob,
    contentType: normalizedContentType,
    cacheControl,
    onProgress,
  });

  return publicUrl;
}
