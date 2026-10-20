// Apply the saved appearance before styles, React, and the access check load.
// Public assets load before authentication under the self-only script policy.
try {
  document.documentElement.dataset.theme = localStorage.getItem('vb-theme') === 'dark' ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}
