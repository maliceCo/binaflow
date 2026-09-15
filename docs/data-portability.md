# Portabilidad de datos entre equipos

Estado: Hito 3.5 implementado localmente y verificado con SQLite, artefactos y
Git en fixtures temporales de Linux. No se ha probado Windows, NFS, FAT, LFS
real, submodules reales, Pi live ni transporte por red.

## Alcance

La portabilidad es un traslado controlado con un solo equipo activo; no es
sincronizacion, replicacion ni merge de bases SQLite. El paquete v1 es un
directorio sin compresion:

```text
transfer/
  manifest.json
  runs.db
  artifacts/<run>/<step>/<artifact>.json|txt
  repository.bundle
```

El paquete no contiene configuracion, tokens, credenciales, HOME, locks, caches,
remotes, hooks, index ni working tree. Conversaciones, resultados y artefactos
pueden contener secretos introducidos por el usuario: el paquete debe tratarse
como informacion sensible. No esta cifrado y los permisos del filesystem no son
una garantia criptografica ni son portables a todos los sistemas.

No se exportan ejecuciones reanudables. Runs `completed` y `cancelled`, y una
ejecucion guiada `waiting` en `changes-review` con todas sus tareas completadas
se pueden conservar como historial. Importar historial no vuelve a autorizar su
ejecucion.

## A -> B

1. Detener TUI, servidor futuro y otros procesos Binaflow que usen el dataDir.
   Finalizar o cancelar runs reanudables y dejar el repositorio Git limpio.
2. Revisar el preview y sus blockers:

   ```bash
   binaflow preview-export \
     --request-id <uuid-v4> \
     --output /ruta/transfer
   ```

   El preview devuelve el branch, HEAD, conteos, hashes, advertencia de
   sensibilidad y un digest. No se publica ni cambia el dataset fuente.

3. Confirmar usando exactamente el mismo request ID, destino y digest:

   ```bash
   binaflow export \
     --request-id <uuid-v4> \
     --digest <sha256-del-preview> \
     --output /ruta/transfer
   ```

   La fuente pasa a `exported` y rechaza el runtime normal. Un replay exacto
   devuelve el mismo paquete; otra solicitud falla.

4. Copiar el directorio del paquete de forma segura al equipo B. En B, crear o
   actualizar manualmente el repositorio desde el bundle, conservando el branch
   y el HEAD indicados. Binaflow no hace clone, fetch, checkout, merge, reset ni
   push.
5. Revisar el paquete y preparar el preview de importacion:

   ```bash
   binaflow inspect /ruta/transfer
   binaflow preview-import \
     --package /ruta/transfer \
     --output-data-dir /ruta/binaflow-data-b
   ```

   La importacion siempre usa un dataDir nuevo. El repositorio activo debe tener
   el branch y HEAD exactos del manifest.

6. Confirmar la importacion con el digest del preview:

   ```bash
   binaflow import \
     --request-id <uuid-v4> \
     --digest <sha256-del-preview> \
     --package /ruta/transfer \
     --output-data-dir /ruta/binaflow-data-b
   ```

   Cambiar manualmente la configuracion de B para apuntar al nuevo dataDir y
   configurar alli las credenciales. Conservar el dataDir anterior hasta
   terminar la comprobacion.

## Retorno B -> A

Repetir el export en B. El manifest declara la transferencia A -> B como
`parentTransferId`. En A, actualizar Git manualmente desde el bundle y hacer
solo un avance limpio hasta el HEAD del retorno. Si A tiene cambios
independientes o el baseline no esta `exported` con el padre exacto, el preview
bloquea la importacion y no modifica ningun directorio.

Importar el retorno a otro dataDir de A, revisar runs, documentos, decisiones,
artifacts y linaje, y solo entonces cambiar manualmente la configuracion. No se
borra ni se reemplaza el dataDir anterior.

## Recuperacion y limites

Un export interrumpido conserva un intent `exporting`. Repetir el mismo request y
digest puede terminarlo si el paquete final ya existe. Solo se puede cancelar
un intent `exporting` cuando su directorio final aun no existe y coinciden el
request ID y digest; un estado `exported` no se cancela.

Cada dataDir tiene un lease de proceso fuera del propio directorio. Un lock con
metadata ilegible, ownership cambiado o proceso no demostrablemente muerto
falla cerrado; no se borran locks ajenos automaticamente. El runtime normal
inspecciona el estado en modo read-only antes de migrar schema. Databases schema
13 activas migran aditivamente a schema 14; un dataset `exporting` o `exported`
no se abre como runtime normal.

El preflight rechaza Git dirty, detached, operaciones en curso, sparse checkout,
gitlinks/submodules y archivos tracked con `filter=lfs`. Tambien rechaza
artefactos ausentes, symlinks, hard links inesperados, paths fuera del root,
duplicados y cambios de tamano/hash. Los limites v1 son 100.000 artefactos,
16 MiB de manifest, 16 GiB por archivo y 128 GiB totales; excederlos bloquea y
no trunca contenido.

La integridad se comprueba con hashes SHA-256 en streaming, `integrity_check`,
`foreign_key_check`, contratos JSON y verificacion del Git bundle. El filesystem
puede no conservar permisos 0700/0600 y el paquete no ofrece cifrado. No hay
sincronizacion bidireccional, merge automatico, worktrees, LFS ni submodules.
