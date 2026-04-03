(function() {
  var config = document.getElementById('appConfig');
  if (!config) return;
  var PRICE = parseFloat(config.dataset.price);
  var EVENT_ID = parseInt(config.dataset.eventId, 10);
  var orderCode = null;

  function updatePrice() {
    var qty = parseInt(document.getElementById('quantity').value);
    var total = qty * PRICE;
    document.getElementById('totalPrice').textContent = '$' + total.toFixed(2);
    document.getElementById('priceDetail').textContent = qty + (qty > 1 ? ' cartones' : ' carton') + ' x $' + PRICE.toFixed(2) + ' c/u';
  }
  document.getElementById('quantity').addEventListener('change', updatePrice);

  // Paso 1: Crear orden en nuestro backend
  document.getElementById('orderForm').addEventListener('submit', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var btn = document.getElementById('submitBtn');
    var errEl = document.getElementById('errorMsg');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Creando orden...';

    fetch('/venta/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: EVENT_ID,
        quantity: parseInt(document.getElementById('quantity').value),
        buyer_name: document.getElementById('buyer_name').value,
        buyer_email: document.getElementById('buyer_email').value,
        buyer_phone: document.getElementById('buyer_phone').value,
        buyer_cedula: '',
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.success) {
        errEl.textContent = data.error || 'Error al crear la orden';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Continuar';
        return;
      }
      orderCode = data.data.order_code;
      // Ocultar formulario, mostrar boton Yappy
      document.getElementById('orderForm').style.display = 'none';
      document.getElementById('paymentSection').style.display = 'block';
      document.getElementById('orderCodeDisplay').textContent = orderCode;
    })
    .catch(function() {
      errEl.textContent = 'Error de conexion. Intenta de nuevo.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Continuar';
    });
  });

  // Paso 2: Web component btn-yappy eventos
  window.addEventListener('load', function() {
    var btnyappy = document.querySelector('btn-yappy');
    if (!btnyappy) return;

    // Click en boton Yappy -> llamar backend para iniciar pago
    btnyappy.addEventListener('eventClick', async function() {
      if (!orderCode) return;
      try {
        document.getElementById('payStatus').textContent = 'Conectando con Yappy...';
        btnyappy.isButtonLoading = true;

        var res = await fetch('/venta/api/yappy/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_code: orderCode })
        });
        var result = await res.json();

        if (result.success && result.body.token && result.body.documentName && result.body.transactionId) {
          // Guardar para confirm-success
          window._yappyConfirmToken = result.confirmToken;
          window._yappyTransactionId = result.body.transactionId;

          btnyappy.eventPayment({
            transactionId: result.body.transactionId,
            documentName: result.body.documentName,
            token: result.body.token,
          });
          document.getElementById('payStatus').textContent = 'Confirma el pago en tu app de Yappy...';
        } else {
          document.getElementById('payStatus').textContent = result.error || 'Error iniciando pago';
          btnyappy.isButtonLoading = false;
        }
      } catch (err) {
        document.getElementById('payStatus').textContent = 'Error de conexion';
        btnyappy.isButtonLoading = false;
      }
    });

    // Pago exitoso
    btnyappy.addEventListener('eventSuccess', function(ev) {
      console.log('Yappy eventSuccess:', ev.detail);
      document.getElementById('payStatus').textContent = 'Pago confirmado. Procesando tu compra...';

      // Confirmar la orden en el backend
      fetch('/venta/api/yappy/confirm-success', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_code: orderCode, confirmToken: window._yappyConfirmToken, transactionId: window._yappyTransactionId })
      })
      .then(function() { window.location.href = '/venta/estado/' + orderCode; })
      .catch(function() { window.location.href = '/venta/estado/' + orderCode; });
    });

    // Pago fallido
    btnyappy.addEventListener('eventError', function(ev) {
      console.log('Yappy eventError:', ev.detail);
      document.getElementById('payStatus').textContent = 'El pago no se completo. Intenta de nuevo.';
      btnyappy.isButtonLoading = false;
    });
  });
})();
