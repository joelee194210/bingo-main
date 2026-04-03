(function() {
  var config = document.getElementById('appConfig');
  if (!config) return;
  var orderCode = config.dataset.orderCode;
  if (!orderCode) return;

  setInterval(async function() {
    try {
      var res = await fetch('/venta/api/orders/' + encodeURIComponent(orderCode) + '/status');
      var data = await res.json();
      if (data.success && data.data.status !== 'pending_payment') {
        window.location.reload();
      }
    } catch(e) {}
  }, 10000);
})();
