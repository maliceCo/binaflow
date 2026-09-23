---
name: todo-agent-skill
description: Genera y coordina planes de implementación detallados en TODO.md para delegar tareas atómicas a otro agente.
disable-model-invocation: true
---

# Skill: Generador de Planes de Ejecución Quirúrgicos (TODO.md)

Este Skill transforma a la IA en un **Orquestador de Desarrollo Guiado por Especificaciones (Spec-Driven Development)**. Su objetivo es analizar un requerimiento complejo, diseñar un plan de ejecución ultra-detallado en un archivo `TODO.md`, y guiar a un **modelo de lenguaje menor (sub-agente)** para que implemente el código de forma quirúrgica, sin ambigüedades y sin código especulativo, con resultados observables.

---

## CONTEXTO FILOSÓFICO (Grounded in Software Craftsmanship)

1. **Pensar antes de codificar (Code Complete):** El diseño detallado evita la "programación vudú". El plan debe escribirse a nivel de _intención_, no de implementación sintáctica.
2. **Manejo de la Complejidad (Simplicity First):** El modelo menor debe resolver una sola sub-tarea cohesiva a la vez. No se permite agregar abstracciones ni flexibilidad no solicitada.
3. **Aislamiento de Commits (Código Sostenible):** Nunca se mezclan cambios funcionales con refactorizaciones o formateos en el mismo commit. Cada tarea completada representa una transición de estado limpia y atómica.
4. **Ejecución Guiada por Objetivos (The Pragmatic Programmer):** Define un resultado observable por tarea. Para funcionalidades que atraviesen varias capas, planifica primero un tracer bullet: un recorrido funcional mínimo por el camino real que permita detectar pronto problemas de integración.

---

## FASE 1: ANÁLISIS E INICIALIZACIÓN

Antes de escribir cualquier línea de código, el Orquestador debe generar el archivo temporal `TODO.md` en la raíz del proyecto. El Orquestador redactará este archivo siguiendo una estructura de **Contrato Estricto**.

### Reglas de Creación del `TODO.md`:

1. **Cero Ambigüedad:** Cada tarea debe especificar los archivos exactos a modificar, las funciones/clases afectadas y el comportamiento esperado.
2. **Criterio de Cierre (Definition of Done):** Cada tarea debe indicar el comportamiento esperado y cómo observarlo o revisarlo, sin imponer verificaciones automatizadas. Incluye la creación de tests solo si el usuario la solicita explícitamente; QA es revisión del código existente.
3. **Separación de Concernientes (Refactor vs. Feature):** Las tareas de limpieza, indentación o renombrado deben estar en casillas completamente separadas de las tareas de nueva funcionalidad.

---

## FASE 2: FORMATO ESTÁNDAR DE `TODO.md`

El archivo `TODO.md` debe estructurarse estrictamente de la siguiente manera:

```markdown
# PLAN DE EJECUCIÓN: [Nombre del Requerimiento]

> **ATENCIÓN SUB-AGENTE:** Sigue este plan de forma estrictamente secuencial. No saltes tareas. No agregues código que no esté explícitamente detallado. Si encuentras un obstáculo o comportamiento inesperado, DETÉN LA EJECUCIÓN e informa al Orquestador inmediatamente.

## 📋 Lista de Tareas

### Fase 1: Prerrequisitos y Preparación (Refactor / Estructura)

- [ ] **Tarea 1.1: [Título Corto]**
    - **Archivo:** `ruta/al/archivo.ext`
    - **Descripción:** [Qué se debe hacer a nivel de intención]
    - **Evitar:** [Advertencias específicas sobre código basura o sobre-ingeniería]
    - **Resultado observable:** [Cómo reconocer que el cambio previsto está presente]
    - **Commit Msg:** `refactor: [descripción atómica]`

### Fase 2: Implementación Funcional (Feature)

- Si la funcionalidad atraviesa varias capas, la primera tarea debe conectar el recorrido real más pequeño (tracer bullet); amplía ese recorrido en tareas posteriores. Para cambios acotados, omite este paso.
- [ ] **Tarea 2.1: [Título Corto]**
    - **Archivos:** `ruta/al/archivo_de_negocio.ext` [y las rutas de las demás capas, si corresponde]
    - **Descripción:** [Detalle quirúrgico de la lógica]
    - **Resultado observable:** [Comportamiento esperado y cómo reconocerlo sin crear tests por defecto]
    - **Commit Msg:** `feat: [descripción funcional]`

## 🛡️ Reglas de Operación para el Sub-Modelo

1. **Un solo Check a la vez:** No comiences la tarea `N+1` hasta que la tarea `N` tenga su check (`[x]`) y se haya comprobado el resultado por el medio previsto en el plan. Si el agente de implementación no puede realizar esa comprobación, documenta el límite para la revisión posterior.
2. **Política de Commits:** Haz un commit de Git inmediatamente al marcar un check. Usa el mensaje de commit especificado en la tarea. No acumules cambios de múltiples tareas.
3. **Límite de Faros:** No adivines el futuro. Si falta información en una tarea, no asumas; detente y pregunta.
4. **Autodestrucción:** Cuando todas las tareas tengan un check (`[x]`), elimina físicamente el archivo `TODO.md` para no dejar residuos de configuración en el repositorio.
```

---

## FASE 3: PROTOCOLO DE DESVIACIÓN Y CONTROL

Si durante la ejecución el sub-modelo detecta:

- Un bug preexistente que bloquea su tarea.
- La necesidad de crear una nueva función de soporte no planificada.
- Un cambio en las firmas de los métodos que rompa otros módulos.

El sub-modelo **no debe intentar arreglarlo por su cuenta**. Debe congelar su estado actual, no hacer check en la tarea en curso, y responder con el siguiente formato:

```markdown
⚠️ ALERTA DE DESVIACIÓN DE PLAN

- **Tarea en curso:** [ID de Tarea]
- **Bloqueo detectado:** [Descripción técnica del problema]
- **Impacto:** [Archivos/Tests afectados]
- **Propuesta:** [Sugerencia de nueva tarea o ajuste del plan]
```

El Orquestador actualizará el archivo `TODO.md` con las nuevas tareas necesarias antes de autorizar al sub-modelo a continuar.

---

## FASE 4: CRITERIOS DE CIERRE ANTES DE LA AUTODESTRUCCIÓN

Antes de eliminar el archivo `TODO.md`, el sub-modelo debe cerrar el trabajo:

1. Informar los resultados observados y las limitaciones de comprobación para la revisión de QA; no crear ni ejecutar tests salvo solicitud explícita del usuario.
2. Asegurar que `git status` muestra un árbol de trabajo limpio (con todos los commits realizados).
3. Eliminar el archivo: `rm TODO.md` (o equivalente del sistema).
