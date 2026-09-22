import { useMemo, useReducer } from 'react';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { Toolbar } from './components/Toolbar';
import { createEditorState, editorReducer } from './editor-state';

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createEditorState);
  const selectedBlock = useMemo(
    () => state.document.blocks.find((block) => block.id === state.selectedBlockId) ?? null,
    [state.document.blocks, state.selectedBlockId],
  );

  const createBlockId = () => crypto.randomUUID();

  return (
    <main className="app-shell">
      <Toolbar
        documentName={state.document.name}
        onRename={(name) => dispatch({ type: 'rename-document', name })}
        onNew={() => dispatch({ type: 'new-document' })}
        onAddBlock={() => dispatch({ type: 'add-block', id: createBlockId() })}
      />
      <div className="editor-layout">
        <Canvas
          document={state.document}
          selectedBlockId={state.selectedBlockId}
          onSelectBlock={(id) => dispatch({ type: 'select-block', id })}
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
