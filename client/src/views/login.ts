import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../api.js';
import { navigate } from '../main.js';

export function renderLogin(root: HTMLElement) {
  root.innerHTML = `
    <div class="card">
      <h1>Sign In</h1>
      <p class="subtitle">Use your passkey to sign in.</p>
      <button id="login-btn">Sign in with Passkey</button>
      <div id="message"></div>
      <a href="#/register" class="link">Don't have an account? Register</a>
    </div>
  `;

  const loginBtn = root.querySelector<HTMLButtonElement>('#login-btn')!;
  const messageEl = root.querySelector<HTMLDivElement>('#message')!;

  loginBtn.addEventListener('click', async () => {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Waiting for passkey...';

    try {
      // 1. Get authentication options from server
      const options = await api.loginOptions();

      // 2. Authenticate via browser WebAuthn API
      const authentication = await startAuthentication({ optionsJSON: options });

      // 3. Send response to server for verification
      const result = await api.loginVerify(authentication);

      if (result.verified) {
        showMessage(messageEl, 'Signed in! Redirecting...', 'success');
        setTimeout(() => navigate('dashboard'), 500);
      }
    } catch (err: any) {
      const msg =
        err.name === 'NotAllowedError'
          ? 'Authentication was cancelled.'
          : err.message || 'Login failed.';
      showMessage(messageEl, msg, 'error');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign in with Passkey';
    }
  });
}

function showMessage(el: HTMLElement, text: string, type: 'error' | 'success') {
  el.className = `message ${type}`;
  el.textContent = text;
}
