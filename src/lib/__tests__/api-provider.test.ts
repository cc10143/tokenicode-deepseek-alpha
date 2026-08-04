import { beforeEach, describe, expect, it } from 'vitest';
import { resolveModelForProvider, resolveModelForSend, resolveThinkingLevelForProvider } from '../api-provider';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';

describe('provider model resolution', () => {
  beforeEach(() => {
    useProviderStore.setState({ providers: [], activeProviderId: null, loaded: true });
    useSettingsStore.setState({ inheritedModel: null });
  });

  it('keeps the selected Claude model when no custom provider is active', () => {
    expect(resolveModelForProvider('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(resolveModelForProvider('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('shows the inherited system model when no provider is active', () => {
    useSettingsStore.setState({ inheritedModel: 'claude-haiku-4-5' });
    expect(resolveModelForProvider('claude-sonnet-4-6')).toBe('claude-haiku-4-5');
  });

  it('omits the model in inherit mode so the CLI uses system config', () => {
    expect(resolveModelForSend('claude-sonnet-4-6')).toBeUndefined();
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
