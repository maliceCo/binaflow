import { useEffect, useMemo, useReducer, useState } from 'react';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { Toolbar } from './components/Toolbar';
import { createEditorState, editorReducer } from './editor-state';
import { createWireframeDownload, readWireframeFile } from './file-io';
import { clearDraft, loadDraft, saveDraft } from './storage';

export default function App() {
  const [draft] = useState(() => loadDraft());
  const [state, dispatch] = useReducer(
    editorReducer,
    draft.document ?? undefined,
    createEditorState,
  );
  const [storageMessage, setStorageMessage] = useState(draft.error);

  useEffect(() => {
    const error = saveDraft(state.document);
    setStorageMessage(error);
  }, [state.document]);
  const selectedBlock = useMemo(
    () => state.document.blocks.find((block) => block.id === state.selectedBlockId) ?? null,
    [state.document.blocks, state.selectedBlockId],
  );
  const selectedParent =
    state.document.blocks.find((block) => block.id === selectedBlock?.parentId) ?? null;
  const selectedChildren = state.document.blocks.filter(
    (block) => block.parentId === selectedBlock?.id,
  );
  const parentOptions = state.document.blocks.filter(
    (block) => block.parentId === null && block.id !== selectedBlock?.id,
  );

  const createBlockId = () => crypto.randomUUID();
  const handleNewDocument = () => {
    if (
      state.document.blocks.length > 0 &&
      !window.confirm('¿Crear un documento nuevo y descartar el borrador actual?')
    ) {
      return;
    }

    const error = clearDraft();
    if (error) {
      setStorageMessage(error);
    }
    dispatch({ type: 'new-document' });
  };

  const handleImport = async (file: File) => {
    try {
      const document = await readWireframeFile(file);
      dispatch({ type: 'replace-document', document });
      setStorageMessage(null);
    } catch (error) {
      setStorageMessage(error instanceof Error ? error.message : 'No se pudo importar el archivo.');
    }
  };

  const handleExport = () => {
    try {
      createWireframeDownload(state.document);
      setStorageMessage(null);
    } catch {
      setStorageMessage('No se pudo exportar el wireframe.');
    }
  };

  return (
    <main className="app-shell">
      <Toolbar
        documentName={state.document.name}
        onRename={(name) => dispatch({ type: 'rename-document', name })}
        onNew={handleNewDocument}
        onImport={handleImport}
        onExport={handleExport}
        onAddBlock={() => dispatch({ type: 'add-block', id: createBlockId() })}
        canvasRows={state.document.canvas.rows}
        onGrowCanvas={() => dispatch({ type: 'grow-canvas' })}
      />
      {(storageMessage || state.notice) && (
        <p className="storage-notice" role="alert">
          {state.notice ?? storageMessage}
        </p>
      )}
      <div className="editor-layout">
        <Canvas
          document={state.document}
          selectedBlockId={state.selectedBlockId}
          onSelectBlock={(id) => dispatch({ type: 'select-block', id })}
          onGeometryChange={(id, geometry) =>
            dispatch({ type: 'set-block-geometry', id, geometry })
          }
        />
        <Inspector
          block={selectedBlock}
          parent={selectedParent ?? null}
          childCount={selectedChildren.length}
          parentOptions={parentOptions}
          onAddChild={() => {
            if (selectedBlock)
              dispatch({ type: 'add-child', id: createBlockId(), parentId: selectedBlock.id });
          }}
          onMoveToParent={(parentId) => {
            if (selectedBlock) dispatch({ type: 'move-to-parent', id: selectedBlock.id, parentId });
          }}
          onSelectParent={() => dispatch({ type: 'select-block', id: selectedParent?.id ?? null })}
          onTextChange={(field, value) =>
            dispatch({ type: 'update-block-text', id: state.selectedBlockId ?? '', field, value })
          }
          onGeometryChange={(field, value) => {
            if (!selectedBlock) return;
            dispatch({
              type: 'set-block-geometry',
              id: selectedBlock.id,
              geometry: { ...selectedBlock, [field]: value },
            });
          }}
          onDuplicate={() => {
            if (selectedBlock) {
              dispatch({
                type: 'duplicate-block',
                sourceId: selectedBlock.id,
                id: createBlockId(),
                childIds: selectedChildren.map(() => createBlockId()),
              });
            }
          }}
          onDelete={() => {
            if (!selectedBlock) return;
            if (
              selectedChildren.length > 0 &&
              !window.confirm(
                `¿Eliminar ${selectedBlock.title || 'este bloque'} y sus ${selectedChildren.length} bloques hijos?`,
              )
            )
              return;
            dispatch({ type: 'delete-block', id: selectedBlock.id });
          }}
        />
      </div>
    </main>
  );
}
