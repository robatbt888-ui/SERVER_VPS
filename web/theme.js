(() => {
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const saved = localStorage.getItem('hooshnet-theme');
  const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
  root.dataset.theme = theme;
  if (meta) meta.content = theme === 'dark' ? '#05070a' : '#f5f8fb';
})();