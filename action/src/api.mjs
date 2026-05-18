export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  constructor(message, reset) {
    super(message);
    this.name = "RateLimitError";
    this.reset = reset;
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function analyze(payload, apiKey, apiUrl) {
  if (!apiUrl.startsWith("https://")) {
    throw new Error("API URL must use HTTPS to protect API key in transit.");
  }

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "reflect-ci/1.0",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  try {
    const res = await fetch(`${apiUrl}/v1/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body.error?.message || `HTTP ${res.status}`;

      if (res.status === 401 || res.status === 403) {
        throw new AuthError(msg);
      }
      if (res.status === 429) {
        throw new RateLimitError(msg, body.error?.reset);
      }
      throw new ApiError(res.status, msg);
    }

    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ApiError(504, "Analysis timed out after 5 minutes.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
