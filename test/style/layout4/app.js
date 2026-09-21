const stageContent = {
  brief: {
    title: 'Tu brief',
    summary: 'Una experiencia clara para observar y participar en una ejecución guiada.',
    label: 'Ya definido',
    detail: 'Progreso visible, preguntas del asistente y revisión de cambios desde la web.',
  },
  plan: {
    title: 'Objetivo confirmado',
    summary:
      'Preparar una experiencia web clara para observar y participar en una ejecución guiada.',
    label: 'Ahora decides',
    detail: 'El plan traduce el objetivo en un enfoque concreto antes de construir.',
  },
  todo: {
    title: 'Plan aprobado',
    summary: 'El trabajo está estructurado y puede comprobarse antes de iniciar.',
    label: 'Siguiente paso',
    detail: 'El TODO convierte el plan en trabajo verificable para el builder.',
  },
  execution: {
    title: 'Entrada preparada',
    summary: 'El builder recibirá el objetivo, el brief confirmado y el plan aprobado.',
    label: 'Inicio explícito',
    detail: 'La ejecución solo comienza después de confirmar las condiciones.',
  },
  changes: {
    title: 'Resultado disponible',
    summary: 'El build terminó y la tarea espera una inspección del ChangeSet.',
    label: 'Revisión manual',
    detail:
      'Inspecciona los archivos producidos sin aprobar ni aplicar cambios desde este prototipo.',
  },
};

const buttons = [...document.querySelectorAll('[data-stage]')];
const panels = [...document.querySelectorAll('[data-panel]')];
const feedback = document.querySelector('#feedback');
const contextTitle = document.querySelector('#context-title');
const contextSummary = document.querySelector('#context-summary');
const contextLabel = document.querySelector('#context-label');
const contextDetail = document.querySelector('#context-detail');
let feedbackTimer;

function setStage(stage) {
  const content = stageContent[stage];
  if (!content) return;
  for (const button of buttons) {
    const selected = button.dataset.stage === stage;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-current', selected ? 'step' : 'false');
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== stage;
  contextTitle.textContent = content.title;
  contextSummary.textContent = content.summary;
  contextLabel.textContent = content.label;
  contextDetail.textContent = content.detail;
  window.history.replaceState(null, '', `#${stage}`);
}

function showFeedback(message) {
  feedback.textContent = message;
  window.clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => {
    feedback.textContent = '';
  }, 4000);
}

for (const button of buttons)
  button.addEventListener('click', () => setStage(button.dataset.stage));
for (const form of document.querySelectorAll('[data-demo-form]')) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showFeedback('Demostración: la respuesta se añadiría al brief en la aplicación real.');
  });
}
for (const button of document.querySelectorAll('[data-demo]')) {
  button.addEventListener('click', () => showFeedback(button.dataset.demo));
}

const initialStage = window.location.hash.slice(1);
setStage(stageContent[initialStage] ? initialStage : 'brief');
