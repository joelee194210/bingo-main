// Confeti cayendo — extraído del inline porque la CSP del landing bloquea
// scripts inline (scriptSrc: 'self'). Servido desde /assets/panama/confeti.js.
(function () {
  const colores = ['#ff0', '#f00', '#0f0', '#00f', '#ff7a00'];

  function crearConfeti() {
    const confeti = document.createElement('div');
    confeti.classList.add('confeti');
    confeti.style.left = Math.random() * 100 + 'vw';
    confeti.style.backgroundColor = colores[Math.floor(Math.random() * colores.length)];
    confeti.style.animationDuration = (Math.random() * 3 + 2) + 's';
    document.body.appendChild(confeti);
    setTimeout(() => { confeti.remove(); }, 5000);
  }

  setInterval(crearConfeti, 300);
})();
