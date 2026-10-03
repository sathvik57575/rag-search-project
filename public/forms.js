document.querySelectorAll('[data-api-form]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('[type="submit"]');
    const output = document.querySelector('[data-response-output]');
    const status = document.querySelector('[data-response-status]');
    const payload = Object.fromEntries(new FormData(form).entries());

    form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      payload[input.name] = input.checked;
    });
    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === 'string') payload[key] = payload[key].trim();
      if (payload[key] === '') delete payload[key];
    });

    submitButton.disabled = true;
    status.textContent = 'SENDING';
    status.classList.remove('is-error');
    output.textContent = 'Waiting for the server…';

    try {
      const response = await fetch(form.dataset.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      output.textContent = JSON.stringify(result, null, 2);
      status.textContent = `${response.status} ${response.ok ? 'OK' : 'ERROR'}`;
      status.classList.toggle('is-error', !response.ok);
    } catch (error) {
      output.textContent = error.message || 'Request failed. Check the server and try again.';
      status.textContent = 'NETWORK ERROR';
      status.classList.add('is-error');
    } finally {
      submitButton.disabled = false;
    }
  });
});