/**
 * ai/client — provider-agnostic transport used by DirectAiClient.
 *
 * The `AiClient` picks a spec from the registry and delegates the three
 * cross-provider concerns to it: how to build the request, how to pull text
 * out of a 2xx response, and how to surface an error message. Everything
 * else (timeout, AbortController, JSON parsing, error wrapping via
 * `CloakfetchError`) lives here so each spec stays small.
 */

import { CloakfetchError } from "../CloakfetchClient";
import { getProviderSpec } from "./registry";
import type { AiCallArgs, AiProviderId, AiProviderSpec } from "./types";

export interface AiClientConfig {
  provider: AiProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class AiClient {
  private readonly config: Required<Pick<AiClientConfig, "timeoutMs">> & AiClientConfig;

  constructor(config: AiClientConfig) {
    this.config = { timeoutMs: DEFAULT_TIMEOUT_MS, ...config };
  }

  get provider(): AiProviderSpec {
    return getProviderSpec(this.config.provider);
  }

  get model(): string {
    return this.config.model;
  }

  get providerId(): AiProviderId {
    return this.config.provider;
  }

  /**
   * Lightweight health check. Sends a 1-token ping against the configured
   * endpoint and returns true on any 2xx — we don't care about the response
   * body shape here, only that the provider accepted the request.
   */
  async ping(): Promise<boolean> {
    if (!this.config.apiKey.trim()) return false;
    const spec = this.provider;
    const args: AiCallArgs = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      system: "ping",
      user: "ping",
      maxTokens: 1,
    };
    const { url, headers, body } = spec.buildRequest(args);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      return res.ok;
    } catch (_err) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send `system` + `user` to the configured provider and return the
   * assistant text. Throws `CloakfetchError` on any failure (network,
   * timeout, non-2xx, empty body, JSON parse).
   */
  async call(system: string, user: string, maxTokens: number, timeoutMs?: number): Promise<string> {
    const spec = this.provider;
    const args: AiCallArgs = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      system,
      user,
      maxTokens,
    };
    const { url, headers, body } = spec.buildRequest(args);
    if (!this.config.apiKey.trim()) {
      throw new CloakfetchError("Direct AI is not configured (apiKey is empty)", {
        status: 0,
        body: "",
        endpoint: url,
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.config.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch (_err) {
          // Non-JSON error body — fall back to the HTTP status.
        }
        const message = spec.parseError(parsed, `HTTP ${res.status}`);
        throw new CloakfetchError(message, {
          status: res.status,
          body: text.slice(0, 1000),
          endpoint: url,
        });
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (_err) {
        throw new CloakfetchError("Invalid JSON from AI provider", {
          status: res.status,
          body: text.slice(0, 1000),
          endpoint: url,
        });
      }
      const out = spec.parseResponse(json);
      if (!out) {
        throw new CloakfetchError("AI provider returned no text content", {
          status: res.status,
          body: text.slice(0, 1000),
          endpoint: url,
        });
      }
      return out;
    } catch (err) {
      if (err instanceof CloakfetchError) throw err;
      const effectiveTimeout = timeoutMs ?? this.config.timeoutMs;
      if ((err as { name?: string })?.name === "AbortError") {
        throw new CloakfetchError(`Direct AI request timed out after ${effectiveTimeout}ms`, {
          status: 0,
          body: "",
          endpoint: url,
        });
      }
      throw new CloakfetchError(`Direct AI request failed: ${(err as Error).message ?? String(err)}`, {
        status: 0,
        body: "",
        endpoint: url,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
