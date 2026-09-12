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
  /**
   * ModelScope — лучший вариант из проверенных на российском интернете.
   *
   * ВАЖНО про адрес: у сервиса два домена, и работает НЕ тот, что в их
   * документации. api-inference.modelscope.cn отвечает «Authentication
   * failed» на верный токен, а api-inference.modelscope.ai с тем же токеном
   * отвечает 200. Проверено перебором.
   *
   * Что там есть: Qwen3-VL-235B (умная И со зрением — решает задачи ЕГЭ,
   * держит строгий JSON, читает фото листа) и DeepSeek-V4-Pro. Бесплатная
   * квота — около двух тысяч вызовов в день.
   */
  modelscope: {
    id: 'modelscope',
    name: 'ModelScope',
    base: 'https://api-inference.modelscope.ai/v1',
    keysUrl: 'https://modelscope.cn/my/myaccesstoken',
    keyPrefix: 'ms-',
    hint: 'работает из России; Qwen3-VL-235B — умная и со зрением; ~2000 вызовов в день бесплатно',
    defaultModel: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
  },
  /**
   * Cloud.ru — российское облако, и самый удобный способ добраться до
   * GigaChat.
   *
   * У самого GigaChat два препятствия: он требует корневой сертификат
   * Минцифры (в обычной Windows его нет) и авторизацию через OAuth с
   * обменом ключа на получасовой токен. Cloud.ru отдаёт те же модели
   * GigaChat по обычному ключу и обычному OpenAI-совместимому адресу.
   *
   * Плюс к ним там Qwen3-VL-235B — та самая, что у нас прошла все проверки,
   * — и ретранслированные модели OpenAI. Адрес доходит из России напрямую.
   */
  cloudru: {
    id: 'cloudru',
    name: 'Cloud.ru',
    base: 'https://foundation-models.api.cloud.ru/v1',
    keysUrl: 'https://console.cloud.ru',
    keyPrefix: '',
    hint: 'российское облако: GigaChat, Qwen3-VL со зрением, модели OpenAI. Работает из России напрямую',
    defaultModel: 'qwen/qwen3-vl-235b-a22b-instruct',
  },
  /**
   * VseGPT — российский агрегатор: один ключ, 463 модели, включая GPT, Claude
   * и Gemini. Платный, но доступен из России напрямую и без VPN — то есть
   * решает ровно ту задачу, ради которой иначе нужен VPN.
   */
  vsegpt: {
    id: 'vsegpt',
    name: 'VseGPT',
    base: 'https://api.vsegpt.ru/v1',
    keysUrl: 'https://vsegpt.ru',
    keyPrefix: 'sk-',
    hint: 'российский агрегатор: 463 модели, включая GPT и Claude. Платный, но работает без VPN',
    defaultModel: 'openai/gpt-4o-mini',
  },
  /**
   * ProxyAPI — российский ретранслятор к OpenAI и Anthropic. Тоже платный,
   * тоже доступен напрямую.
   */
  proxyapi: {
    id: 'proxyapi',
    name: 'ProxyAPI',
    base: 'https://api.proxyapi.ru/openai/v1',
    keysUrl: 'https://proxyapi.ru',
    keyPrefix: 'sk-',
    hint: 'российский ретранслятор OpenAI и Anthropic; платный, работает без VPN',
    defaultModel: 'gpt-4o-mini',
  },
  /**
   * Google Gemini. Зрение есть, бесплатный лимит самый щедрый из найденных.
   *
   * НО из России он не работает, и вот в чём была моя ошибка: адрес отвечает,
   * запрос без ключа возвращает «передайте верный ключ» — и я счёл это
   * доступностью. Это неверно: Google проверяет страну не на этом шаге, а
   * когда ключ настоящий, и тогда отвечает отказом по региону. Ученик
   * проверил на живом аккаунте — не работает. Оставляем в списке для тех, у
   * кого есть VPN: с галочкой «ходить через VPN» сервис оживает.
   */
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keysUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AIza',
    hint: 'из России НЕ работает: Google отказывает по региону. С VPN — щедрый лимит и зрение',
    defaultModel: 'gemini-2.5-flash',
  },
  /**
   * Hugging Face: один ключ — доступ к чужим серверам сразу нескольких
   * поставщиков. В списке есть и Qwen3-VL-235B, и Llama 4 — то есть зрение
   * и ум. Бесплатная квота помесячная.
   */
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    base: 'https://router.huggingface.co/v1',
    keysUrl: 'https://huggingface.co/settings/tokens',
    keyPrefix: 'hf_',
    hint: 'адрес доходит из России; больше сотни моделей, включая Qwen3-VL и Llama 4. Работу с ключом не проверяли',
    defaultModel: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    base: 'https://api.together.xyz/v1',
    keysUrl: 'https://api.together.ai/settings/api-keys',
    keyPrefix: '',
    hint: 'адрес доходит из России; есть бесплатные модели со зрением. Работу с ключом не проверяли',
    defaultModel: 'meta-llama/Llama-Vision-Free',
  },
  dashscope: {
    id: 'dashscope',
    name: 'Qwen (DashScope)',
    base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keysUrl: 'https://modelstudio.console.alibabacloud.com',
    keyPrefix: 'sk-',
    hint: 'адрес доходит из России; Qwen от разработчиков, есть qwen-vl. Работу с ключом не проверяли',
    defaultModel: 'qwen-vl-plus',
  },
  sambanova: {
    id: 'sambanova',
    name: 'SambaNova',
    base: 'https://api.sambanova.ai/v1',
    keysUrl: 'https://cloud.sambanova.ai/apis',
    keyPrefix: '',
    hint: 'адрес доходит из России; быстрый, DeepSeek и Llama. Работу с ключом не проверяли',
    defaultModel: 'DeepSeek-V3.1',
  },
  /**
   * Mistral — запасной, тоже доходит из России. На бесплатном тарифе доступны
   * только небольшие модели (ministral 8B/14B, pixtral-12b): зрение есть,
   * но задачи ЕГЭ они решают плохо. Годится как подстраховка, не как основной.
   */
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    base: 'https://api.mistral.ai/v1',
    keysUrl: 'https://console.mistral.ai/api-keys',
    keyPrefix: '',
    hint: 'работает из России; на бесплатном тарифе модели небольшие',
    defaultModel: 'ministral-14b-latest',
  },
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
    // Проверено запросом с российского адреса: сервис отвечает 403 «Access
    // denied by security policy» независимо от заголовков. Это блокировка по
    // адресу, ключ тут ни при чём — и обойти её со стороны приложения нельзя.
    hint: 'из России НЕ работает: 403 по адресу. С включённой галочкой «через VPN» — работает',
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
    hint: 'из России НЕ работает: Cloudflare. С включённой галочкой «через VPN» — работает',
    defaultModel: 'gpt-oss-120b',
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    base: 'https://integrate.api.nvidia.com/v1',
    keysUrl: 'https://build.nvidia.com',
    keyPrefix: 'nvapi-',
    hint: 'из России НЕ работает: отвечает 451. Нужен VPN',
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
    hint: 'из России НЕ работает: запрос уходит в никуда. Нужен VPN',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
  },
  github: {
    id: 'github',
    name: 'GitHub Models',
    base: 'https://models.github.ai/inference',
    keysUrl: 'https://github.com/settings/tokens',
    keyPrefix: 'github_pat_',
    hint: 'сервис закрывается — отвечает «github models retirement»',
    defaultModel: 'openai/gpt-4o-mini',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keysUrl: 'https://console.groq.com/keys',
    keyPrefix: 'gsk_',
    hint: 'из России НЕ работает: 403. С включённой галочкой «через VPN» — работает',
    defaultModel: 'qwen/qwen3-32b',
  },
}

/** Порядок показа в интерфейсе (лучшие для России — первыми). */
// Порядок проверен живыми запросами с российского адреса: сначала то, что
// реально доходит, в конце — заблокированное по стране.
export const PROVIDER_ORDER: Provider[] = ['modelscope', 'cloudru', 'huggingface', 'together', 'dashscope', 'sambanova', 'mistral', 'ollama', 'lmstudio', 'siliconflow', 'zhipu', 'deepinfra', 'vsegpt', 'proxyapi', 'gemini', 'openrouter', 'cerebras', 'groq', 'nvidia', 'novita', 'github']

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

/**
 * Старые/неизвестные значения провайдера из конфига приводим к валидному.
 *
 * По умолчанию ModelScope, а не OpenRouter, как было раньше: проверка живыми
 * запросами показала, что OpenRouter отвечает российским адресам 403. Ставить
 * по умолчанию то, что заведомо не работает, — значит встречать нового
 * ученика неработающим ИИ. Тех, кто выбрал провайдера сам, это не трогает: у
 * них значение в конфиге записано явно.
 */
export function normProvider(p?: string): Provider {
  return p && (PROVIDERS as Record<string, ProviderInfo>)[p] ? (p as Provider) : 'modelscope'
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
