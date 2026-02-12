import { startRegistration } from '@simplewebauthn/browser';
import { api } from '../api.js';
import { navigate } from '../main.js';

export function renderRegister(root: HTMLElement) {
  root.innerHTML = `
    <div class="card">
      <h1>Create Account</h1>
      <p class="subtitle">Register with a passkey — no password needed.</p>
      <label for="username">Username</label>
      <input type="text" id="username" placeholder="Enter a username" autocomplete="username webauthn" />
      <button id="register-btn">Create Passkey</button>
      <div id="message"></div>
      <a href="#/login" class="link">Already have an account? Sign in</a>
    </div>
  `;

  const usernameInput = root.querySelector<HTMLInputElement>('#username')!;
  const registerBtn = root.querySelector<HTMLButtonElement>('#register-btn')!;
  const messageEl = root.querySelector<HTMLDivElement>('#message')!;

  registerBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (!username) {
      showMessage(messageEl, 'Please enter a username.', 'error');
      return;
    }

    registerBtn.disabled = true;
    registerBtn.textContent = 'Waiting for passkey...';

    try {
      // 1. Get registration options from server
      const options = await api.registerOptions(username);

      // 2. Create credential via browser WebAuthn API
      const registration = await startRegistration({ optionsJSON: options });

      // 3. Send response to server for verification
      const result = await api.registerVerify(registration);

      if (result.verified) {
        showMessage(messageEl, 'Passkey created! Redirecting...', 'success');
        setTimeout(() => navigate('dashboard'), 500);
      }
    } catch (err: any) {
      const msg =
        err.name === 'NotAllowedError'
          ? 'Passkey creation was cancelled.'
          : err.message || 'Registration failed.';
      showMessage(messageEl, msg, 'error');
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create Passkey';
    }
  });
}

function showMessage(el: HTMLElement, text: string, type: 'error' | 'success') {
  el.className = `message ${type}`;
  el.textContent = text;
}
