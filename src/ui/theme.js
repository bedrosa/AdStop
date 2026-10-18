function applyTheme(value) {
  const dark = value === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const button = document.querySelector('#theme-toggle');
  if (!button) return;
  const label = dark ? 'Activar modo claro' : 'Activar modo oscuro';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(dark));
  button.title = label;
}

applyTheme(localStorage.getItem('theme'));

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('theme'));
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', theme);
    applyTheme(theme);
  });
});

window.addEventListener('storage', event => {
  if (event.key === 'theme' || event.key === null) applyTheme(event.newValue);
});
