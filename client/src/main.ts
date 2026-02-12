import { renderRegister } from './views/register.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';

const root = document.getElementById('app')!;

// ─── Simple Hash Router ────────────────────────────────────────────
type Route = 'register' | 'login' | 'dashboard';

const routes: Record<Route, (root: HTMLElement) => void | Promise<void>> = {
  register: renderRegister,
  login: renderLogin,
  dashboard: renderDashboard,
};

function getRoute(): Route {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  return (hash as Route) in routes ? (hash as Route) : 'login';
}

async function render() {
  const route = getRoute();
  await routes[route](root);
}

export function navigate(route: Route) {
  window.location.hash = `#/${route}`;
}

window.addEventListener('hashchange', render);
render();
