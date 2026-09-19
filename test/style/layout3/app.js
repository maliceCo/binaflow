const scenarios = {
  brief: {
    eyebrow: 'Necesita tu atención · preparación',
    title: 'Completa el contexto antes de generar un plan',
    copy: 'Hay dos campos del brief pendientes. Responderlos mantiene la intención original de la tarea y permite que el planner proponga un plan.',
    note: 'La confirmación del brief todavía no está disponible.',
    action: 'Responder en la conversación',
    state: 'needs-brief',
  },
  plan: {
    eyebrow: 'Necesita tu decisión · plan',
    title: 'Revisa y aprueba el plan propuesto',
    copy: 'El brief ya está confirmado. La versión 2 describe el trabajo que recibirá el builder.',
    note: 'Aprobar el plan no inicia la ejecución.',
    action: 'Aprobar plan v2',
    state: 'needs-plan-approval',
  },
  blocked: {
    eyebrow: 'No puede iniciar · preview',
    title: 'Resuelve el bloqueo del workspace',
    copy: 'El plan y el TODO están disponibles, pero la comprobación previa encontró una condición que impide comenzar.',
    note: 'El inicio permanece bloqueado.',
    action: 'Consultar bloqueo',
    state: 'blocked',
  },
  changes: {
    eyebrow: 'Necesita inspección · resultado',
    title: 'Revisa los cambios producidos',
    copy: 'El build terminó y dejó un ChangeSet estructurado. Puedes consultar archivos y fragmentos sin convertir la consulta en una aprobación.',
    note: 'Las decisiones ricas sobre cambios aún no están disponibles.',
    action: 'Inspeccionar cambios',
    state: 'waiting/changes-review',
  },
};
const scenarioButtons = [...document.querySelectorAll('.scenario-buttons [data-scenario]')];
const supportButtons = [...document.querySelectorAll('[data-support]')];
const detailBlocks = [...document.querySelectorAll('[data-detail]')];
const toast = document.querySelector('#toast');
let timer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(timer);
  timer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}
function setScenario(name) {
  const scenario = scenarios[name];
  scenarioButtons.forEach((button) =>
    button.classList.toggle('is-active', button.dataset.scenario === name),
  );
  document.querySelector('#focus-eyebrow').textContent = scenario.eyebrow;
  document.querySelector('#focus-title').textContent = scenario.title;
  document.querySelector('#focus-copy').textContent = scenario.copy;
  document.querySelector('#focus-note').textContent = scenario.note;
  document.querySelector('#focus-action').textContent = scenario.action;
  document.querySelector('#state-label').textContent = scenario.state;
  detailBlocks.forEach((block) =>
    block.classList.toggle('is-visible', block.dataset.detail === name),
  );
}
scenarioButtons.forEach((button) =>
  button.addEventListener('click', () => setScenario(button.dataset.scenario)),
);
supportButtons.forEach((button) =>
  button.addEventListener('click', () => {
    supportButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    document
      .querySelectorAll('[data-support-panel]')
      .forEach((panel) =>
        panel.classList.toggle('is-visible', panel.dataset.supportPanel === button.dataset.support),
      );
  }),
);
document.querySelectorAll('[data-file]').forEach((button) =>
  button.addEventListener('click', () => {
    document
      .querySelectorAll('[data-file]')
      .forEach((item) => item.classList.toggle('is-selected', item === button));
    document.querySelector('#diff-detail').textContent =
      `${button.dataset.file}\n+ cambio mostrado para inspección;\n+ la consulta no registra una decisión.`;
  }),
);
document
  .querySelectorAll('[data-demo-action]')
  .forEach((button) =>
    button.addEventListener('click', () =>
      showToast('Demostración local: esta acción no modifica Binaflow.'),
    ),
  );
setScenario('brief');
