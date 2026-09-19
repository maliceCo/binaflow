const scenarios = {
  brief: {
    title: 'La preparación necesita dos respuestas',
    copy: 'El brief sigue siendo un borrador. La pregunta pendiente explica por qué el plan todavía no está disponible.',
    status: 'needs-brief',
  },
  plan: {
    title: 'El plan espera una decisión',
    copy: 'El brief está confirmado y hay una versión propuesta. Aprobarla habilita el TODO, pero no inicia el build.',
    status: 'needs-plan-approval',
  },
  blocked: {
    title: 'La ejecución está bloqueada antes de iniciar',
    copy: 'El plan y el TODO están listos, pero el workspace necesita atención antes de poder arrancar.',
    status: 'blocked',
  },
  changes: {
    title: 'Hay cambios para inspeccionar',
    copy: 'El build terminó. Puedes consultar archivos y fragmentos; no hay una aprobación de cambios en esta superficie.',
    status: 'waiting/changes-review',
  },
};
const buttons = [...document.querySelectorAll('.scenario-buttons [data-scenario]')];
const calloutTitle = document.querySelector('#scenario-title');
const calloutCopy = document.querySelector('#scenario-copy');
const summaryStatus = document.querySelector('#summary-status');
const toast = document.querySelector('#toast');
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}
function setScenario(name) {
  const scenario = scenarios[name];
  buttons.forEach((button) =>
    button.classList.toggle('is-active', button.dataset.scenario === name),
  );
  calloutTitle.textContent = scenario.title;
  calloutCopy.textContent = scenario.copy;
  summaryStatus.textContent = scenario.status;
  document.body.dataset.scenario = name;
}
buttons.forEach((button) =>
  button.addEventListener('click', () => setScenario(button.dataset.scenario)),
);
document.querySelectorAll('[data-scroll]').forEach((button) =>
  button.addEventListener('click', () => {
    document
      .querySelector(`#${button.dataset.scroll}`)
      .scrollIntoView({ behavior: 'smooth', block: 'start' });
    document
      .querySelectorAll('[data-scroll]')
      .forEach((item) => item.classList.toggle('is-active', item === button));
  }),
);
document
  .querySelectorAll('[data-demo-action]')
  .forEach((button) =>
    button.addEventListener('click', () =>
      showToast('Demostración local: esta acción no modifica Binaflow.'),
    ),
  );
document.querySelectorAll('[data-file]').forEach((button) =>
  button.addEventListener('click', () => {
    document
      .querySelectorAll('[data-file]')
      .forEach((item) => item.classList.toggle('is-selected', item === button));
    document.querySelector('#file-detail').textContent =
      `${button.dataset.file} · fragmento\n\n+ cambio mostrado para inspección;\n+ la consulta no registra una decisión.`;
  }),
);
setScenario('brief');
