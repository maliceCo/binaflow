import { MAX_CANVAS_ROWS } from '../model';

interface ToolbarProps {
  documentName: string;
  canvasRows: number;
  onRename: (name: string) => void;
  onNew: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onAddBlock: () => void;
  onGrowCanvas: () => void;
}

export function Toolbar({
  documentName,
  canvasRows,
  onRename,
  onNew,
  onImport,
  onExport,
  onAddBlock,
  onGrowCanvas,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <label className="document-name-field">
        <span>Nombre del wireframe</span>
        <input
          aria-label="Nombre del wireframe"
          value={documentName}
          maxLength={100}
          onChange={(event) => onRename(event.target.value)}
        />
      </label>
      <nav className="toolbar-actions" aria-label="Acciones del documento">
        <button type="button" onClick={onNew}>
          Nuevo
        </button>
        <label className="file-action-button">
          <span>Importar JSON</span>
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Importar JSON"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = '';
            }}
          />
        </label>
        <button type="button" onClick={onExport}>
          Exportar JSON
        </button>
        <span className="canvas-rows">Lienzo: {canvasRows} filas</span>
        <button type="button" onClick={onGrowCanvas} disabled={canvasRows >= MAX_CANVAS_ROWS}>
          +6 filas
        </button>
        <button type="button" className="primary-action" onClick={onAddBlock}>
          Añadir bloque
        </button>
      </nav>
    </header>
  );
}
