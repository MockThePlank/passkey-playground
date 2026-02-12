import { api } from '../api.js';
import { navigate } from '../main.js';

export async function renderDashboard(root: HTMLElement) {
  // Check authentication
  try {
    const user = await api.me();

    root.innerHTML = `
      <div class="card">
        <div class="dashboard-header">
          <h1>Dashboard</h1>
        </div>
        <div class="user-badge">
          <span class="icon">🔑</span>
          <span>Signed in as <strong>${escapeHtml(user.username)}</strong></span>
        </div>
        <p class="subtitle">You are authenticated via passkey. This is a protected page.</p>
        <button id="logout-btn" class="secondary">Sign Out</button>
      </div>
    `;

    root
      .querySelector<HTMLButtonElement>('#logout-btn')!
      .addEventListener('click', async () => {
        await api.logout();
        navigate('login');
      });
  } catch {
    // Not authenticated → redirect to login
    navigate('login');
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
