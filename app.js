let c = 0;
function add(){
  c++;
  document.getElementById('count').textContent = c;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=20260106-1');
  });
}
