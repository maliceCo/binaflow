import { useEffect, useMemo, useReducer, useState } from 'react';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { Toolbar } from './components/Toolbar';
import { createEditorState, editorReducer } from './editor-state';
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
    if (error) {
      setStorageMessage(error);
    }
  }, [state.document]);
  const selectedBlock = useMemo(
    () => state.document.blocks.find((block) => block.id === state.selectedBlockId) ?? null,
    [state.document.blocks, state.selectedBlockId],
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

  return (
    <main className="app-shell">
      <Toolbar
        documentName={state.document.name}
        onRename={(name) => dispatch({ type: 'rename-document', name })}
        onNew={handleNewDocument}
        onAddBlock={() => dispatch({ type: 'add-block', id: createBlockId() })}
      />
      {storageMessage && (
        <p className="storage-notice" role="alert">
          {storageMessage}
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
              });
            }
          }}
          onDelete={() => {
            if (selectedBlock) {
              dispatch({ type: 'delete-block', id: selectedBlock.id });
            }
          }}
        />
      </div>
    </main>
  );
}
