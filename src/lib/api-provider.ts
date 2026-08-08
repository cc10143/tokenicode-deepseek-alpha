import { useProviderStore } from '../stores/providerStore';
import { useSettingsStore } from '../stores/settingsStore';
import { PROVIDER_PRESETS } from './provider-presets';
import type { ModelId } from '../stores/settingsStore';
import {
  DEEPSEEK_V4_FLASH,
  DEEPSEEK_V4_PRO,
  normalizeProviderModelName,
  displayProviderModelName,
} from './deepseek-models';

const TIER_MAP: Record<string, 'opus' | 'sonnet' | 'haiku'> = {
  'claude-opus-4-6': 'opus',
  'claude-opus-4-6-1m': 'opus',
  'claude-sonnet-4-6': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
};

/**
 * Robust tier detection for model names that carry version/date suffixes
 * (claude-haiku-4-5 vs claude-haiku-4-5-20251001) or context markers ([1M]),
 * which exact ID matching in TIER_MAP misses. Upstream names (deepseek-v4-pro,
 * deepseek-v4-flash) never contain these tier words, so they are unaffected.
 */
function tierFromModel(model: string): 'opus' | 'sonnet' | 'haiku' | undefined {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return undefined;
}

/**
 * Result of model resolution — either a mapped model name or an error.
 */
export type ModelResolution =
  | { ok: true; model: string }
  | { ok: false; reason: 'no_mapping'; tier: string; providerName: string };

/**
 * Resolve the UI-selected model ID to the provider's actual model name,
 * returning an error if the provider has no mapping for the selected tier.
 */
export function resolveModelOrError(selectedModel: string): ModelResolution {
  const provider = useProviderStore.getState().getActive();
  if (!provider) {
    // Inherit mode: map each Claude model ID to its upstream display name via
    // settings.json _MODEL_NAME. The tier the user picks drives both the display
    // and the --model value passed to the CLI (resolveModelForSend).
    const mappings = useSettingsStore.getState().modelMappings;
    if (mappings) {
      const tier = TIER_MAP[selectedModel];
      const display = tier ? mappings[tier]?.display : undefined;
      if (display) return { ok: true, model: display };
    }
    // Fallback: before mappings load, show the selected model as-is
    return { ok: true, model: selectedModel };
  }

  // 1. Check direct model ID mapping first (e.g. 'claude-opus-4-6-1m' → 'glm-5-1m')
  const directMapping = provider.modelMappings.find(
    (m) => m.tier === selectedModel && m.providerModel,
  );
  if (directMapping?.providerModel) {
    return { ok: true, model: normalizeProviderModelName(directMapping.providerModel) };
  }

  // 2. Fall back to tier mapping
  const tier = TIER_MAP[selectedModel];
  if (!tier) {
    const fallback = provider.modelMappings.find(
      (m) => m.tier === 'sonnet' && m.providerModel,
    ) || provider.modelMappings.find(
      (m) => m.tier === 'haiku' && m.providerModel,
    ) || provider.modelMappings.find(
      (m) => m.tier === 'opus' && m.providerModel,
    ) || provider.modelMappings.find((m) => m.providerModel);

    if (fallback?.providerModel) {
      return { ok: true, model: normalizeProviderModelName(fallback.providerModel) };
    }

    return { ok: false, reason: 'no_mapping', tier: selectedModel, providerName: provider.name };
  }

  const mapping = provider.modelMappings.find(
    (m) => m.tier === tier && m.providerModel,
  );
  if (!mapping?.providerModel) {
    return { ok: false, reason: 'no_mapping', tier, providerName: provider.name };
  }
  return { ok: true, model: normalizeProviderModelName(mapping.providerModel) };
}

/**
 * Resolve the UI-selected model ID to the provider's actual model name.
 * When a provider is active, looks up the model mapping for the selected tier.
 * Returns the original model ID if no mapping is configured (silent fallback).
 */
/** Map internal model IDs to CLI-expected format */
const CLI_MODEL_MAP: Partial<Record<ModelId, string>> = {
  'claude-opus-4-6-1m': 'claude-opus-4-6[1m]',
};

export function resolveModelForProvider(selectedModel: string): string {
  const r = resolveModelOrError(selectedModel);
  const model = r.ok ? r.model : selectedModel;
  return CLI_MODEL_MAP[model as ModelId] ?? model;
}

/**
 * Model name to pass to the CLI via --model.
 * In inherit mode returns the settings.json _MODEL value for the selected tier
 * (e.g. claude-sonnet-4-6[1M]) so the GUI model selector actually takes effect —
 * CC-Switch's substring tier routing uses it to pick the upstream model. Returns
 * undefined when the tier has no _MODEL mapping, letting the CLI use its own default.
 */
export function resolveModelForSend(selectedModel: string): string | undefined {
  const provider = useProviderStore.getState().getActive();
  if (provider) return resolveModelForProvider(selectedModel);
  const mappings = useSettingsStore.getState().modelMappings;
  const tier = TIER_MAP[selectedModel];
  if (mappings && tier && mappings[tier]?.pass) return mappings[tier]!.pass!;
  return undefined;
}

/**
 * Map a raw model ID (from CLI stream, sessionMeta, or selectedModel) to a
 * human-readable display name. In inherit mode, resolves through settings.json
 * model_name mappings (e.g. claude-sonnet-4-6 → deepseek-v4-pro).
 * Falls back to displayProviderModelName when no mapping is available.
 */
export function resolveModelDisplay(rawModel: string | undefined | null): string {
  if (!rawModel) return '';
  if (useProviderStore.getState().getActive()) {
    return displayProviderModelName(rawModel);
  }
  const mappings = useSettingsStore.getState().modelMappings;
  if (mappings) {
    const cleaned = rawModel.replace(/\s*\[1m\]\s*$/i, '').trim();
    const tier = tierFromModel(cleaned);
    const display = tier ? mappings[tier]?.display : undefined;
    if (display) return display;
  }
  return displayProviderModelName(rawModel);
}

export function supportsDeepSeekThinking(model: string): boolean {
  const normalized = normalizeProviderModelName(model);
  return normalized === DEEPSEEK_V4_PRO || normalized === DEEPSEEK_V4_FLASH;
}

export function resolveThinkingLevelForProvider(_selectedModel: string, requestedLevel: string): string {
  if (requestedLevel === 'off') return 'off';
  const provider = useProviderStore.getState().getActive();
  if (!provider) return requestedLevel;
  const support = PROVIDER_PRESETS.find((preset) => preset.id === provider.preset)?.thinkingSupport;
  return support === 'ignored' ? 'off' : requestedLevel;
}

/**
 * Stable fingerprint of the current API provider config.
 * Any provider config change invalidates the pre-warmed session.
 */
export function envFingerprint(): string {
  const { activeProviderId, providers } = useProviderStore.getState();
  const provider = providers.find((p) => p.id === activeProviderId);
  return JSON.stringify({
    activeProviderId,
    updatedAt: provider?.updatedAt ?? 0,
  });
}
