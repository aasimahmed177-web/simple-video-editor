import type { Media } from "./model";

export const MAX_UPLOAD_BYTES = 5_000_000_000;
export const MAX_UPLOAD_LABEL = "5 GB";

// Send the disk-backed File directly; never convert large footage to base64 or
// an ArrayBuffer. XHR exposes byte progress, unlike browser fetch uploads.
export const uploadMedia = (
  file: File,
  onProgress: (fraction: number) => void,
): Promise<Media> =>
  new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error(`${file.name} is over the ${MAX_UPLOAD_LABEL} limit`));
      return;
    }
    const request = new XMLHttpRequest();
    request.open("POST", "/api/ads/upload");
    request.responseType = "json";
    request.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300)
        resolve(request.response as Media);
      else
        reject(
          new Error(
            request.response?.error ?? `Import failed (${request.status}).`,
          ),
        );
    };
    request.onerror = () =>
      reject(
        new Error(
          "Import interrupted. Check that the local studio is running and there is enough free disk space, then try again.",
        ),
      );
    request.onabort = () => reject(new Error("Import cancelled."));
    request.send(file);
  });
