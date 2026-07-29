import * as SecureStore from 'expo-secure-store';

export type ApiEnvironment = 'local' | 'staging' | 'production';

const TOKEN_KEY = 'maneflow_session_token';
const ENV_KEY = 'maneflow_api_environment';
const CUSTOM_URL_KEY = 'maneflow_custom_api_url';

export const API_ENVIRONMENTS: Record<ApiEnvironment, string> = {
  local: process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL || 'http://127.0.0.1:4321',
  staging: process.env.EXPO_PUBLIC_STAGING_API_BASE_URL || 'https://staging-mane.memphiscardcompany.com',
  production: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://mane.memphiscardcompany.com',
};

export const CARD_IMAGE_PLACEHOLDER = '/assets/card-placeholder.svg';

export async function getApiEnvironment(): Promise<ApiEnvironment> {
  const stored = await SecureStore.getItemAsync(ENV_KEY);
  return stored === 'local' || stored === 'staging' || stored === 'production' ? stored : 'production';
}

export async function setApiEnvironment(environment: ApiEnvironment): Promise<void> {
  await SecureStore.setItemAsync(ENV_KEY, environment);
}

export async function setCustomApiBaseUrl(value: string): Promise<void> {
  const clean = String(value || '').trim().replace(/\/$/, '');
  if (!clean) await SecureStore.deleteItemAsync(CUSTOM_URL_KEY);
  else await SecureStore.setItemAsync(CUSTOM_URL_KEY, clean);
}

export async function getApiBaseUrl(): Promise<string> {
  const custom = await SecureStore.getItemAsync(CUSTOM_URL_KEY);
  if (custom) return custom;
  const env = await getApiEnvironment();
  return API_ENVIRONMENTS[env];
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export async function setSessionToken(token: string): Promise<void> {
  if (!token) await SecureStore.deleteItemAsync(TOKEN_KEY);
  else await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function hasSessionToken(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(TOKEN_KEY));
}

export function resolveAssetUrl(value: string = CARD_IMAGE_PLACEHOLDER, baseUrl = API_ENVIRONMENTS.production): string {
  const clean = String(value || CARD_IMAGE_PLACEHOLDER).trim();
  if (/^(https?:|data:)/i.test(clean)) return clean;
  return `${baseUrl}${clean.startsWith('/') ? clean : `/${clean}`}`;
}
