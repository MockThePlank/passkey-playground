const BASE = '/api/auth';

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    headers,
    credentials: 'same-origin',
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  registerOptions(username: string) {
    return request<PublicKeyCredentialCreationOptionsJSON>(
      '/register/options',
      {
        method: 'POST',
        body: JSON.stringify({ username }),
      },
    );
  },

  registerVerify(body: unknown) {
    return request<{ verified: boolean; username: string }>(
      '/register/verify',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  },

  loginOptions() {
    return request<PublicKeyCredentialRequestOptionsJSON>('/login/options', {
      method: 'POST',
    });
  },

  loginVerify(body: unknown) {
    return request<{ verified: boolean; username: string }>('/login/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  me() {
    return request<{ userId: string; username: string }>('/me');
  },

  logout() {
    return request<{ ok: boolean }>('/logout', { method: 'POST' });
  },
};
