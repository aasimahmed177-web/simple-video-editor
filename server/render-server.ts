import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
};

/** Serve an isolated render bundle. Bundle public assets must not be symlinked outside it. */
export const startRenderServer = async (
  bundleDir: string,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const root = await realpath(bundleDir);
  let url = "";
  const server = http.createServer((req, res) => {
    void (async () => {
      const respond = (status: number) => {
        res.writeHead(status, { "Content-Length": "0" });
        res.end();
      };
      if (
        req.headers.host !== new URL(url).host ||
        (req.headers.origin && req.headers.origin !== url) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return respond(403);
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        return respond(405);
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
      } catch {
        return respond(400);
      }
      if (
        !pathname.startsWith("/") ||
        /[\\\0]/.test(pathname) ||
        pathname.split("/").some((part) => part === "." || part === "..")
      )
        return respond(400);
      const requested = path.resolve(
        root,
        pathname === "/" ? "index.html" : `.${pathname}`,
      );
      if (!requested.startsWith(`${root}${path.sep}`)) return respond(403);
      let file: string;
      let size: number;
      try {
        file = await realpath(requested);
        if (!file.startsWith(`${root}${path.sep}`)) return respond(403);
        const info = await stat(file);
        if (!info.isFile()) return respond(404);
        size = info.size;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return respond(
          code === "ENOENT" || code === "ENOTDIR" || code === "EACCES"
            ? 404
            : 500,
        );
      }
      let start = 0;
      let end = size - 1;
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const first = match?.[1] ? Number(match[1]) : undefined;
        const last = match?.[2] ? Number(match[2]) : undefined;
        if (
          !match ||
          (first === undefined && last === undefined) ||
          (first !== undefined && !Number.isSafeInteger(first)) ||
          (last !== undefined && !Number.isSafeInteger(last))
        ) {
          res.setHeader("Content-Range", `bytes */${size}`);
          return respond(416);
        }
        if (first === undefined) start = Math.max(0, size - last!);
        else {
          start = first;
          end = Math.min(end, last ?? end);
        }
        if (start > end || start >= size) {
          res.setHeader("Content-Range", `bytes */${size}`);
          return respond(416);
        }
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      }
      res.setHeader(
        "Content-Type",
        mime[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      );
      res.setHeader("Content-Length", size === 0 ? 0 : end - start + 1);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.method === "HEAD" || size === 0) return res.end();
      const stream = createReadStream(file, { start, end });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      if (res.destroyed) stream.destroy();
      else stream.pipe(res);
    })().catch(() => {
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(500, { "Content-Length": "0" });
        res.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("Render server did not bind a TCP port"));
      url = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  let closing: Promise<void> | undefined;
  return {
    url,
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })),
  };
};
