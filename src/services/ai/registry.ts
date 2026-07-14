/**
 * ai/registry — the nine supported direct-AI providers, indexed by id.
 *
 * The default baseUrl and model are surfaced verbatim in the settings UI
 * when the user picks a new provider, so a one-click swap gets them
 * something reasonable. Override the fields to point at a proxy, an
 * alternate region, or a newer model.
 *
 * Provider groups:
 *  - `anthropic`, `minimax` use the Anthropic Messages shape (shared helpers).
 *  - `openai`, `deepseek`, `moonshot`, `zhipu`, `bailian`, `volcengine` use
 *    OpenAI Chat Completions (shared helpers).
 *  - `gemini` is the odd one out (its own helpers).
 */

import { anthropicHelpers } from "./anthropic";
import { openaiCompatHelpers } from "./openaiCompat";
import { geminiHelpers } from "./gemini";
import type { AiProviderId, AiProviderSpec } from "./types";

export const AI_PROVIDERS: Record<AiProviderId, AiProviderSpec> = {
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic (Claude)",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    modelPlaceholder: "claude-sonnet-4-5",
    ...anthropicHelpers,
  },
  openai: {
    id: "openai",
    displayName: "OpenAI (GPT)",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    modelPlaceholder: "gpt-4o-mini",
    ...openaiCompatHelpers,
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    modelPlaceholder: "gemini-2.0-flash",
    ...geminiHelpers,
  },
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    modelPlaceholder: "deepseek-chat",
    ...openaiCompatHelpers,
  },
  moonshot: {
    id: "moonshot",
    displayName: "Moonshot (Kimi)",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    modelPlaceholder: "moonshot-v1-8k",
    ...openaiCompatHelpers,
  },
  zhipu: {
    id: "zhipu",
    displayName: "Zhipu (GLM)",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    modelPlaceholder: "glm-4-flash",
    ...openaiCompatHelpers,
  },
  bailian: {
    id: "bailian",
    displayName: "Alibaba Bailian (Qwen)",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    modelPlaceholder: "qwen-plus",
    ...openaiCompatHelpers,
  },
  volcengine: {
    id: "volcengine",
    displayName: "Volcengine (Doubao)",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1-5-pro-32k-250115",
    modelPlaceholder: "doubao-1-5-pro-32k-250115",
    ...openaiCompatHelpers,
  },
  minimax: {
    id: "minimax",
    displayName: "MiniMax",
    defaultBaseUrl: "https://api.minimaxi.com/anthropic",
    defaultModel: "MiniMax-M3",
    modelPlaceholder: "MiniMax-M3",
    ...anthropicHelpers,
  },
};

export function getProviderSpec(id: AiProviderId): AiProviderSpec {
  return AI_PROVIDERS[id];
}
