(() => {
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const saved = localStorage.getItem('hooshnet-theme');
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = saved === 'dark' || saved === 'light' ? saved : preferred;
  root.dataset.theme = theme;
  if (meta) meta.content = theme === 'dark' ? '#05070a' : '#f5f8fb';
})();
