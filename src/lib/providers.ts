// Провайдеры ИИ. Groq — быстрый, но в РФ требует VPN.
// OpenRouter — работает в России без VPN и раздаёт бесплатные модели (суффикс :free).

import type { AppConfig, Provider } from '../types'

export interface ProviderInfo {
  id: Provider
  name: string
  base: string // OpenAI-совместимый базовый URL (…/chat/completions, …/models)
  keysUrl: string // где взять ключ
  keyPrefix: string // как обычно начинается ключ (для подсказки)
  hint: string
  defaultModel: string // запасная модель, если автоподбор не сработал
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  groq: {
    id: 'groq',
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keysUrl: 'https://console.groq.com/keys',
    keyPrefix: 'gsk_',
    hint: 'очень быстрый; из России нужен VPN',
    defaultModel: 'qwen/qwen3-32b',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keysUrl: 'https://openrouter.ai/settings/keys',
    keyPrefix: 'sk-or-',
    hint: 'работает в России без VPN; есть бесплатные модели',
    defaultModel: 'openai/gpt-oss-120b:free',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    keysUrl: 'https://cloud.cerebras.ai',
    keyPrefix: 'csk-',
    hint: 'сверхбыстрый; щедрый бесплатный лимит',
    defaultModel: 'gpt-oss-120b',
  },
}

export function providerOf(cfg: AppConfig): ProviderInfo {
  return PROVIDERS[cfg.provider && PROVIDERS[cfg.provider] ? cfg.provider : 'groq']
}

/** Активный ключ под выбранного провайдера. */
export function activeKey(cfg: AppConfig): string {
  if (cfg.provider === 'openrouter') return cfg.apiKeyOr || ''
  if (cfg.provider === 'cerebras') return cfg.apiKeyCb || ''
  return cfg.apiKey
}
