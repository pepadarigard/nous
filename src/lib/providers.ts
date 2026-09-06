// Провайдеры ИИ. Все — OpenAI-совместимые (chat/completions + Bearer-ключ).
// Кроме Groq, все работают из России без VPN.

import type { AppConfig, Provider } from '../types'

export interface ProviderInfo {
  id: Provider
  name: string
  base: string // OpenAI-совместимый базовый URL (…/chat/completions, …/models)
  keysUrl: string // где взять ключ
  keyPrefix: string // как обычно начинается ключ (для подсказки; пусто = любой)
  hint: string
  defaultModel: string // запасная модель, если автоподбор не сработал
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  ollama: {
    id: 'ollama',
    name: 'Ollama (локально)',
    base: 'http://localhost:11434/v1',
    keysUrl: 'https://ollama.com/download',
    keyPrefix: '',
    hint: 'модель работает на твоём компьютере — без ключа, без интернета и без лимитов',
    defaultModel: 'llama3.1:8b',
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (локально)',
    base: 'http://localhost:1234/v1',
    keysUrl: 'https://lmstudio.ai',
    keyPrefix: '',
    hint: 'локальный сервер LM Studio; включи в нём Local Server',
    defaultModel: 'local-model',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keysUrl: 'https://openrouter.ai/settings/keys',
    keyPrefix: 'sk-or-',
    hint: 'работает в России без VPN; бесплатные модели',
    defaultModel: 'openai/gpt-oss-120b:free',
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    base: 'https://api.siliconflow.com/v1',
    keysUrl: 'https://cloud.siliconflow.com',
    keyPrefix: 'sk-',
    hint: 'DeepSeek, Qwen, GLM, Kimi; кредиты новым аккаунтам',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
  },
  zhipu: {
    id: 'zhipu',
    name: 'Z.ai (GLM)',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    keysUrl: 'https://open.bigmodel.cn',
    keyPrefix: '',
    hint: 'GLM-4; есть полностью бесплатная glm-4-flash',
    defaultModel: 'glm-4-flash',
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
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    base: 'https://integrate.api.nvidia.com/v1',
    keysUrl: 'https://build.nvidia.com',
    keyPrefix: 'nvapi-',
    hint: 'щедрые бесплатные кредиты; Llama, DeepSeek, Nemotron',
    defaultModel: 'meta/llama-3.3-70b-instruct',
  },
  deepinfra: {
    id: 'deepinfra',
    name: 'DeepInfra',
    base: 'https://api.deepinfra.com/v1/openai',
    keysUrl: 'https://deepinfra.com/dash/api_keys',
    keyPrefix: '',
    hint: 'Llama, DeepSeek, Qwen; старт без карты',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
  },
  novita: {
    id: 'novita',
    name: 'Novita',
    base: 'https://api.novita.ai/v3/openai',
    keysUrl: 'https://novita.ai/settings/key-management',
    keyPrefix: '',
    hint: 'DeepSeek, Llama, Qwen; бесплатные кредиты',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
  },
  github: {
    id: 'github',
    name: 'GitHub Models',
    base: 'https://models.github.ai/inference',
    keysUrl: 'https://github.com/settings/tokens',
    keyPrefix: 'github_pat_',
    hint: 'нужен аккаунт GitHub (токен с правом models:read)',
    defaultModel: 'openai/gpt-4o-mini',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keysUrl: 'https://console.groq.com/keys',
    keyPrefix: 'gsk_',
    hint: 'очень быстрый; из России нужен VPN',
    defaultModel: 'qwen/qwen3-32b',
  },
}

/** Порядок показа в интерфейсе (лучшие для России — первыми). */
export const PROVIDER_ORDER: Provider[] = ['openrouter', 'ollama', 'lmstudio', 'siliconflow', 'zhipu', 'cerebras', 'nvidia', 'deepinfra', 'novita', 'github', 'groq']

/** Локальные провайдеры: работают без ключа и без интернета. */
export const LOCAL_PROVIDERS: Provider[] = ['ollama', 'lmstudio']

export function isLocal(p?: string): boolean {
  return LOCAL_PROVIDERS.includes(normProvider(p))
}

/** Готов ли ИИ к работе: локальной модели ключ не нужен. */
export function aiReady(cfg: AppConfig): boolean {
  return isLocal(cfg.provider) || !!activeKey(cfg)
}

/** В онбординге показываем только топ — остальные доступны в Настройках. */
export const ONBOARDING_PROVIDERS: Provider[] = ['openrouter', 'ollama', 'siliconflow', 'zhipu']

// Запасные бесплатные модели OpenRouter: если выбранная перегружена (429 upstream),
// OpenRouter сам переключится (поле `models`, МАКСИМУМ 3 элемента!).
export const OR_FALLBACK_MODELS = [
  'openai/gpt-oss-120b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
]

/** Списка моделей у GitHub Models через /models нет — известный набор. */
export const GITHUB_MODELS = ['openai/gpt-4o', 'openai/gpt-4o-mini', 'deepseek/DeepSeek-V3', 'meta/Llama-3.3-70B-Instruct']

/** Старые/неизвестные значения провайдера из конфига приводим к валидному. */
export function normProvider(p?: string): Provider {
  return p && (PROVIDERS as Record<string, ProviderInfo>)[p] ? (p as Provider) : 'openrouter'
}

export function providerOf(cfg: AppConfig): ProviderInfo {
  return PROVIDERS[normProvider(cfg.provider)]
}

/** Активный ключ под выбранного провайдера. Локальным моделям ключ не нужен. */
export function activeKey(cfg: AppConfig): string {
  const p = normProvider(cfg.provider)
  if (LOCAL_PROVIDERS.includes(p)) return 'local'
  if (p === 'groq') return cfg.apiKey
  if (p === 'openrouter') return cfg.apiKeyOr || ''
  if (p === 'cerebras') return cfg.apiKeyCb || ''
  return cfg.extraKeys?.[p] || ''
}

/** Ключ конкретного провайдера (для форм настроек). */
export function keyOf(cfg: AppConfig, p: Provider): string {
  if (p === 'groq') return cfg.apiKey
  if (p === 'openrouter') return cfg.apiKeyOr || ''
  if (p === 'cerebras') return cfg.apiKeyCb || ''
  return cfg.extraKeys?.[p] || ''
}

/** Патч конфига для сохранения ключа провайдера. */
export function keyPatch(cfg: AppConfig, p: Provider, v: string): Partial<AppConfig> {
  if (p === 'groq') return { apiKey: v }
  if (p === 'openrouter') return { apiKeyOr: v }
  if (p === 'cerebras') return { apiKeyCb: v }
  return { extraKeys: { ...(cfg.extraKeys || {}), [p]: v } }
}
