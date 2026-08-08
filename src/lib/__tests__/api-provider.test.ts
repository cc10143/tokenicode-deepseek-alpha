import { beforeEach, describe, expect, it } from 'vitest';
import {
  resolveModelDisplay,
  resolveModelForProvider,
  resolveModelForSend,
  resolveThinkingLevelForProvider,
} from '../api-provider';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';

describe('provider model resolution', () => {
  beforeEach(() => {
    useProviderStore.setState({ providers: [], activeProviderId: null, loaded: true });
    useSettingsStore.setState({ inheritedModel: null, modelMappings: null, inheritedActiveTier: null });
  });

  it('keeps the selected Claude model when no custom provider is active', () => {
    expect(resolveModelForProvider('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(resolveModelForProvider('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('maps each GUI model to its upstream name in inherit mode', () => {
    useSettingsStore.setState({
      modelMappings: {
        opus: { display: 'minimax-m2.5', pass: 'claude-opus-4-8[1M]' },
        sonnet: { display: 'deepseek-v4-pro', pass: 'claude-sonnet-4-6[1M]' },
        haiku: { display: 'deepseek-v4-flash', pass: 'claude-haiku-4-5' },
      },
    });
    expect(resolveModelForProvider('claude-sonnet-4-6')).toBe('deepseek-v4-pro');
    expect(resolveModelForProvider('claude-opus-4-6')).toBe('minimax-m2.5');
  });

  it('passes the settings.json _MODEL value in inherit mode so the GUI selection takes effect', () => {
    useSettingsStore.setState({
      modelMappings: {
        opus: { display: 'minimax-m2.5', pass: 'claude-opus-4-8[1M]' },
        sonnet: { display: 'deepseek-v4-pro', pass: 'claude-sonnet-4-6[1M]' },
        haiku: { display: 'deepseek-v4-flash', pass: 'claude-haiku-4-5' },
      },
    });
    expect(resolveModelForSend('claude-sonnet-4-6')).toBe('claude-sonnet-4-6[1M]');
    expect(resolveModelForSend('claude-opus-4-6')).toBe('claude-opus-4-8[1M]');
    expect(resolveModelForSend('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
  });

  it('returns undefined in inherit mode when a tier has no _MODEL mapping', () => {
    useSettingsStore.setState({ modelMappings: { sonnet: { display: 'deepseek-v4-pro' } } });
    expect(resolveModelForSend('claude-opus-4-6')).toBeUndefined();
  });

  it('shows and sends the actual provider mapping only when configured', () => {
    useProviderStore.setState({
      activeProviderId: 'custom',
      providers: [{
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://example.test',
        apiFormat: 'anthropic',
        modelMappings: [{ tier: 'sonnet', providerModel: 'custom-sonnet' }],
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    expect(resolveModelForProvider('claude-sonnet-4-6')).toBe('custom-sonnet');
    expect(resolveModelForSend('claude-sonnet-4-6')).toBe('custom-sonnet');
  });

  it('does not disable Claude thinking for the official provider', () => {
    expect(resolveThinkingLevelForProvider('claude-sonnet-4-6', 'high')).toBe('high');
  });
});

describe('resolveModelDisplay', () => {
  beforeEach(() => {
    useProviderStore.setState({ providers: [], activeProviderId: null, loaded: true });
    useSettingsStore.setState({
      modelMappings: {
        opus: { display: 'minimax-m2.5', pass: 'claude-opus-4-8[1M]' },
        sonnet: { display: 'deepseek-v4-pro', pass: 'claude-sonnet-4-6[1M]' },
        haiku: { display: 'deepseek-v4-flash', pass: 'claude-haiku-4-5' },
      },
    });
  });

  it('maps date-suffixed haiku id to the upstream name', () => {
    expect(resolveModelDisplay('claude-haiku-4-5-20251001')).toBe('deepseek-v4-flash');
  });

  it('maps the bare haiku id reported by the CLI to the upstream name', () => {
    expect(resolveModelDisplay('claude-haiku-4-5')).toBe('deepseek-v4-flash');
  });

  it('maps [1M]-suffixed sonnet/opus ids to upstream names', () => {
    expect(resolveModelDisplay('claude-sonnet-4-6[1M]')).toBe('deepseek-v4-pro');
    expect(resolveModelDisplay('claude-opus-4-8[1M]')).toBe('minimax-m2.5');
  });

  it('does not remap upstream names that contain no tier keyword', () => {
    expect(resolveModelDisplay('deepseek-v4-flash')).toBe('DeepseekV4Flash');
    expect(resolveModelDisplay('deepseek-v4-pro')).toBe('DeepseekV4Pro');
  });

  it('returns an empty string for a missing model', () => {
    expect(resolveModelDisplay(null)).toBe('');
    expect(resolveModelDisplay(undefined)).toBe('');
    expect(resolveModelDisplay('')).toBe('');
  });
});
