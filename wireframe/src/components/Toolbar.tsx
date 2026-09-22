interface ToolbarProps {
  documentName: string;
  onRename: (name: string) => void;
  onNew: () => void;
  onAddBlock: () => void;
}

export function Toolbar({ documentName, onRename, onNew, onAddBlock }: ToolbarProps) {
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
        <button type="button" disabled title="Disponible en la siguiente fase">
          Importar JSON
        </button>
        <button type="button" disabled title="Disponible en la siguiente fase">
          Exportar JSON
        </button>
        <button type="button" className="primary-action" onClick={onAddBlock}>
          Añadir bloque
        </button>
      </nav>
    </header>
  );
}
