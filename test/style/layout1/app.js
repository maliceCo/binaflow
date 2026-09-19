const stages = {
  brief: {
    title: 'Completar el brief',
    copy: 'La tarea necesita respuestas antes de que pueda generarse un plan.',
    action: 'Responder en la conversación',
    status: 'needs-brief',
    attention: 'La tarea necesita contexto',
    next: 'responder',
  },
  plan: {
    title: 'Revisar el plan',
    copy: 'Hay una versión propuesta que requiere una decisión explícita.',
    action: 'Aprobar plan v2',
    status: 'needs-plan-approval',
    attention: 'El plan espera tu decisión',
    next: 'aprobar o comentar',
  },
  todo: {
    title: 'Comprobar el TODO',
    copy: 'El trabajo está estructurado y puede previsualizarse antes de iniciar.',
    action: 'Previsualizar ejecución',
    status: 'ready',
    attention: 'El TODO está listo',
    next: 'previsualizar',
  },
  execution: {
    title: 'Observar la ejecución',
    copy: 'La ejecución requiere preview y confirmación antes de comenzar.',
    action: 'Confirmar e iniciar',
    status: 'execution-preview',
    attention: 'La ejecución todavía no ha comenzado',
    next: 'confirmar inicio',
  },
  review: {
    title: 'Inspeccionar cambios',
    copy: 'El build terminó y la tarea espera revisión del ChangeSet.',
    action: 'Abrir artefacto',
    status: 'waiting/changes-review',
    attention: 'Hay cambios esperando inspección',
    next: 'revisar archivos',
  },
};

const stageButtons = [...document.querySelectorAll('[data-stage]')];
const panels = [...document.querySelectorAll('[data-panel]')];
const taskItems = [...document.querySelectorAll('.task-item')];
const attentionTitle = document.querySelector('#attention-title');
const attentionCopy = document.querySelector('#attention-copy');
const attentionNext = document.querySelector('#attention-next');
const contextTitle = document.querySelector('#context-title');
const contextCopy = document.querySelector('#context-copy');
const contextAction = document.querySelector('#context-action');
const factStatus = document.querySelector('#fact-status');
const toast = document.querySelector('#toast');
let activeStage = 'brief';
let toastTimer;

function setStage(stage) {
  const next = stages[stage];
  if (!next) return;
  activeStage = stage;
  for (const button of stageButtons) {
    const selected = button.dataset.stage === stage;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-current', selected ? 'step' : 'false');
  }
  for (const panel of panels) panel.classList.toggle('is-visible', panel.dataset.panel === stage);
  attentionTitle.textContent = next.attention;
  attentionCopy.textContent = next.copy;
  attentionNext.textContent = next.next;
  contextTitle.textContent = next.title;
  contextCopy.textContent = next.copy;
  contextAction.textContent = next.action;
  factStatus.textContent = next.status;
  window.history.replaceState(null, '', `#${stage}`);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

for (const button of stageButtons)
  button.addEventListener('click', () => setStage(button.dataset.stage));
for (const item of taskItems) {
  item.addEventListener('click', () => {
    for (const other of taskItems) {
      const selected = other === item;
      other.classList.toggle('is-selected', selected);
      other.setAttribute('aria-selected', String(selected));
    }
    document.querySelector('#task-title').textContent = item.dataset.title;
    document.querySelector('#task-id').textContent = item.dataset.task;
    setStage('brief');
    showToast(`Tarea ${item.dataset.task} seleccionada (solo prototipo)`);
  });
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'confirm-brief') {
    showToast('En la aplicación real, aquí se confirmaría el brief.');
    setStage('plan');
  } else if (action === 'approve-plan') {
    showToast('En la aplicación real, aquí se aprobaría la versión exacta del plan.');
    setStage('todo');
  } else if (action === 'preview-execution') {
    showToast('La preview comprobaría el workspace y los bloqueos.');
    setStage('execution');
  } else if (action === 'start-execution') {
    document.querySelector('#execution-preview').classList.add('is-hidden');
    document.querySelector('#execution-running').classList.remove('is-hidden');
    document.querySelector('#execution-state').textContent = 'Run activo';
    stages.execution.title = 'Ejecución en curso';
    stages.execution.copy =
      'El builder está trabajando; el progreso se muestra por fases y tareas.';
    stages.execution.action = 'Solicitar cancelación';
    stages.execution.attention = 'La ejecución está en curso';
    stages.execution.next = 'observar progreso';
    setStage('execution');
    showToast('Estado simulado: ejecución iniciada.');
  } else if (action === 'cancel-execution') {
    showToast('En la aplicación real, esto solicitaría la cancelación mediante el lifecycle.');
  } else if (action === 'brief-answer') {
    showToast('El prototipo no envía mensajes ni muta el brief.');
  }
});

for (const form of document.querySelectorAll('[data-mock-form]')) {
  form.addEventListener('submit', (event) => event.preventDefault());
}

const initialStage = window.location.hash.slice(1);
setStage(stages[initialStage] ? initialStage : 'brief');
