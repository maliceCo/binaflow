---
name: todo-implementation-focused
description: Ejecuta planes TODO.md como agente de implementación enfocado, con entregas atómicas y handover para QA.
disable-model-invocation: true
---

# Skill: Implementation-Focused TODO Workflow (No-Blocking QA)

Este Skill define un flujo de trabajo optimizado para **modelos de implementación pura (sub-agentes)**. Su objetivo es ejecutar tareas de construcción de código de forma continua, rápida y sin bloqueos, delegando la verificación de calidad (QA) y el testing a una fase posterior ejecutada manualmente o por un modelo especializado en QA.

Inspirado en la separación de fases del **Pseudocode Programming Process** de *Code Complete* y en evitar el sesgo de confirmación del programador, este flujo maximiza la velocidad de desarrollo aislando la fase de construcción de la fase de verificación.

---

## 1. Reglas de Comportamiento para el Agente de Implementación

1. **Enfoque en Construcción Pura:** No escribas código de pruebas (tests), ni ejecutes comandos de prueba (pytest, jest, etc.), a menos que el TODO lo pida explícitamente como entregable de negocio.
2. **Ejecución Continua (No-Blocking):** Si encuentras un obstáculo menor o una decisión de diseño ambigua:
   * **No te detengas.** Toma la decisión más simple y limpia (*Código Sostenible*).
   * **Documenta** la asunción o el desvío de inmediato en la sección de "Notas de Implementación" en el `TODO.md`.
   * **Continúa** con la siguiente tarea.
3. **Aislamiento de Cambios:** Modifica estrictamente lo necesario para cumplir con la tarea. No intentes limpiar o refactorizar archivos adyacentes de forma espontánea (*Karpathy Guidelines*).
4. **Commits de Fase:** Si se definen fases, realiza un commit atómico al terminar cada una. Los mensajes de commit deben describir qué se implementó (ej: `feat: add user billing route`).

---

## 2. Ciclo de Vida del TODO.md

El `TODO.md` actúa como el contrato de ejecución del sub-agente. Sigue estrictamente este ciclo:

```
[ Creación del TODO ] ──> [ Ejecución Continua ] ──> [ Entrega y Reporte ] ──> [ Autodestrucción ]
```

### Fase A: Creación del TODO (Por el Orquestador/Usuario)
El usuario o un modelo de planificación avanzado define el archivo `TODO.md` al principio del espacio de trabajo utilizando la plantilla provista abajo. Las tareas deben ser atómicas e inequívocas.

### Fase B: Ejecución de Tareas (Por el Sub-Agente)
* El modelo procesa las tareas en orden.
* Al finalizar una tarea, marca el check `[x]`.
* Si surge un problema imprevisto que bloquea la ejecución por completo, detente y notifica al usuario de inmediato. Si el problema es manejable mediante una asunción de diseño, documéntalo y sigue adelante.

### Fase C: Entrega y Reporte de Handover
Una vez que todas las casillas del `TODO.md` están marcadas `[x]`, el sub-agente debe escribir un breve mensaje de entrega que contenga:
1. **Archivos Modificados:** Lista de archivos tocados.
2. **Asunciones y Notas Técnicas:** Qué decisiones de diseño se tomaron de forma autónoma.
3. **Puntos Críticos para QA:** Sugerencias específicas de qué debería probar el usuario o el modelo de QA (ej: *"Probar comportamiento con inputs nulos en la línea 45 de billing.py"*).

### Fase D: Autodestrucción
Una vez que el usuario confirma que ha recibido el reporte de entrega y que el código está listo para la fase de QA, **el archivo `TODO.md` se elimina físicamente** para evitar desorden en el repositorio.

---

## 3. Plantilla Estándar del TODO.md

La IA de implementación debe inicializar (o seguir) el `TODO.md` usando exactamente esta estructura:

```markdown
# TODO: Plan de Implementación Activo

> **Rol del Agente:** Construcción continua y directa. No ejecutes pruebas ni te bloquees por QA. Documenta asunciones y avanza.

## 📋 Lista de Tareas

### Fase 1: [Nombre de la Fase]
- [ ] **Tarea 1.1:** [Descripción técnica precisa del cambio. Indicar archivos a tocar]
- [ ] **Tarea 1.2:** [Descripción técnica precisa del cambio. Indicar archivos a tocar]

### Fase 2: [Nombre de la Fase]
- [ ] **Tarea 2.1:** [Descripción técnica precisa del cambio]

---

## 📝 Notas de Implementación (Asunciones y Atajos)
*Aquí el agente de implementación anotará las decisiones tomadas sobre la marcha para no bloquearse.*
- *(Ejemplo) Decisión en Tarea 1.1: Se asumió que el ID del usuario siempre vendrá como un string UUIDv4 válido.*

---

## 🔍 Guía de Handover para QA
*Sección autogenerada por el agente al finalizar todas las tareas.*
- [Aún no disponible. Se generará al completar el plan]
```

---

## 4. Instrucciones de Cierre para el Usuario (Fase de QA Manual)

Cuando el sub-agente de implementación termine, tú (el usuario) puedes:
1. **Cambiar de modelo** a uno especializado en QA/Refactorización (como tu `qa-review-skill`).
2. **Pedirle al modelo de QA** que analice el código modificado basándose en la **Guía de Handover** generada.
3. **Ejecutar tus pruebas manuales** o automáticas.
4. Si se encuentran fallos, **generar un nuevo `TODO.md`** con la lista de correcciones necesarias y volver a delegar la tarea de implementación.

---
*Diseñado bajo los principios de Código Sostenible y Code Complete para una construcción de software eficiente, ágil y libre de fricciones.*
