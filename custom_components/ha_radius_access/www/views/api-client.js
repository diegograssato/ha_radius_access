export async function apiCall(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  let requestPath = path;
  if (method === "GET") {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("_ts", String(Date.now()));
    requestPath = `${url.pathname}?${url.searchParams.toString()}`;
  }

  const response = await fetch(requestPath, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });

  const payload = await response.json().catch(() => ({ ok: false, error: "Invalid JSON response" }));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload.data;
}

export function bytesToHuman(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(2)} ${units[idx]}`;
}
